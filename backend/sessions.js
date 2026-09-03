// Shared live state for the whole backend: the HTTP server + WebSocket
// server, the per-account Twitch/TikTok connections, and the broadcast
// helpers every domain router needs.
//
// ── Why this module exists, and how the dependency direction was chosen ──────
//
// These used to be closures inside app.js, which is exactly what made app.js
// impossible to split: `broadcastToAccount` alone is used by chat, overlays,
// the overlay builder, video, XP and TTS. Splitting app.js by domain without
// first extracting them would have every router reaching back into app.js —
// a require cycle, since app.js has to require the routers to mount them.
//
// Of the two shapes considered (a: a shared module the routers require
// directly; b: `createXRouter({ broadcastToAccount, ... })` factories that
// take their dependencies as arguments), this is (a), applied to every
// router without exception:
//
//   sessions.js  →  requires only leaf modules (auth, twitch, eventsub,
//                   emotes, xp, activity, videoQueue, youtube). It never
//                   requires app.js or anything under routes/.
//   routes/*.js  →  require("../sessions") at module load, call into it at
//                   request time.
//   app.js       →  requires sessions.js and the routers, and is the only
//                   thing anyone requires from the outside.
//
// The arrows only ever point down, so there is no cycle to break and no
// wiring boilerplate at every mount site. Factories (b) would have worked
// too, but they add a parameter list to each router that grows with every
// new shared helper, for a module that is a singleton in practice — there is
// exactly one WebSocket server in this process.
//
// The one thing that genuinely cannot be resolved by require order is the
// construction order: `wss` is built on `server`, and `server` wraps `app`,
// so neither exists until app.js has built the Express app. That is why this
// module owns the *state* but not the *creation*: app.js calls
// `attach({ server, wss })` once, immediately after creating them, before
// anything can serve a request. Everything below reads `wss` lazily, at
// broadcast time, so a router requiring this module at import time (i.e.
// before attach) is fine.
const { WebSocket } = require("ws");
const { getValidTwitchToken, getValidBotTwitchToken, forceRefreshBotToken } = require("./auth");
const { TwitchIRCClient } = require("./twitch");
const { EventSubClient } = require("./eventsub");
const emotes = require("./emotes");
const xp = require("./xp");
const achievements = require("./achievements");
const activity = require("./activity");
const videoQueue = require("./videoQueue");
const youtube = require("./youtube");

// Set once by app.js via attach(), right after http.createServer(app) and
// new WebSocketServer({ server }). Never reassigned afterwards.
let server = null;
let wss = null;

function attach(deps) {
  server = deps.server;
  wss = deps.wss;
}

// Each logged-in Twitch account gets its own independent session — keyed by
// twitchId — so multiple accounts can stay connected concurrently instead of
// one login's /connect tearing down another's. tiktokClient stays a single
// global since TikTok isn't tied to an approved-user login.
let tiktokClient = null;
const twitchSessions = new Map(); // twitchId -> { login, twitchClient, botClient, eventSubClient, accessToken, botCreds }

function getTikTokClient() {
  return tiktokClient;
}

function setTikTokClient(client) {
  tiktokClient = client;
}

// Broadcast to all connected frontend clients
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

// Broadcast only to browser sessions logged in as the given Twitch account —
// otherwise every logged-in user (on any browser) would see chat/events from
// every connected account instead of just their own.
function broadcastToAccount(twitchId, data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN && ws.twitchId === twitchId) ws.send(msg);
  });
}

// Broadcast newly-earned streamer achievements (and any points-driven tier
// upgrade they triggered) to that account's own sessions. Route handlers
// that earn achievements outside this module reuse this via require — it
// keeps the two WS message shapes in one place.
function notifyAchievements(twitchId, result) {
  if (!result || result.throttled || !result.newlyUnlocked || result.newlyUnlocked.length === 0) return null;
  broadcastToAccount(twitchId, {
    type: "achievement_unlocked",
    achievements: result.newlyUnlocked,
    totalPoints: result.totalPoints,
    earnedTier: result.earnedTier,
  });
  const upgradedTier = achievements.maybeUpgradeTier(twitchId, result.earnedTier);
  if (upgradedTier) {
    broadcastToAccount(twitchId, {
      type: "tier_upgraded",
      newTier: upgradedTier,
      totalPoints: result.totalPoints,
    });
  }
  return upgradedTier;
}

// Broadcast a chat message (to that account's own sessions) and award XP for it
function handleChat(twitchId, msg) {
  const session = twitchSessions.get(twitchId);
  const isBot = !!(session?.botUsername && msg.login && msg.login === session.botUsername);
  // Resolves the raw IRC emote/badge tags into renderable objects against an
  // in-memory cache — synchronous, so it can't reorder the feed (see emotes.js).
  broadcastToAccount(twitchId, { type: "chat", msg: { ...emotes.enrich(msg, twitchId), isBot } });
  if (msg.username && msg.text) {
    const ev = xp.addMessage(twitchId, msg.username, msg.text, msg.color);
    if (ev && ev.gained > 0) broadcastToAccount(twitchId, { type: "xp", ...ev });
  }
  // Throttled (5s per account, see achievements.js): chat is the hot path, so
  // this only resolves setup/bot/event milestones earned elsewhere within
  // seconds while streaming — countable chat milestones land on the same tick.
  notifyAchievements(twitchId, achievements.checkAndUnlockThrottled(twitchId));
  const srMatch = msg.text && msg.text.match(/^!sr\s+(.+)/i);
  if (srMatch) handleSongRequest(twitchId, msg.username, srMatch[1].trim());
}

function broadcastVideoState(twitchId) {
  broadcastToAccount(twitchId, { type: "video_state", ...videoQueue.getState(twitchId) });
}

// !sr <url|id|title> — open to any viewer (unless disabled via the site's
// "Enable viewer requests" toggle — the streamer's own site controls are
// never gated by it), resolves via youtube.resolveInput (free oEmbed for
// URLs/IDs, YouTube Data API search for free-text titles), enqueues it,
// auto-starts playback if the queue was idle, and confirms in chat via the
// account's bot connection (if one is configured).
async function handleSongRequest(twitchId, username, input) {
  const session = twitchSessions.get(twitchId);
  const stateBefore = videoQueue.getState(twitchId);
  if (!stateBefore.viewerRequestsEnabled) {
    session?.botClient?.say(`@${username} song requests are currently disabled.`);
    return;
  }
  try {
    const resolved = await youtube.resolveInput(input);
    const wasIdle = !stateBefore.nowPlaying;
    videoQueue.enqueue(twitchId, { ...resolved, requestedBy: username });
    if (wasIdle) {
      await videoQueue.advance(twitchId, { refreshDefaultPlaylist: youtube.fetchPlaylistItems });
    } else if (stateBefore.skipDefaultOnRequest && stateBefore.nowPlaying?.source === "default") {
      await videoQueue.advance(twitchId, { refreshDefaultPlaylist: youtube.fetchPlaylistItems });
    }
    broadcastVideoState(twitchId);
    session?.botClient?.say(`@${username} added to queue: ${resolved.title}`);
  } catch (err) {
    console.error("[song-request]", err.message);
    if (err.message === "YOUTUBE_API_KEY_MISSING") {
      session?.botClient?.say(`@${username} song search isn't configured — try pasting a YouTube link instead.`);
    } else {
      session?.botClient?.say(`@${username} couldn't find that song — try a different link or title.`);
    }
  }
}

// Guards against overlapping refresh attempts when the bot IRC client fires
// several auth_error events back-to-back (it reconnects and re-fails every
// ~10s until we intervene) — see handleBotAuthError below.
const botAuthErrorInFlight = new Set();

// Twitch's real token lifetime can be shorter than the expires_in we cached
// (or the token can be revoked outright), so a linked bot's IRC client can
// end up retrying forever with a token Twitch will never accept again.
// Reacts to that by force-refreshing and swapping in a new IRC client once —
// self-healing without waiting for the 30-min periodic sweep below. Only
// wired up for linked-via-OAuth bots (see connectTwitchForUser); manual
// pasted tokens and the site-wide bot have no refresh token to fall back to.
//
// Deliberately does NOT keep re-triggering itself on the new client's own
// auth_error (learned the hard way): a bad token is only one possible cause
// of "Login unsuccessful" — an otherwise-valid, correctly-scoped token gets
// the exact same rejection if the bot account's email isn't verified, which
// no amount of refreshing fixes. Looping on that just hammers Twitch's token
// endpoint. One retry covers genuine mid-session expiry; anything past that
// falls back to TwitchIRCClient's own backoff (1s up to 30s) so a
// persistently-failing account degrades gracefully instead of spinning hot.
async function handleBotAuthError(twitchId) {
  if (botAuthErrorInFlight.has(twitchId)) return;
  botAuthErrorInFlight.add(twitchId);
  try {
    const session = twitchSessions.get(twitchId);
    if (!session || !session.botClient) return;
    session.botClient.disconnect(); // stop its own retry loop — we're taking over, once
    let fresh;
    try {
      fresh = await forceRefreshBotToken(twitchId);
    } catch (err) {
      console.error(`[bot] refresh after auth_error failed for ${twitchId} — unlinking:`, err.message);
      return;
    }
    if (!fresh) return; // not a linked bot (or already unlinked) — nothing to recover
    session.botClient = new TwitchIRCClient({
      channel: session.login,
      token: fresh.token,
      username: fresh.username,
      onMessage: () => {},
      onStatus: (status) => {
        console.log("[bot]", status.type, status.message || "");
        broadcastToAccount(twitchId, { type: "bot_status", status, botUsername: fresh.username, usingSiteBot: false });
      },
    });
    session.botClient.connect();
    console.log(`[bot] refreshed token after auth_error, reconnecting as ${fresh.username}`);
  } finally {
    botAuthErrorInFlight.delete(twitchId);
  }
}

// Connects Twitch chat + EventSub as the given (approved, logged-in) user,
// using their own Twitch OAuth login — no manually-entered channel/token/
// client-ID. Only tears down that same user's previous session, leaving any
// other logged-in account's connection untouched. Shared by POST /connect
// (routes/chat.js) and the periodic token-refresh timer in app.js, which
// calls this again when a rotated token needs reconnecting — that shared use
// is why it lives here next to twitchSessions rather than in the chat router.
async function connectTwitchForUser(user, { botUsername, botToken } = {}) {
  const token = await getValidTwitchToken(user.twitchId); // throws NO_TWITCH_TOKEN / TWITCH_TOKEN_REFRESH_FAILED
  const channel = user.login;
  const twitchId = user.twitchId;

  const prev = twitchSessions.get(twitchId);
  if (prev) {
    if (prev.twitchClient) prev.twitchClient.disconnect();
    if (prev.botClient) prev.botClient.disconnect();
    if (prev.eventSubClient) prev.eventSubClient.disconnect();
  }

  // Fire-and-forget: first-ever connect for this account seeds the Activity
  // Panel with whatever history Twitch's API can still provide (follows,
  // redemptions — see activity.js for why subs/raids/cheers can't be).
  activity.backfillIfEmpty(twitchId, token).catch(() => {});

  // Priority: manually-pasted creds (legacy) > the user's own linked bot
  // account (OAuth, see /bot-link/* in auth.js) > the site-wide fallback bot.
  let linkedBot = null;
  if (!(botUsername && botToken)) {
    try {
      linkedBot = await getValidBotTwitchToken(twitchId);
    } catch (err) {
      console.error("[connect] linked bot token unavailable, falling back:", err.message);
    }
  }
  const usingSiteBot = !(botUsername && botToken) && !linkedBot && !!(process.env.TWITCH_SITE_BOT_USERNAME && process.env.TWITCH_SITE_BOT_TOKEN);
  const effectiveBotUsername = botUsername || (linkedBot ? linkedBot.username : null) || (usingSiteBot ? process.env.TWITCH_SITE_BOT_USERNAME : null);
  const effectiveBotToken = botToken || (linkedBot ? linkedBot.token : null) || (usingSiteBot ? process.env.TWITCH_SITE_BOT_TOKEN : null);

  const session = {
    login: channel, twitchClient: null, botClient: null, eventSubClient: null, accessToken: token,
    botCreds: { botUsername: botUsername || null, botToken: botToken || null }, usingSiteBot,
    // Lowercase login of whichever account is currently posting as "the bot"
    // in this channel — used to flag msg.isBot for the chat overlay's
    // "show bot messages" toggle. Kept in sync on reconnect below.
    botUsername: effectiveBotUsername ? effectiveBotUsername.toLowerCase() : null,
  };

  // Bot client — separate user that can send messages. Uses the user's own
  // bot creds if configured in Settings, otherwise falls back to the
  // site-wide bot account (TWITCH_SITE_BOT_USERNAME/TOKEN) if one is set.
  if (effectiveBotUsername && effectiveBotToken) {
    session.botClient = new TwitchIRCClient({
      channel,
      token: effectiveBotToken,
      username: effectiveBotUsername,
      onMessage: () => {}, // don't echo bot's own messages
      onStatus: (status) => {
        console.log("[bot]", status.type, status.message || "");
        broadcastToAccount(twitchId, { type: "bot_status", status, botUsername: effectiveBotUsername, usingSiteBot });
        if (status.type === "auth_error" && linkedBot) handleBotAuthError(twitchId);
      },
    });
    session.botClient.connect();
  } else {
    console.log("[bot] no bot client created (no user creds and no/incomplete site-wide fallback)");
  }

  session.twitchClient = new TwitchIRCClient({
    channel,
    token,
    username: channel,
    onMessage: (msg) => handleChat(twitchId, msg),
    onStatus: (status) => broadcastToAccount(twitchId, { type: "status", status }),
  });
  session.twitchClient.connect();

  session.eventSubClient = new EventSubClient({
    channel,
    clientId: process.env.TWITCH_CLIENT_ID,
    token,
    onRedeem: (redeem) => {
      activity.record(twitchId, {
        id: redeem.id,
        timestamp: redeem.timestamp,
        kind: "redeem",
        username: redeem.username,
        rewardTitle: redeem.rewardTitle,
        text: redeem.text,
      });
      broadcastToAccount(twitchId, { type: "chat", msg: redeem });
      notifyAchievements(twitchId, achievements.checkAndUnlock(twitchId));
    },
    onEvent: (event) => {
      activity.record(twitchId, event);
      broadcastToAccount(twitchId, { type: "twitch_event", event });
      notifyAchievements(twitchId, achievements.checkAndUnlock(twitchId));
    },
    onStatus: (status) => {
      console.log("[eventsub]", status);
      broadcastToAccount(twitchId, { type: "status", status });
    },
  });
  session.eventSubClient.connect();

  twitchSessions.set(twitchId, session);
  return { channel };
}

module.exports = {
  attach,
  getServer: () => server,
  getWss: () => wss,
  twitchSessions,
  getTikTokClient,
  setTikTokClient,
  broadcast,
  broadcastToAccount,
  notifyAchievements,
  handleChat,
  broadcastVideoState,
  handleSongRequest,
  connectTwitchForUser,
};
