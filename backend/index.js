const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const http = require("http");
const path = require("path");
const { WebSocketServer, WebSocket } = require("ws");
const { router: authRouter, requireApprovedUser, getApprovedUserFromCookieHeader, getValidTwitchToken, readUsers, getOverlayToken, findUserByOverlayToken, getValidBotTwitchToken, forceRefreshBotToken } = require("./auth");
const { sendEvent } = require("./analytics");
const errorLog = require("./errorLog");
const { router: adminRouter } = require("./adminAuth");
const { router: devicesRouter } = require("./devices");
const { queryClaudeCLI, queryYouTubeNarration, queryScreenAnswer, importMemory, containsPromptLeak } = require("./claude");
const usage = require("./usage");
const siteConfig = require("./siteConfig");
const memoryExport = require("./memoryExport");
const memoryDownload = require("./memoryDownload");
const screenwatch = require("./screenwatch");
const { TwitchIRCClient } = require("./twitch");
const emotes = require("./emotes");
const { EventSubClient } = require("./eventsub");
const { TikTokChatClient } = require("./tiktok");
const { fetchRandomStory } = require("./reddit");
const vtubeManager = require("./vtubeManager");
const xp = require("./xp");
const activity = require("./activity");
const elevenlabs = require("./elevenlabs");
const piper = require("./piper");
const avatarOverlay = require("./avatarOverlay");
const videoQueue = require("./videoQueue");
const chatOverlayConfig = require("./chatOverlayConfig");
const userSettings = require("./userSettings");
const chatOverlayBg = require("./chatOverlayBg");
const youtube = require("./youtube");
const streamSettings = require("./streamSettings");
const multer = require("multer");
const fs = require("fs");
const overlayAssets = require("./overlayAssets");
const overlayLayouts = require("./overlayLayouts");

const PORT = process.env.PORT || 3001;
const app = express();
// nginx sits in front of this process on localhost and sets X-Forwarded-For /
// X-Real-IP from the real client (see sites-available/vtamigo). "loopback"
// tells Express to only trust those headers when the direct TCP peer is
// 127.0.0.1/::1 — i.e. only nginx can set them, so req.ip reflects the real
// visitor without letting an internet client spoof its own IP by hand.
app.set("trust proxy", "loopback");
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: "10mb" })); // memory .md imports and base64 avatar image uploads (5MB image -> ~6.7MB base64) can be large

// POST /api/collect — relay for frontend-only analytics events (settings
// changes, button clicks with no other network signal). Same-origin, so it
// isn't recognized as a third-party tracker the way calling cloud.umami.is
// directly from the browser is.
app.post("/api/collect", (req, res) => {
  const { event, data } = req.body || {};
  if (event) {
    const user = getApprovedUserFromCookieHeader(req.headers.cookie);
    sendEvent(event, { req, twitchLogin: user?.login, data });
  }
  res.status(204).end();
});

// POST /api/log-error — relay for frontend app errors (uncaught exceptions,
// unhandled promise rejections, React render errors, and explicit logError()
// calls). Public/unauthenticated on purpose — errors can happen before login
// (e.g. on the login screen) and we still want to see those.
app.post("/api/log-error", (req, res) => {
  const { message, stack, source } = req.body || {};
  if (message) {
    const user = getApprovedUserFromCookieHeader(req.headers.cookie);
    errorLog.addEntry({
      message,
      stack,
      source,
      url: req.body?.url,
      userAgent: req.headers["user-agent"],
      twitchLogin: user?.login,
    });
  }
  res.status(204).end();
});

// Twitch login + admin panel routes are public (or self-protected via their
// own middleware); everything else requires an approved, logged-in user.
app.use(authRouter);
app.use(adminRouter);
app.use(devicesRouter);

// Serve built frontend in production (Electron packaged app / VPS) — public,
// so the login screen itself can load before the user is authenticated.
const isProd = !process.env.VITE_DEV && !process.defaultApp;
const distPath = path.join(__dirname, "../frontend/dist");
if (isProd) {
  app.get("/downloads/tunnel-client.exe", (req, res) => {
    const user = getApprovedUserFromCookieHeader(req.headers.cookie);
    sendEvent("tunnel_client_download", { req, twitchLogin: user?.login });
    res.sendFile(path.join(distPath, "downloads/tunnel-client.exe"));
  });
  app.use(express.static(distPath));
}

// Known API route prefixes that require an approved, logged-in user. Any GET
// request outside these prefixes is treated as SPA client-side routing (e.g.
// "/", "/admin") and served the app shell — the SPA itself checks /auth/me
// and shows the login/pending screen client-side, so this reveals no data.
const PROTECTED_PREFIXES = [
  "/respond", "/memory", "/connect", "/disconnect", "/say",
  "/reddit-story", "/reddit-thoughts", "/event-response", "/youtube-narrate",
  "/screenwatch", "/screen-answer", "/xp", "/vtube", "/lipsync", "/tts", "/video",
  "/activity", "/overlay-builder",
];
app.use((req, res, next) => {
  // /xp/ranking and /video/state, /video/ended are excluded even though they
  // match protected prefixes below — they're the endpoints the OBS overlay
  // needs, and OBS's Browser Source has no access to the streamer's session
  // cookie. They do their own auth inline (cookie session OR ?token= overlay
  // token) instead of the blanket check.
  // "/overlay-builder" bare (no trailing segment) is the Overlay Studio SPA
  // page itself, not an API call — like /admin and /device, it does its own
  // client-side /auth/me check (see OverlayBuilder.jsx), so it must fall
  // through to the SPA catch-all unauthenticated. Everything under
  // "/overlay-builder/..." (the actual API routes) still matches the prefix
  // check below and gets gated normally.
  if (req.path === "/xp/ranking" || req.path === "/video/state" || req.path === "/video/ended" || req.path === "/overlay-builder") return next();
  // Match hyphenated variants too (e.g. "/connect-bot", "/connect-tiktok"),
  // not just "/connect" itself or "/connect/..." — a plain "/" boundary
  // check let those slip through unauthenticated, which crashed /connect-bot
  // (it reads req.user, never populated without requireApprovedUser).
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => req.path === p || req.path.startsWith(p + "/") || req.path.startsWith(p + "-")
  );
  if (!isProtected) return next();
  requireApprovedUser(req, res, next);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/chat" });

// Each logged-in Twitch account gets its own independent session — keyed by
// twitchId — so multiple accounts can stay connected concurrently instead of
// one login's /connect tearing down another's. tiktokClient stays a single
// global since TikTok isn't tied to an approved-user login.
let tiktokClient = null;
const twitchSessions = new Map(); // twitchId -> { login, twitchClient, botClient, eventSubClient, accessToken, botCreds }

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

// POST /respond — run Claude CLI with a batch of messages
app.post("/respond", async (req, res) => {
  const { messages, style, basePrompt, manual } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array is required" });
  }

  // The AI provider is a site-wide admin setting — any provider sent by the
  // client is ignored so a user's own Settings preference can't override it.
  const provider = siteConfig.getProvider();
  const twitchId = req.user?.twitchId;

  sendEvent("ai_response_generated", { req, twitchLogin: req.user?.login, data: { provider } });
  if (manual) sendEvent("now_button_click", { req, twitchLogin: req.user?.login });

  try {
    const response = await queryClaudeCLI(messages, style || "auto", basePrompt || "", null, null, null, provider, twitchId);
    usage.recordGeneration({
      twitchId: req.user?.twitchId,
      login: req.user?.login,
      provider,
      inputText: messages.map((m) => m.text || "").join(" "),
      outputText: response,
    });
    const upgradedTier = usage.maybeAutoUpgradeTier(req.user?.twitchId);
    if (upgradedTier) sendEvent("tier_auto_upgraded", { req, twitchLogin: req.user?.login, data: { newTier: upgradedTier } });
    res.json({ response, tier: upgradedTier || undefined });
  } catch (err) {
    if (err.message === "OPENAI_API_KEY_MISSING") {
      return res.status(503).json({ error: "ChatGPT requires OPENAI_API_KEY in the backend environment" });
    }
    if (err.message === "CLI_NOT_FOUND") {
      const name = provider.charAt(0).toUpperCase() + provider.slice(1);
      return res.status(503).json({ error: `${name} CLI not found — make sure it is installed and on your PATH` });
    }
    if (err.message === "TIMEOUT") {
      return res.status(504).json({ error: `${provider} CLI timed out (>60s)` });
    }
    console.error("[ai]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /memory/export — start exporting one provider's session memory to another
app.post("/memory/export", (req, res) => {
  const { from, to } = req.body || {};
  try {
    memoryExport.startExport(from, to, req.user?.twitchId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /memory/export/status — progress of the current/last export job for this account
app.get("/memory/export/status", (req, res) => {
  res.json(memoryExport.getStatus(req.user?.twitchId));
});

// POST /memory/import — load a hand-picked .md file into the site-wide provider's live session
app.post("/memory/import", async (req, res) => {
  const { markdown } = req.body || {};
  const provider = siteConfig.getProvider();
  try {
    const response = await importMemory(markdown, provider, req.user?.twitchId);
    sendEvent("memory_upload", { req, twitchLogin: req.user?.login, data: { provider } });
    res.json({ ok: true, response });
  } catch (err) {
    if (err.message === "MEMORY_EMPTY") {
      return res.status(400).json({ error: "El archivo .md está vacío" });
    }
    if (err.message === "CLI_NOT_FOUND") {
      return res.status(503).json({ error: `${provider} CLI no encontrado` });
    }
    if (err.message === "TIMEOUT") {
      return res.status(504).json({ error: `${provider} CLI tardó demasiado (>60s)` });
    }
    res.status(400).json({ error: err.message });
  }
});

// GET /memory/download/status — when this account's 24h cooldown next clears
app.get("/memory/download/status", (req, res) => {
  res.json(memoryDownload.getStatus(req.user?.twitchId));
});

// POST /memory/download — start a background job dumping the bot's current
// memory as Markdown, gated by a 24h cooldown. Returns immediately; poll
// GET /memory/download/status for progress (the CLI call itself can take a
// couple of minutes, longer than nginx's proxy timeout allows for one request).
app.post("/memory/download", (req, res) => {
  try {
    memoryDownload.startDownload(siteConfig.getProvider(), req.user?.twitchId);
    res.json({ ok: true });
  } catch (err) {
    if (err.message === "COOLDOWN") {
      return res.status(429).json({ error: "COOLDOWN", availableAt: err.availableAt });
    }
    if (err.message === "ALREADY_RUNNING") {
      return res.status(409).json({ error: "Ya hay una descarga en curso" });
    }
    res.status(400).json({ error: err.message });
  }
});

// POST /connect-bot — (re)connect only the bot client for this user's session, no WS disruption
app.post("/connect-bot", (req, res) => {
  const { botUsername, botToken } = req.body || {};
  if (!botUsername || !botToken) {
    return res.status(400).json({ error: "botUsername and botToken are required" });
  }
  const twitchId = req.user.twitchId;
  const channel = req.user.login;
  const session = twitchSessions.get(twitchId) || { login: channel, twitchClient: null, botClient: null, eventSubClient: null, accessToken: null, botCreds: {} };
  if (session.botClient) { session.botClient.disconnect(); session.botClient = null; }
  session.botCreds = { botUsername, botToken };
  session.botUsername = botUsername.toLowerCase();
  session.botClient = new TwitchIRCClient({
    channel,
    token: botToken,
    username: botUsername,
    onMessage: () => {},
    onStatus: (status) => {
      console.log("[bot]", status.type);
      broadcastToAccount(twitchId, { type: "bot_status", status });
    },
  });
  session.botClient.connect();
  twitchSessions.set(twitchId, session);
  res.json({ ok: true });
});

// POST /say — send a message to chat as the bot user, on behalf of the logged-in user's session
app.post("/say", (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "text is required" });

  // Backstop against prompt injection: blocks AI-generated text that leaked
  // our internal prompt scaffolding or recites the streamer's base prompt
  // back into chat. Doesn't affect the streamer's own typed messages, which
  // never go through this endpoint.
  if (containsPromptLeak(req.user.twitchId, text)) {
    console.warn(`[say] blocked a likely prompt leak/injection attempt for ${req.user.login}`);
    return res.status(400).json({ error: "Blocked — response looked like a prompt leak or injection attempt" });
  }

  const session = twitchSessions.get(req.user.twitchId);
  if (!session || !session.botClient) return res.status(503).json({ error: "Bot not connected — add bot credentials in Settings" });
  const sent = session.botClient.say(text);
  if (!sent) return res.status(503).json({ error: "Bot WebSocket not open" });
  res.json({ ok: true });
});

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
// other logged-in account's connection untouched. Shared by POST /connect and
// the periodic token-refresh timer below, which calls this again when a
// rotated token needs reconnecting.
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
    },
    onEvent: (event) => {
      activity.record(twitchId, event);
      broadcastToAccount(twitchId, { type: "twitch_event", event });
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

// POST /connect — connect to the logged-in user's own Twitch channel
app.post("/connect", async (req, res) => {
  const { botUsername, botToken, manual } = req.body || {};
  if (manual) sendEvent("manual_connect", { req, twitchLogin: req.user?.login });
  try {
    const { channel } = await connectTwitchForUser(req.user, { botUsername, botToken });
    res.json({ ok: true, channel, eventSub: true });
  } catch (err) {
    if (err.message === "NO_TWITCH_TOKEN" || err.message === "TWITCH_TOKEN_REFRESH_FAILED") {
      return res.status(503).json({ error: "Tu sesión de Twitch expiró — cierra sesión y vuelve a iniciar sesión." });
    }
    console.error("[connect]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /disconnect — disconnect the logged-in user's own Twitch session, leaving other accounts connected
app.post("/disconnect", (req, res) => {
  const { manual } = req.body || {};
  if (manual) sendEvent("manual_disconnect", { req, twitchLogin: req.user?.login });
  const twitchId = req.user.twitchId;
  const session = twitchSessions.get(twitchId);
  if (session) {
    if (session.twitchClient) session.twitchClient.disconnect();
    if (session.botClient) session.botClient.disconnect();
    if (session.eventSubClient) session.eventSubClient.disconnect();
    twitchSessions.delete(twitchId);
  }
  res.json({ ok: true });
});

// Every 30 min, check whether each connected account's Twitch token needs a
// refresh (getValidTwitchToken refreshes transparently when close to expiry)
// and reconnect if it rotated — EventSub subscriptions are per-websocket-
// session, so a reconnect naturally re-subscribes with the fresh token.
setInterval(async () => {
  for (const [twitchId, session] of twitchSessions) {
    try {
      const freshToken = await getValidTwitchToken(twitchId);
      if (freshToken !== session.accessToken) {
        const user = readUsers().find((u) => u.twitchId === twitchId);
        if (user) {
          console.log(`[twitch] token refreshed for ${user.login} — reconnecting`);
          await connectTwitchForUser(user, session.botCreds);
        }
      }
    } catch (err) {
      console.warn(`[twitch] periodic token refresh failed for ${twitchId}:`, err.message);
    }
  }
}, 30 * 60 * 1000);

// POST /connect-tiktok — connect to a TikTok Live channel
app.post("/connect-tiktok", (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: "username is required" });

  if (tiktokClient) tiktokClient.disconnect();

  tiktokClient = new TikTokChatClient({
    username,
    onMessage: (msg) => handleChat(msg),
    onStatus: (status) => broadcast({ type: "tiktok_status", status }),
  });
  tiktokClient.connect();

  res.json({ ok: true, username });
});

// POST /disconnect-tiktok — disconnect from TikTok Live
app.post("/disconnect-tiktok", (req, res) => {
  if (tiktokClient) { tiktokClient.disconnect(); tiktokClient = null; }
  res.json({ ok: true });
});

// POST /reddit-story — scrape and return a random story (no Claude)
app.post("/reddit-story", async (req, res) => {
  const { subreddits } = req.body || {};
  try {
    const story = await fetchRandomStory(subreddits?.length ? subreddits : undefined);
    res.json({ story });
  } catch (err) {
    console.error("[reddit]", err.message);
    res.status(502).json({ error: err.message });
  }
});

// POST /reddit-thoughts — Claude reacts to the last paragraph of a story
app.post("/reddit-thoughts", async (req, res) => {
  const { paragraph, title, subreddit, basePrompt } = req.body || {};
  if (!paragraph) return res.status(400).json({ error: "paragraph is required" });
  const provider = siteConfig.getProvider();
  try {
    const response = await queryClaudeCLI([], "auto", basePrompt || "", null, null, { paragraph, title, subreddit }, provider, req.user?.twitchId);
    res.json({ response });
  } catch (err) {
    if (err.message === "OPENAI_API_KEY_MISSING") {
      return res.status(503).json({ error: "ChatGPT requires OPENAI_API_KEY in the backend environment" });
    }
    if (err.message === "CLI_NOT_FOUND") {
      const name = provider.charAt(0).toUpperCase() + provider.slice(1);
      return res.status(503).json({ error: `${name} CLI not found — make sure it is installed and on your PATH` });
    }
    if (err.message === "TIMEOUT") return res.status(504).json({ error: "Claude CLI timed out" });
    console.error("[reddit-thoughts]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /event-response — generate an immediate Claude reaction to a Twitch event
app.post("/event-response", async (req, res) => {
  const { event, basePrompt } = req.body;
  if (!event) return res.status(400).json({ error: "event is required" });
  const provider = siteConfig.getProvider();
  try {
    const response = await queryClaudeCLI([], "auto", basePrompt || "", event, null, null, provider, req.user?.twitchId);
    res.json({ response });
  } catch (err) {
    if (err.message === "OPENAI_API_KEY_MISSING") {
      return res.status(503).json({ error: "ChatGPT requires OPENAI_API_KEY in the backend environment" });
    }
    if (err.message === "CLI_NOT_FOUND") {
      const name = provider.charAt(0).toUpperCase() + provider.slice(1);
      return res.status(503).json({ error: `${name} CLI not found — make sure it is installed and on your PATH` });
    }
    if (err.message === "TIMEOUT") {
      return res.status(504).json({ error: `${provider} CLI timed out (>60s)` });
    }
    console.error("[ai/event]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /youtube-narrate — Claude looks at the YouTube tab and narrates what's playing
app.post("/youtube-narrate", async (req, res) => {
  const { basePrompt } = req.body || {};
  try {
    const response = await queryYouTubeNarration(basePrompt || "", siteConfig.getProvider(), req.user?.twitchId);
    res.json({ response });
  } catch (err) {
    if (err.message === "OPENAI_API_KEY_MISSING") {
      return res.status(503).json({ error: "ChatGPT requires OPENAI_API_KEY in the backend environment" });
    }
    if (err.message === "CLI_NOT_FOUND") {
      return res.status(503).json({ error: "Claude CLI not found — make sure it is installed and on your PATH" });
    }
    if (err.message === "TIMEOUT") {
      return res.status(504).json({ error: "Claude CLI timed out while narrating YouTube" });
    }
    console.error("[youtube-narrate]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Screen question watcher ──────────────────────────────────────────────────

// POST /screenwatch/config — { enabled, intervalSec, region: "x,y,w,h" | "", processName, autoNavigate }
app.post("/screenwatch/config", (req, res) => {
  const { enabled, intervalSec, region, processName, autoNavigate } = req.body || {};
  if (enabled) {
    screenwatch.start({
      intervalSec,
      region,
      processName,
      autoNavigate,
      onQuestion: (q) =>
        broadcast({ type: "screen_question", ...q, id: `sq-${Date.now()}`, timestamp: Date.now() }),
      onStatus: (status) => broadcast({ type: "screenwatch_status", status }),
    });
  } else {
    screenwatch.stop();
  }
  res.json({ ok: true, running: screenwatch.isRunning() });
});

// POST /screenwatch/scan — manual one-shot: capture now, extract a question,
// and if found broadcast it so the normal collect-and-answer flow kicks in
app.post("/screenwatch/scan", async (req, res) => {
  const { region, processName } = req.body || {};
  try {
    const result = await screenwatch.scanOnce({ region, processName });
    if (result.hasQuestion) {
      broadcast({
        type: "screen_question",
        question: result.question,
        options: result.options,
        id: `sq-${Date.now()}`,
        timestamp: Date.now(),
      });
    }
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err.message === "WINDOW_NOT_FOUND") {
      return res.status(404).json({ error: `No se encontró la ventana de ${processName}` });
    }
    if (err.message === "OCR_UNAVAILABLE") {
      return res.status(503).json({ error: "OCR no disponible en este Windows" });
    }
    if (err.message === "CLI_NOT_FOUND") {
      return res.status(503).json({ error: "Claude CLI not found — make sure it is installed and on your PATH" });
    }
    if (err.message === "TIMEOUT") {
      return res.status(504).json({ error: "Claude CLI timed out (>60s)" });
    }
    console.error("[screenwatch/scan]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /screenwatch/click — locate an option's text on screen, click it, then
// after 3-5 s click again to advance. { optionText, processName, region, dryRun }
app.post("/screenwatch/click", async (req, res) => {
  const { optionText, processName, region, dryRun } = req.body || {};
  if (!optionText) return res.status(400).json({ error: "optionText is required" });
  try {
    const result = await screenwatch.clickOption({ optionText, processName, region, dryRun: !!dryRun });
    console.log("[screenwatch/click]", result.replace(/\r?\n/g, " | "));
    res.json({ ok: true, result });
  } catch (err) {
    if (err.message === "WINDOW_NOT_FOUND") {
      return res.status(404).json({ error: `No se encontró la ventana de ${processName}` });
    }
    if (err.message === "TEXT_NOT_FOUND") {
      return res.status(404).json({ error: `No encontré "${optionText}" en la pantalla` });
    }
    if (err.message === "OCR_UNAVAILABLE") {
      return res.status(503).json({ error: "OCR no disponible en este Windows" });
    }
    console.error("[screenwatch/click]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /screenwatch/test — broadcast a sample question to try the full flow
app.post("/screenwatch/test", (req, res) => {
  broadcast({
    type: "screen_question",
    id: `sq-test-${Date.now()}`,
    timestamp: Date.now(),
    question: "¿Cuál es el planeta más grande del sistema solar?",
    options: ["Marte", "Júpiter", "Saturno", "La Tierra"],
  });
  res.json({ ok: true });
});

// POST /screen-answer — answer a detected on-screen question using collected chat
app.post("/screen-answer", async (req, res) => {
  const { question, options, messages, basePrompt, windowSec } = req.body || {};
  if (!question) return res.status(400).json({ error: "question is required" });
  const provider = siteConfig.getProvider();
  try {
    const result = await queryScreenAnswer({
      question,
      options: Array.isArray(options) ? options : [],
      messages: Array.isArray(messages) ? messages : [],
      basePrompt: basePrompt || "",
      provider,
      twitchId: req.user?.twitchId,
      windowSec: Number(windowSec) || 20,
    });
    // { response, choiceIndex, topVoteIndex }
    res.json(result);
  } catch (err) {
    if (err.message === "OPENAI_API_KEY_MISSING") {
      return res.status(503).json({ error: "ChatGPT requires OPENAI_API_KEY in the backend environment" });
    }
    if (err.message === "CLI_NOT_FOUND") {
      const name = provider.charAt(0).toUpperCase() + provider.slice(1);
      return res.status(503).json({ error: `${name} CLI not found — make sure it is installed and on your PATH` });
    }
    if (err.message === "TIMEOUT") {
      return res.status(504).json({ error: `${provider} CLI timed out (>60s)` });
    }
    console.error("[screen-answer]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── XP / ranking ─────────────────────────────────────────────────────────────

// GET /xp/ranking?limit=10 — top users by XP for one account. Reachable
// either as a logged-in browser (session cookie) or as the OBS overlay
// (?token=... — see getOverlayToken), since this is deliberately excluded
// from the blanket requireApprovedUser gate above.
app.get("/xp/ranking", (req, res) => {
  const user = (req.query.token && findUserByOverlayToken(req.query.token)) || getApprovedUserFromCookieHeader(req.headers.cookie);
  if (!user) return res.status(401).json({ error: "Not authorized" });
  res.json({ ranking: xp.getRanking(user.twitchId, Number(req.query.limit) || 10) });
});

// GET /overlay/xp?token=... — transparent overlay page (add as OBS browser
// source). The page itself is static and carries no account data; the token
// in its query string is what scopes the ranking fetch + WS feed to one account.
app.get("/overlay/xp", (req, res) => {
  res.sendFile(path.join(__dirname, "overlay", "xp.html"));
});

// GET /xp/overlay-url — the logged-in user's own OBS overlay URL, for Settings
// to display with a copy button.
app.get("/xp/overlay-url", (req, res) => {
  const token = getOverlayToken(req.user.twitchId);
  res.json({ url: `${req.protocol}://${req.get("host")}/overlay/xp?token=${token}` });
});

// GET /activity/recent — last 30 Twitch activity events (follows, subs,
// raids, cheers, redeems) for the logged-in account, so the Activity Panel
// has something to show right after a page load/reconnect instead of
// waiting for new live events.
app.get("/activity/recent", (req, res) => {
  res.json({ events: activity.getRecent(req.user.twitchId, 30) });
});

// ── Avatar-swap overlay (OBS alternative to VTube Studio) ────────────────────
// Shows one of two user-uploaded images (speaking/silent) depending on
// whether TTS audio is currently playing, driven over the same /chat WS the
// XP overlay uses ({ type: "tts_state", playing }), broadcast from the
// /lipsync/start and /lipsync/stop handlers below.

// GET /overlay/avatar?token=... — transparent overlay page (OBS browser
// source), public like /overlay/xp since OBS can't send the session cookie.
app.get("/overlay/avatar", (req, res) => {
  res.sendFile(path.join(__dirname, "overlay", "avatar.html"));
});

// GET /overlay/avatar/image?slot=speaking|silent&token=... — serves the
// uploaded image binary. Reachable via overlay token (OBS) or session
// cookie (Settings preview), same pattern as /xp/ranking.
app.get("/overlay/avatar/image", (req, res) => {
  const user = (req.query.token && findUserByOverlayToken(req.query.token)) || getApprovedUserFromCookieHeader(req.headers.cookie);
  if (!user) return res.status(401).json({ error: "Not authorized" });
  const image = avatarOverlay.getImage(user.twitchId, req.query.slot);
  if (!image) return res.status(404).end();
  res.set("Content-Type", image.mime);
  res.set("Cache-Control", "no-store"); // always reflect the latest upload
  res.sendFile(image.filePath);
});

// GET /overlay/avatar/overlay-url — the logged-in user's own avatar overlay
// URL + upload status, for Settings to display (copy button + previews).
app.get("/overlay/avatar/overlay-url", requireApprovedUser, (req, res) => {
  const token = getOverlayToken(req.user.twitchId);
  res.json({
    url: `${req.protocol}://${req.get("host")}/overlay/avatar?token=${token}`,
    token,
    ...avatarOverlay.getStatus(req.user.twitchId),
  });
});

// POST /overlay/avatar/upload — { slot: "speaking"|"silent", dataUrl } —
// dataUrl is a base64 data: URL as produced by FileReader.readAsDataURL,
// mirroring how Settings already reads the settings-export .json file.
app.post("/overlay/avatar/upload", requireApprovedUser, (req, res) => {
  const { slot, dataUrl } = req.body || {};
  try {
    avatarOverlay.saveImage(req.user.twitchId, slot, dataUrl);
    res.json({ ok: true, ...avatarOverlay.getStatus(req.user.twitchId) });
  } catch (err) {
    if (err.message === "BAD_SLOT") return res.status(400).json({ error: "slot must be 'speaking' or 'silent'" });
    if (err.message === "BAD_DATA_URL") return res.status(400).json({ error: "dataUrl is required" });
    if (err.message === "UNSUPPORTED_TYPE") return res.status(400).json({ error: "Image must be JPEG, PNG, GIF, or WebP" });
    if (err.message === "TOO_LARGE") return res.status(413).json({ error: `Image must be under ${avatarOverlay.MAX_BYTES / (1024 * 1024)}MB` });
    console.error("[overlay/avatar/upload]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Chat overlay (messages + Twitch events: follows, subs, raids, cheers) ────
// Purely a display layer over the same /chat WS other overlays use — no new
// data/config storage, all appearance/behavior knobs (colors, size, which
// events to show, banner vs inline, etc.) are read from its own URL query
// string client-side (see backend/overlay/chat.html).

// GET /overlay/chat?token=... — transparent overlay page (OBS browser
// source), public like /overlay/xp and /overlay/video since OBS can't send
// the session cookie.
app.get("/overlay/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "overlay", "chat.html"));
});

// GET /chat-overlay/overlay-url — the logged-in user's own chat overlay URL,
// for Settings to display with a copy button.
app.get("/chat-overlay/overlay-url", requireApprovedUser, (req, res) => {
  const token = getOverlayToken(req.user.twitchId);
  res.json({ url: `${req.protocol}://${req.get("host")}/overlay/chat?token=${token}` });
});

// GET /chat-overlay/config?token=... — current appearance/behavior config.
// Reachable either as a logged-in browser (session cookie, used by the
// ChatOverlayPanel side panel) or as the OBS overlay itself (?token=...),
// same dual-auth pattern as /xp/ranking.
app.get("/chat-overlay/config", (req, res) => {
  const user = (req.query.token && findUserByOverlayToken(req.query.token)) || getApprovedUserFromCookieHeader(req.headers.cookie);
  if (!user) return res.status(401).json({ error: "Not authorized" });
  const config = chatOverlayConfig.getConfig(user.twitchId);
  res.json({ config: { ...config, hasBgImage: chatOverlayBg.hasImage(user.twitchId) } });
});

// POST /chat-overlay/config — logged-in only (the streamer editing their own
// panel). Persists the change and immediately pushes it to any connected
// overlay over the /chat WS, so OBS updates live without a browser-source
// reload.
app.post("/chat-overlay/config", requireApprovedUser, (req, res) => {
  const config = chatOverlayConfig.setConfig(req.user.twitchId, req.body || {});
  const fullConfig = { ...config, hasBgImage: chatOverlayBg.hasImage(req.user.twitchId) };
  broadcastToAccount(req.user.twitchId, { type: "chat_overlay_config", config: fullConfig });
  res.json({ config: fullConfig });
});

// Shared error mapping for the /stream/* routes below — gives the frontend a
// stable string to switch on instead of parsing HTTP status alone (403 could
// mean other things elsewhere in this app).
function handleStreamSettingsError(err, res) {
  if (err.code === "MISSING_SCOPE") return res.status(403).json({ error: "MISSING_SCOPE" });
  if (err.message === "NO_TWITCH_TOKEN") return res.status(401).json({ error: "NO_TWITCH_TOKEN" });
  console.error("[stream-settings]", err.message);
  return res.status(502).json({ error: "TWITCH_API_ERROR" });
}

// GET /stream/categories?query=... — Twitch category search for the Stream
// Settings panel's autocomplete, including box art thumbnails.
app.get("/stream/categories", requireApprovedUser, async (req, res) => {
  const query = (req.query.query || "").trim();
  if (!query) return res.json({ categories: [] });
  try {
    const token = await getValidTwitchToken(req.user.twitchId);
    const categories = await streamSettings.searchCategories(token, query);
    res.json({ categories });
  } catch (err) {
    handleStreamSettingsError(err, res);
  }
});

// GET /stream/info — the logged-in streamer's current live title/category,
// fetched fresh each time rather than cached (it can change from outside
// this panel, e.g. directly on Twitch).
app.get("/stream/info", requireApprovedUser, async (req, res) => {
  try {
    const token = await getValidTwitchToken(req.user.twitchId);
    const info = await streamSettings.getChannelInfo(token, req.user.twitchId);
    res.json(info);
  } catch (err) {
    handleStreamSettingsError(err, res);
  }
});

// POST /stream/settings — { title?, gameId? }; updates whichever of
// title/category was provided, leaving the other unchanged on Twitch.
app.post("/stream/settings", requireApprovedUser, async (req, res) => {
  try {
    const token = await getValidTwitchToken(req.user.twitchId);
    await streamSettings.updateChannelInfo(token, req.user.twitchId, req.body || {});
    res.json({ ok: true });
  } catch (err) {
    handleStreamSettingsError(err, res);
  }
});

// GET /settings — the copy of this account's client-side Settings.jsx
// localStorage blob last synced to the server (see userSettings.js).
app.get("/settings", requireApprovedUser, (req, res) => {
  res.json({ settings: userSettings.getSettings(req.user.twitchId) });
});

// POST /settings — temporary sync shim: the frontend calls this once right
// after login with its current localStorage settings so the SQLite copy
// exists too. See userSettings.js for why this is meant to be removed later.
app.post("/settings", requireApprovedUser, (req, res) => {
  try {
    userSettings.setSettings(req.user.twitchId, req.body || {});
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /chat-overlay/bg-image?token=... — serves the uploaded nine-slice
// background texture. Same dual-auth pattern as /overlay/avatar/image.
app.get("/chat-overlay/bg-image", (req, res) => {
  const user = (req.query.token && findUserByOverlayToken(req.query.token)) || getApprovedUserFromCookieHeader(req.headers.cookie);
  if (!user) return res.status(401).json({ error: "Not authorized" });
  const image = chatOverlayBg.getImage(user.twitchId);
  if (!image) return res.status(404).end();
  res.set("Content-Type", image.mime);
  res.set("Cache-Control", "no-store"); // always reflect the latest upload
  res.sendFile(image.filePath);
});

// POST /chat-overlay/bg-image — { dataUrl } — uploads/replaces the
// background texture, then tells any open overlay to reload it live.
app.post("/chat-overlay/bg-image", requireApprovedUser, (req, res) => {
  const { dataUrl } = req.body || {};
  try {
    chatOverlayBg.saveImage(req.user.twitchId, dataUrl);
    broadcastToAccount(req.user.twitchId, { type: "chat_overlay_bg_updated", hasBgImage: true });
    res.json({ ok: true, hasBgImage: true });
  } catch (err) {
    if (err.message === "BAD_DATA_URL") return res.status(400).json({ error: "dataUrl is required" });
    if (err.message === "UNSUPPORTED_TYPE") return res.status(400).json({ error: "Image must be JPEG, PNG, GIF, or WebP" });
    if (err.message === "TOO_LARGE") return res.status(413).json({ error: `Image must be under ${chatOverlayBg.MAX_BYTES / (1024 * 1024)}MB` });
    console.error("[chat-overlay/bg-image]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /chat-overlay/bg-image — removes the background texture, falling
// back to the plain per-row background.
app.delete("/chat-overlay/bg-image", requireApprovedUser, (req, res) => {
  chatOverlayBg.deleteImage(req.user.twitchId);
  broadcastToAccount(req.user.twitchId, { type: "chat_overlay_bg_updated", hasBgImage: false });
  res.json({ ok: true, hasBgImage: false });
});

// ── Chat overlay test data ────────────────────────────────────────────────
// Lets the streamer preview their overlay settings (fonts, colors, banner,
// nine-slice, etc.) without waiting for real chat activity. Broadcast under
// dedicated WS types (chat_overlay_test_chat / chat_overlay_test_event)
// rather than the real "chat"/"twitch_event" types so this never touches XP,
// !sr parsing, or the AI's event-response trigger — the overlay is the only
// listener that recognizes these types (backend/overlay/chat.html); the main
// app's own WS handler silently ignores unknown types.
const TEST_USERNAMES = ["PixelPanda", "NightOwl99", "CoffeeCat", "ChatGremlin", "StreamSquid", "LurkMaster", "ClipQueen", "ByteBunny", "GG_Wizard", "MoonlitFox"];
const TEST_MESSAGES = [
  "PogChamp this is amazing!", "Can we get a hello?", "LUL that was great", "First time here, loving the stream!",
  "o7", "What game is this?", "Chat is going wild right now", "GGs", "This overlay looks awesome", "Kappa",
];
const TEST_REWARDS = ["Highlight My Message", "Hydrate!", "Sing a Song", "Play a Sound", "Pet the Cat"];
const TEST_COLORS = ["#ff4f4f", "#4fa8ff", "#4fff8f", "#ffd24f", "#c04fff", "#ff4fc0", "#4ffff0"];
// Badge tags in real IRC format so the test path exercises the same
// resolveBadges() code the live feed uses, including the per-theme icons.
const TEST_BADGE_TAGS = ["", "", "subscriber/12", "moderator/1", "vip/1", "broadcaster/1", "founder/0,subscriber/24"];

function randomOf(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Build a test message the same way a real one is built: enrich() resolves it
// against the live emote/badge caches, so a channel's own 7TV/BTTV emotes and
// real badge art show up in previews. The streamer's own twitchId doubles as
// the room id — a Twitch channel's room id IS the broadcaster's user id.
function buildTestMessage(twitchId, extra) {
  return emotes.enrich(
    {
      id: `test-${Date.now()}-${Math.random()}`,
      username: randomOf(TEST_USERNAMES),
      color: randomOf(TEST_COLORS),
      text: "",
      timestamp: Date.now(),
      isRedeem: false,
      isBot: false,
      isAction: false,
      roomId: twitchId,
      badgeTag: randomOf(TEST_BADGE_TAGS),
      emoteTag: "",
      emoteOnly: false,
      ...extra,
    },
    twitchId
  );
}

// POST /chat-overlay/test-message — broadcasts a fake plain chat message.
app.post("/chat-overlay/test-message", requireApprovedUser, (req, res) => {
  const msg = buildTestMessage(req.user.twitchId, { text: randomOf(TEST_MESSAGES) });
  broadcastToAccount(req.user.twitchId, { type: "chat_overlay_test_chat", msg });
  res.json({ ok: true });
});

// POST /chat-overlay/test-redeem — broadcasts a fake channel-point redemption.
app.post("/chat-overlay/test-redeem", requireApprovedUser, (req, res) => {
  const withMessage = Math.random() < 0.5;
  const msg = buildTestMessage(req.user.twitchId, {
    text: withMessage ? randomOf(TEST_MESSAGES) : "",
    isRedeem: true,
    rewardTitle: randomOf(TEST_REWARDS),
  });
  broadcastToAccount(req.user.twitchId, { type: "chat_overlay_test_chat", msg });
  res.json({ ok: true });
});

// POST /chat-overlay/test-event — broadcasts a fake follow/sub/raid/cheer/etc.
app.post("/chat-overlay/test-event", requireApprovedUser, (req, res) => {
  const kind = randomOf(["follow", "sub", "resub", "giftsub", "raid", "cheer"]);
  const username = randomOf(TEST_USERNAMES);
  let event = { kind, username };
  if (kind === "sub") {
    event = { ...event, tier: randomOf(["1000", "2000", "3000"]), isGift: Math.random() < 0.3 };
  } else if (kind === "resub") {
    event = {
      ...event,
      tier: randomOf(["1000", "2000", "3000"]),
      months: 1 + Math.floor(Math.random() * 24),
      streak: Math.random() < 0.5 ? 1 + Math.floor(Math.random() * 12) : null,
      message: Math.random() < 0.5 ? randomOf(TEST_MESSAGES) : "",
    };
  } else if (kind === "giftsub") {
    event = {
      ...event,
      tier: randomOf(["1000", "2000", "3000"]),
      count: 1 + Math.floor(Math.random() * 10),
      isAnonymous: Math.random() < 0.2,
    };
  } else if (kind === "raid") {
    event = { ...event, viewers: 1 + Math.floor(Math.random() * 500) };
  } else if (kind === "cheer") {
    event = {
      ...event,
      bits: randomOf([1, 100, 500, 1000, 5000]),
      message: Math.random() < 0.5 ? randomOf(TEST_MESSAGES) : "",
      isAnonymous: Math.random() < 0.1,
    };
  }
  broadcastToAccount(req.user.twitchId, { type: "chat_overlay_test_event", event });
  res.json({ ok: true, event });
});

// ── YouTube song-request queue + overlay ─────────────────────────────────────
// Site-side queue management (add/remove/skip/default playlist) plus the OBS
// overlay (backend/overlay/video.html) that actually plays the video, synced
// over the same /chat WS both other overlays use ({ type: "video_state" }).

// GET /overlay/video?token=... — transparent overlay page (OBS browser
// source), public like /overlay/xp and /overlay/avatar since OBS can't send
// the session cookie.
app.get("/overlay/video", (req, res) => {
  res.sendFile(path.join(__dirname, "overlay", "video.html"));
});

// GET /video/overlay-url — the logged-in user's own video overlay URL, for
// the site's VideoQueue panel to display with a copy button.
app.get("/video/overlay-url", requireApprovedUser, (req, res) => {
  const token = getOverlayToken(req.user.twitchId);
  res.json({ url: `${req.protocol}://${req.get("host")}/overlay/video?token=${token}` });
});

// POST /video/settings — { viewerRequestsEnabled?, skipDefaultOnRequest? } —
// the two site toggles gating !sr chat requests (never the streamer's own
// site controls, which always work regardless of these).
app.post("/video/settings", requireApprovedUser, (req, res) => {
  const { viewerRequestsEnabled, skipDefaultOnRequest } = req.body || {};
  videoQueue.setSettings(req.user.twitchId, { viewerRequestsEnabled, skipDefaultOnRequest });
  broadcastVideoState(req.user.twitchId);
  res.json({ ok: true });
});

// GET /video/state?token=... — current queue/nowPlaying. Reachable via
// overlay token (OBS) or session cookie (site), same pattern as /xp/ranking.
// If everything is idle (no queue, nothing playing) but a default playlist is
// configured, this kicks off playback immediately — so loading the overlay
// or the site never just sits blank when a default playlist is set.
app.get("/video/state", async (req, res) => {
  const user = (req.query.token && findUserByOverlayToken(req.query.token)) || getApprovedUserFromCookieHeader(req.headers.cookie);
  if (!user) return res.status(401).json({ error: "Not authorized" });
  let state = videoQueue.getState(user.twitchId);
  if (!state.nowPlaying && state.queue.length === 0 && state.defaultPlaylistId) {
    state = await videoQueue.advance(user.twitchId, { refreshDefaultPlaylist: youtube.fetchPlaylistItems });
    broadcastVideoState(user.twitchId);
  }
  res.json(state);
});

// POST /video/queue — { input: url | video id | free-text title } — resolves
// via youtube.resolveInput and enqueues; auto-starts playback if idle.
app.post("/video/queue", requireApprovedUser, async (req, res) => {
  const { input } = req.body || {};
  if (!input) return res.status(400).json({ error: "input is required" });
  try {
    const resolved = await youtube.resolveInput(input);
    const wasIdle = !videoQueue.getState(req.user.twitchId).nowPlaying;
    videoQueue.enqueue(req.user.twitchId, { ...resolved, requestedBy: req.user.login });
    if (wasIdle) await videoQueue.advance(req.user.twitchId, { refreshDefaultPlaylist: youtube.fetchPlaylistItems });
    broadcastVideoState(req.user.twitchId);
    res.json({ ok: true, item: resolved });
  } catch (err) {
    if (err.message === "YOUTUBE_API_KEY_MISSING") {
      return res.status(503).json({ error: "Song search requires YOUTUBE_API_KEY in the backend environment — paste a link instead" });
    }
    console.error("[video/queue]", err.message);
    res.status(400).json({ error: "Couldn't resolve that song" });
  }
});

// DELETE /video/queue/:id — remove one queued item
app.delete("/video/queue/:id", requireApprovedUser, (req, res) => {
  videoQueue.removeFromQueue(req.user.twitchId, req.params.id);
  broadcastVideoState(req.user.twitchId);
  res.json({ ok: true });
});

// POST /video/default-playlist — { input: playlist url | id } — resolves and
// caches the playlist that plays on loop whenever the request queue is empty.
app.post("/video/default-playlist", requireApprovedUser, async (req, res) => {
  const { input } = req.body || {};
  const playlistId = youtube.extractPlaylistId(input || "");
  if (!playlistId) return res.status(400).json({ error: "Couldn't find a playlist ID in that input" });
  try {
    const [items, title] = await Promise.all([
      youtube.fetchPlaylistItems(playlistId),
      youtube.fetchPlaylistTitle(playlistId).catch(() => null), // cosmetic only — don't fail the save over it
    ]);
    videoQueue.setDefaultPlaylist(req.user.twitchId, playlistId, items, title);
    broadcastVideoState(req.user.twitchId);
    res.json({ ok: true, count: items.length });
  } catch (err) {
    if (err.message === "YOUTUBE_API_KEY_MISSING") {
      return res.status(503).json({ error: "Default playlist requires YOUTUBE_API_KEY in the backend environment" });
    }
    console.error("[video/default-playlist]", err.message);
    res.status(400).json({ error: "Couldn't load that playlist" });
  }
});

// POST /video/skip — force-advance to the next queued/default-playlist item
app.post("/video/skip", requireApprovedUser, async (req, res) => {
  await videoQueue.advance(req.user.twitchId, { refreshDefaultPlaylist: youtube.fetchPlaylistItems });
  broadcastVideoState(req.user.twitchId);
  res.json({ ok: true });
});

// POST /video/previous — go back to the last history entry, putting whatever
// is currently playing back at the front of the queue
app.post("/video/previous", requireApprovedUser, (req, res) => {
  videoQueue.previous(req.user.twitchId);
  broadcastVideoState(req.user.twitchId);
  res.json({ ok: true });
});

// POST /video/control — { action: "play" | "pause" } — the overlay applies
// this to the current video without reloading it (see backend/overlay/video.html)
app.post("/video/control", requireApprovedUser, (req, res) => {
  const { action } = req.body || {};
  if (action !== "play" && action !== "pause") return res.status(400).json({ error: "action must be 'play' or 'pause'" });
  videoQueue.setPaused(req.user.twitchId, action === "pause");
  broadcastVideoState(req.user.twitchId);
  res.json({ ok: true });
});

// POST /video/ended?token=... — { videoId } — the overlay reports playback
// finished. videoId is checked against the current nowPlaying so a stale or
// duplicate report (e.g. a slow network retry) can't double-advance the queue.
app.post("/video/ended", async (req, res) => {
  const user = (req.query.token && findUserByOverlayToken(req.query.token)) || getApprovedUserFromCookieHeader(req.headers.cookie);
  if (!user) return res.status(401).json({ error: "Not authorized" });
  const { videoId } = req.body || {};
  const current = videoQueue.getState(user.twitchId).nowPlaying;
  if (current && current.videoId === videoId) {
    await videoQueue.advance(user.twitchId, { refreshDefaultPlaylist: youtube.fetchPlaylistItems });
    broadcastVideoState(user.twitchId);
  }
  res.json({ ok: true });
});

// ── Custom Overlay Builder (frontend/src/OverlayBuilder.jsx) ─────────────────
// Lets the streamer freely place image/text/video layers on a transparent
// 1920x1080 canvas and use the result as an OBS Browser Source. Named
// layouts (backend/overlayLayouts.js) hold the layer list; uploaded media
// (backend/overlayAssets.js) is account-scoped and shared across layouts so
// the same image/video doesn't need re-uploading. The OBS-facing page
// (backend/overlay/custom.html) follows the same static-HTML + overlay-token
// pattern as every other overlay here, with live updates over the shared
// /chat WS.

const overlayVideoTmpDir = path.join(__dirname, "data", "overlayAssets", "tmp");
fs.mkdirSync(overlayVideoTmpDir, { recursive: true });
const overlayVideoUpload = multer({
  dest: overlayVideoTmpDir,
  limits: { fileSize: overlayAssets.MAX_VIDEO_BYTES },
});

// ── Authed builder API (requireApprovedUser via PROTECTED_PREFIXES) ─────────

app.get("/overlay-builder/layouts", (req, res) => {
  res.json({ layouts: overlayLayouts.listLayouts(req.user.twitchId) });
});

app.post("/overlay-builder/layouts", (req, res) => {
  const layout = overlayLayouts.createLayout(req.user.twitchId, req.body?.name);
  res.json({ layout });
});

app.get("/overlay-builder/layouts/:id", (req, res) => {
  const layout = overlayLayouts.getLayout(req.user.twitchId, req.params.id);
  if (!layout) return res.status(404).json({ error: "Not found" });
  res.json({ layout });
});

// PUT /overlay-builder/layouts/:id — { name?, layers? }; broadcasts the new
// layers to any open OBS view of this layout over the /chat WS so it updates
// live without a manual browser-source refresh.
app.put("/overlay-builder/layouts/:id", (req, res) => {
  const layout = overlayLayouts.updateLayout(req.user.twitchId, req.params.id, req.body || {});
  if (!layout) return res.status(404).json({ error: "Not found" });
  const liveToken = getOverlayToken(req.user.twitchId);
  const resolvedLayers = layout.layers.map((l) => (
    l.assetId ? { ...l, assetUrl: `/overlay/custom/asset/${l.assetId}?token=${liveToken}` } : l
  ));
  broadcastToAccount(req.user.twitchId, { type: "custom_overlay_update", layoutId: layout.id, layers: resolvedLayers });
  res.json({ layout });
});

app.delete("/overlay-builder/layouts/:id", (req, res) => {
  overlayLayouts.deleteLayout(req.user.twitchId, req.params.id);
  res.json({ ok: true });
});

// GET /overlay-builder/overlay-url/:layoutId — the OBS Browser Source URL for
// one layout, for the builder's "Copy OBS URL" button. `token` is also
// returned on its own (same value regardless of layoutId — it's per-account)
// so the canvas editor can build asset-preview URLs without a second route.
app.get("/overlay-builder/overlay-url/:layoutId", (req, res) => {
  const token = getOverlayToken(req.user.twitchId);
  res.json({ url: `${req.protocol}://${req.get("host")}/overlay/custom/${req.params.layoutId}?token=${token}`, token });
});

app.get("/overlay-builder/assets", (req, res) => {
  res.json({ assets: overlayAssets.listAssets(req.user.twitchId) });
});

// GET /overlay-builder/latest-activity — most recent event per kind (follow,
// sub, resub, giftsub, raid, cheer, redeem), so the builder can preview
// {follower.username}-style template tokens with real data instead of
// showing the raw placeholder while editing.
app.get("/overlay-builder/latest-activity", (req, res) => {
  res.json({ latestByKind: activity.getLatestByKind(req.user.twitchId) });
});

// POST /overlay-builder/assets — { dataUrl } — image upload, same base64
// pattern as /overlay/avatar/upload.
app.post("/overlay-builder/assets", (req, res) => {
  try {
    const asset = overlayAssets.saveImage(req.user.twitchId, req.body?.dataUrl);
    res.json({ asset });
  } catch (err) {
    if (err.message === "BAD_DATA_URL") return res.status(400).json({ error: "dataUrl is required" });
    if (err.message === "UNSUPPORTED_TYPE") return res.status(400).json({ error: "Image must be JPEG, PNG, GIF, or WebP" });
    if (err.message === "TOO_LARGE") return res.status(413).json({ error: `Image must be under ${overlayAssets.MAX_IMAGE_BYTES / (1024 * 1024)}MB` });
    console.error("[overlay-builder/assets]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /overlay-builder/assets/video — multipart upload (field name "video"),
// real files rather than base64 since videos are far bigger than the
// 10mb JSON body cap comfortably allows.
app.post("/overlay-builder/assets/video", (req, res) => {
  overlayVideoUpload.single("video")(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: `Video must be under ${overlayAssets.MAX_VIDEO_BYTES / (1024 * 1024)}MB` });
      console.error("[overlay-builder/assets/video]", err.message);
      return res.status(400).json({ error: "Upload failed" });
    }
    if (!req.file) return res.status(400).json({ error: "video file is required" });
    try {
      const asset = overlayAssets.saveVideo(req.user.twitchId, req.file.path, req.file.mimetype, req.file.size);
      res.json({ asset });
    } catch (saveErr) {
      if (saveErr.message === "UNSUPPORTED_TYPE") return res.status(400).json({ error: "Video must be MP4 or WebM" });
      if (saveErr.message === "TOO_LARGE") return res.status(413).json({ error: `Video must be under ${overlayAssets.MAX_VIDEO_BYTES / (1024 * 1024)}MB` });
      console.error("[overlay-builder/assets/video]", saveErr.message);
      res.status(500).json({ error: saveErr.message });
    }
  });
});

app.delete("/overlay-builder/assets/:id", (req, res) => {
  overlayAssets.deleteAsset(req.user.twitchId, req.params.id, overlayLayouts.removeAssetEverywhere);
  res.json({ ok: true });
});

// ── Public/dual-auth OBS-facing routes ───────────────────────────────────────

// GET /overlay/custom/:layoutId?token=... — transparent overlay page (OBS
// browser source), public like every other /overlay/* page since OBS can't
// send the session cookie; the token in its query string scopes the data
// fetch + WS feed to one account.
app.get("/overlay/custom/:layoutId", (req, res) => {
  res.sendFile(path.join(__dirname, "overlay", "custom.html"));
});

// GET /overlay/custom/:layoutId/data?token=... — layout name + layers, with
// asset references resolved to fetchable URLs. Dual auth like /xp/ranking.
app.get("/overlay/custom/:layoutId/data", (req, res) => {
  const user = (req.query.token && findUserByOverlayToken(req.query.token)) || getApprovedUserFromCookieHeader(req.headers.cookie);
  if (!user) return res.status(401).json({ error: "Not authorized" });
  const layout = overlayLayouts.getLayout(user.twitchId, req.params.layoutId);
  if (!layout) return res.status(404).json({ error: "Not found" });
  res.json({
    name: layout.name,
    canvas: { w: overlayLayouts.CANVAS_W, h: overlayLayouts.CANVAS_H },
    layers: layout.layers.map((l) => (
      l.assetId ? { ...l, assetUrl: `/overlay/custom/asset/${l.assetId}?token=${req.query.token || ""}` } : l
    )),
    // For text layers using {follower.username}-style tokens (see
    // overlay/custom.html's fillTemplate) — the initial snapshot; live
    // updates arrive over the /chat WS as new events happen.
    latestByKind: activity.getLatestByKind(user.twitchId),
  });
});

// GET /overlay/custom/asset/:assetId?token=... — serves an uploaded
// image/video binary. Dual auth like /overlay/avatar/image. Video responses
// support Range requests (206 Partial Content) so <video> playback/seeking
// in OBS doesn't require downloading the whole file up front — none of the
// other overlays need this since their images are small and never streamed.
app.get("/overlay/custom/asset/:assetId", (req, res) => {
  const user = (req.query.token && findUserByOverlayToken(req.query.token)) || getApprovedUserFromCookieHeader(req.headers.cookie);
  if (!user) return res.status(401).json({ error: "Not authorized" });
  const asset = overlayAssets.getAsset(user.twitchId, req.params.assetId);
  if (!asset) return res.status(404).end();
  res.set("Cache-Control", "no-store");

  if (asset.kind !== "video") {
    res.set("Content-Type", asset.mime);
    return res.sendFile(asset.filePath);
  }

  const stat = fs.statSync(asset.filePath);
  const range = req.headers.range;
  if (!range) {
    res.set({ "Content-Type": asset.mime, "Content-Length": stat.size, "Accept-Ranges": "bytes" });
    return fs.createReadStream(asset.filePath).pipe(res);
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) return res.status(416).set("Content-Range", `bytes */${stat.size}`).end();
  const start = match[1] ? parseInt(match[1], 10) : 0;
  const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
  if (start >= stat.size || end >= stat.size || start > end) {
    return res.status(416).set("Content-Range", `bytes */${stat.size}`).end();
  }
  res.status(206).set({
    "Content-Type": asset.mime,
    "Content-Range": `bytes ${start}-${end}/${stat.size}`,
    "Content-Length": end - start + 1,
    "Accept-Ranges": "bytes",
  });
  fs.createReadStream(asset.filePath, { start, end }).pipe(res);
});

// POST /xp/config — { ignoredUsers: "name1, name2" | [] } — users that earn no XP
app.post("/xp/config", (req, res) => {
  const { ignoredUsers } = req.body || {};
  if (ignoredUsers != null) xp.setIgnored(req.user.twitchId, ignoredUsers);
  res.json({ ok: true });
});

// POST /xp/reset — wipe this account's XP data
app.post("/xp/reset", (req, res) => {
  xp.reset(req.user.twitchId);
  res.json({ ok: true });
});

// POST /xp/test — simulate a chat message to preview the overlay animation
app.post("/xp/test", (req, res) => {
  const { username, text, color } = req.body || {};
  const ev = xp.addMessage(req.user.twitchId, username || "TestUser", text || "hola mundo, este es un mensaje de prueba!", color || "#9147ff");
  if (!ev) return res.json({ ok: true, ignored: true });
  broadcastToAccount(req.user.twitchId, { type: "xp", ...ev });
  res.json({ ok: true, ...ev });
});

// GET /health
app.get("/health", (req, res) => res.json({ ok: true }));


// ── VTube Studio endpoints ────────────────────────────────────────────────────

// Each account's VTS traffic is fully independent (own connection, own idle/
// speaking animation loop, own phoneme scheduler) — see vtubeManager.js.
// Accounts without an approved tunnel have nowhere to send VTS data.
function requireVTubeContext(req, res) {
  const ctx = vtubeManager.getContext(req.user.twitchId);
  if (!ctx) res.status(409).json({ error: "No approved VTube Studio tunnel for this account" });
  return ctx;
}

// GET /vtube/status — { connected, authenticated }
app.get("/vtube/status", (req, res) => {
  const ctx = vtubeManager.getContext(req.user.twitchId);
  res.json(ctx ? ctx.connection.getStatus() : { connected: false, authenticated: false, lastError: "no_tunnel" });
});

// POST /vtube/config — update this account's mouth param / sensitivity
app.post("/vtube/config", (req, res) => {
  const { mouthParam, sensitivity } = req.body;
  const ctx = requireVTubeContext(req, res);
  if (!ctx) return;
  if (mouthParam) ctx.phonemes.setMouthParam(mouthParam);
  if (sensitivity != null) ctx.phonemes.setSensitivity(Number(sensitivity));
  res.json({ ok: true });
});

// POST /vtube/reconnect — manual reconnect trigger for this account's tunnel
app.post("/vtube/reconnect", (req, res) => {
  const ctx = requireVTubeContext(req, res);
  if (!ctx) return;
  ctx.connection.disconnect();
  ctx.connection.connect();
  res.json({ ok: true });
});

// ── Lip-sync endpoints ────────────────────────────────────────────────────────

// POST /vtube/thinking — { active: boolean } — eyes close while Claude generates
app.post("/vtube/thinking", (req, res) => {
  const ctx = vtubeManager.getContext(req.user.twitchId);
  if (ctx) {
    if (req.body.active) ctx.animations.startThinking();
    else ctx.animations.stopThinking();
  }
  res.json({ ok: true });
});

// POST /lipsync/start — { text, durationMs }
app.post("/lipsync/start", (req, res) => {
  const { text, durationMs } = req.body;
  if (!text || !durationMs) return res.status(400).json({ error: "text and durationMs required" });

  // Broadcast regardless of a VTS tunnel — the avatar-swap overlay is
  // specifically for accounts that don't have VTube Studio connected.
  broadcastToAccount(req.user.twitchId, { type: "tts_state", playing: true });

  const ctx = vtubeManager.getContext(req.user.twitchId);
  if (!ctx) return res.json({ ok: true, skipped: "no_tunnel" });

  ctx.animations.startSpeaking();
  ctx.phonemes.schedulePhonemes(text, Number(durationMs));
  res.json({ ok: true });
});

// ── ElevenLabs TTS ────────────────────────────────────────────────────────────

// POST /tts/elevenlabs/voices — { apiKey } → { voices: [{ voice_id, name }] }
app.post("/tts/elevenlabs/voices", async (req, res) => {
  const { apiKey } = req.body || {};
  if (!apiKey) return res.status(400).json({ error: "apiKey is required" });
  try {
    const voices = await elevenlabs.listVoices(apiKey);
    res.json({ voices });
  } catch (err) {
    if (err.message === "ELEVENLABS_UNAUTHORIZED") {
      return res.status(401).json({ error: "ElevenLabs rejected the API key" });
    }
    console.error("[elevenlabs/voices]", err.message);
    res.status(502).json({ error: err.message });
  }
});

// POST /tts/elevenlabs — { text, apiKey, voiceId, modelId? } → audio/mpeg
app.post("/tts/elevenlabs", async (req, res) => {
  const { text, apiKey, voiceId, modelId } = req.body || {};
  if (!text) return res.status(400).json({ error: "text is required" });
  if (!apiKey) return res.status(400).json({ error: "apiKey is required" });
  if (!voiceId) return res.status(400).json({ error: "voiceId is required" });
  try {
    const audio = await elevenlabs.generateSpeech({ text, apiKey, voiceId, modelId });
    res.set("Content-Type", "audio/mpeg");
    res.send(audio);
  } catch (err) {
    if (err.message === "ELEVENLABS_UNAUTHORIZED") {
      return res.status(401).json({ error: "ElevenLabs rejected the API key" });
    }
    console.error("[elevenlabs/tts]", err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── Piper TTS (local CLI) ─────────────────────────────────────────────────────

// GET /tts/piper/voices — { installed, voices: [{ id, name }] }
app.get("/tts/piper/voices", (req, res) => {
  res.json({ installed: piper.isInstalled(), voices: piper.listVoices() });
});

// POST /tts/piper — { text, voice? } → audio/wav
app.post("/tts/piper", async (req, res) => {
  const { text, voice } = req.body || {};
  if (!text) return res.status(400).json({ error: "text is required" });
  try {
    const audio = await piper.generateSpeech({ text, voice });
    res.set("Content-Type", "audio/wav");
    res.send(audio);
  } catch (err) {
    if (err.message === "PIPER_NOT_INSTALLED") {
      return res.status(503).json({ error: "piper.exe not found in projects/piperttsspanish" });
    }
    if (err.message === "PIPER_BAD_VOICE") {
      return res.status(400).json({ error: "Unknown Piper voice (must be a .onnx file in voices/)" });
    }
    console.error("[piper/tts]", err.message);
    res.status(502).json({ error: err.message });
  }
});

// POST /lipsync/stop — cancel timeline and reset mouth
app.post("/lipsync/stop", (req, res) => {
  broadcastToAccount(req.user.twitchId, { type: "tts_state", playing: false });

  const ctx = vtubeManager.getContext(req.user.twitchId);
  if (ctx) {
    ctx.phonemes.cancelSchedule();
    ctx.animations.stopSpeaking();
  }
  res.json({ ok: true });
});

// SPA catch-all — must be registered after every specific API route above so
// it acts only as a fallback for client-side routes ("/", "/admin"). It stays
// public: the guard above only blocks PROTECTED_PREFIXES, and the SPA itself
// does its own client-side /auth/me check.
if (isProd) {
  app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
}

wss.on("connection", (ws, req) => {
  // The OBS overlay (backend/overlay/xp.html) can't send the session cookie —
  // it's a separate CEF instance — so it connects with ?token=... instead
  // (forwarded from its own query string, see xp.html).
  const token = new URL(req.url, "http://internal").searchParams.get("token");
  const user = (token && findUserByOverlayToken(token)) || getApprovedUserFromCookieHeader(req.headers.cookie);
  if (!user) {
    console.log("[ws] rejected unauthenticated connection");
    ws.close(4401, "unauthorized");
    return;
  }
  ws.twitchId = user.twitchId;
  console.log(`[ws] frontend connected (${user.login})`);
  ws.on("close", () => console.log(`[ws] frontend disconnected (${user.login})`));
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.warn(`[server] Port ${PORT} already in use — reusing existing backend`);
  } else {
    console.error("[server] Fatal error:", err.message);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  vtubeManager.bootstrap();
});
