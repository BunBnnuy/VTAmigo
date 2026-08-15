// Live chat plumbing: connecting/disconnecting the logged-in streamer's own
// Twitch session (chat + EventSub + bot), the TikTok Live client, sending
// messages to chat, and the immediate AI reaction to a Twitch event.
//
// The per-account connection state itself lives in ../sessions.js — these
// handlers only drive it, because the periodic token-refresh job in app.js
// drives the same state too.
//
// Every path here sits under a PROTECTED_PREFIXES entry ("/connect",
// "/disconnect", "/say", "/event-response" — note the prefix match also
// covers the hyphenated "/connect-bot", "/connect-tiktok",
// "/say-as-streamer"), so req.user is already populated by the blanket gate
// in app.js, which is registered before this router is mounted.
const express = require("express");
const { sendEvent } = require("../analytics");
const { queryClaudeCLI, containsPromptLeak } = require("../claude");
const siteConfig = require("../siteConfig");
const { TwitchIRCClient } = require("../twitch");
const { TikTokChatClient } = require("../tiktok");
const sessions = require("../sessions");

const { twitchSessions, broadcast, broadcastToAccount, handleChat, connectTwitchForUser } = sessions;

const router = express.Router();

// POST /connect-bot — (re)connect only the bot client for this user's session, no WS disruption
router.post("/connect-bot", (req, res) => {
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
router.post("/say", (req, res) => {
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

// POST /say-as-streamer — send a message to chat as the logged-in streamer's
// own Twitch account, from the Live Chat panel's typed input (frontend/src/
// ChatFeed.jsx). Uses session.twitchClient, which is otherwise read-only
// (listens for chat via handleChat) — this is the only place it sends.
// Deliberately not wired up for voice-to-text transcripts (see
// VoiceTranscription.js's onTranscript in App.jsx): those stay local/AI-buffer
// only, never posted to chat.
router.post("/say-as-streamer", (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "text is required" });

  const session = twitchSessions.get(req.user.twitchId);
  if (!session || !session.twitchClient) return res.status(503).json({ error: "Not connected to Twitch chat" });
  const sent = session.twitchClient.say(text);
  if (!sent) return res.status(503).json({ error: "Twitch chat WebSocket not open" });

  // Twitch doesn't echo a connection's own PRIVMSG back to itself, so this
  // message would otherwise never reach handleChat/broadcastToAccount — which
  // is what overlay/custom.html listens on for chat-command triggers (see
  // its checkTriggers). Broadcast a synthetic equivalent so the streamer's
  // own typed Live Chat messages can fire broadcaster-tier triggers too.
  broadcastToAccount(req.user.twitchId, {
    type: "chat",
    msg: {
      id: `say-as-streamer-${Date.now()}`,
      username: req.user.login,
      login: req.user.login,
      text,
      color: "#9147ff",
      timestamp: Date.now(),
      badges: [{ type: "broadcaster", version: "1", url: null, description: "broadcaster" }],
      isHype: false,
      isRedeem: false,
      isTyped: true,
    },
  });

  res.json({ ok: true });
});

// POST /connect — connect to the logged-in user's own Twitch channel
router.post("/connect", async (req, res) => {
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
router.post("/disconnect", (req, res) => {
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

// POST /connect-tiktok — connect to a TikTok Live channel
router.post("/connect-tiktok", (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: "username is required" });

  const existing = sessions.getTikTokClient();
  if (existing) existing.disconnect();

  // handleChat's signature is (twitchId, msg). This used to pass only the
  // message, so the message object arrived as twitchId and msg was undefined —
  // every incoming TikTok message threw on `msg.login` instead of reaching the
  // chat feed. Bind it to the account that opened the connection, the same way
  // the Twitch path does in sessions.js.
  const twitchId = req.user.twitchId;

  const client = new TikTokChatClient({
    username,
    onMessage: (msg) => handleChat(twitchId, msg),
    onStatus: (status) => broadcast({ type: "tiktok_status", status }),
  });
  sessions.setTikTokClient(client);
  client.connect();

  res.json({ ok: true, username });
});

// POST /disconnect-tiktok — disconnect from TikTok Live
router.post("/disconnect-tiktok", (req, res) => {
  const existing = sessions.getTikTokClient();
  if (existing) { existing.disconnect(); sessions.setTikTokClient(null); }
  res.json({ ok: true });
});

// POST /event-response — generate an immediate Claude reaction to a Twitch event
router.post("/event-response", async (req, res) => {
  const { event, basePrompt } = req.body;
  if (!event) return res.status(400).json({ error: "event is required" });
  const provider = siteConfig.getProvider();
  try {
    const response = await queryClaudeCLI([], "auto", basePrompt || "", event, provider, req.user?.twitchId);
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

module.exports = router;
