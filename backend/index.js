const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const http = require("http");
const path = require("path");
const { WebSocketServer, WebSocket } = require("ws");
const { router: authRouter, requireApprovedUser, getApprovedUserFromCookieHeader, getValidTwitchToken, readUsers } = require("./auth");
const { sendEvent } = require("./analytics");
const { router: adminRouter } = require("./adminAuth");
const { router: devicesRouter, getApprovedDeviceForUser } = require("./devices");
const { queryClaudeCLI, queryYouTubeNarration, queryScreenAnswer, importMemory } = require("./claude");
const memoryExport = require("./memoryExport");
const screenwatch = require("./screenwatch");
const { TwitchIRCClient } = require("./twitch");
const { EventSubClient } = require("./eventsub");
const { TikTokChatClient } = require("./tiktok");
const { fetchRandomStory } = require("./reddit");
const vtube = require("./vtube");
const phonemes = require("./phonemes");
const animations = require("./animations");
const xp = require("./xp");
const elevenlabs = require("./elevenlabs");
const piper = require("./piper");

const PORT = 3001;
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: "5mb" })); // memory .md imports can be large

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
  "/screenwatch", "/screen-answer", "/xp", "/vtube", "/lipsync", "/tts",
];
app.use((req, res, next) => {
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
  broadcastToAccount(twitchId, { type: "chat", msg });
  if (msg.username && msg.text) {
    const ev = xp.addMessage(msg.username, msg.text, msg.color);
    if (ev && ev.gained > 0) broadcastToAccount(twitchId, { type: "xp", ...ev });
  }
}

// POST /respond — run Claude CLI with a batch of messages
app.post("/respond", async (req, res) => {
  const { messages, style, basePrompt, provider, manual } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array is required" });
  }

  sendEvent("ai_response_generated", { req, twitchLogin: req.user?.login, data: { provider: provider || "claude" } });
  if (manual) sendEvent("now_button_click", { req, twitchLogin: req.user?.login });

  try {
    const response = await queryClaudeCLI(messages, style || "auto", basePrompt || "", null, null, null, provider || "claude");
    res.json({ response });
  } catch (err) {
    if (err.message === "OPENAI_API_KEY_MISSING") {
      return res.status(503).json({ error: "ChatGPT requires OPENAI_API_KEY in the backend environment" });
    }
    if (err.message === "CLI_NOT_FOUND") {
      const name = (provider || "claude").charAt(0).toUpperCase() + (provider || "claude").slice(1);
      return res.status(503).json({ error: `${name} CLI not found — make sure it is installed and on your PATH` });
    }
    if (err.message === "TIMEOUT") {
      return res.status(504).json({ error: `${provider || "claude"} CLI timed out (>60s)` });
    }
    console.error("[ai]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /memory/export — start exporting one provider's session memory to another
app.post("/memory/export", (req, res) => {
  const { from, to } = req.body || {};
  try {
    memoryExport.startExport(from, to);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /memory/export/status — progress of the current/last export job
app.get("/memory/export/status", (req, res) => {
  res.json(memoryExport.getStatus());
});

// POST /memory/import — load a hand-picked .md file into a provider's live session
app.post("/memory/import", async (req, res) => {
  const { provider, markdown } = req.body || {};
  try {
    const response = await importMemory(markdown, provider || "claude");
    sendEvent("memory_upload", { req, twitchLogin: req.user?.login, data: { provider: provider || "claude" } });
    res.json({ ok: true, response });
  } catch (err) {
    if (err.message === "MEMORY_EMPTY") {
      return res.status(400).json({ error: "El archivo .md está vacío" });
    }
    if (err.message === "CLI_NOT_FOUND") {
      return res.status(503).json({ error: `${provider || "claude"} CLI no encontrado` });
    }
    if (err.message === "TIMEOUT") {
      return res.status(504).json({ error: `${provider || "claude"} CLI tardó demasiado (>60s)` });
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

  const session = twitchSessions.get(req.user.twitchId);
  if (!session || !session.botClient) return res.status(503).json({ error: "Bot not connected — add bot credentials in Settings" });
  const sent = session.botClient.say(text);
  if (!sent) return res.status(503).json({ error: "Bot WebSocket not open" });
  res.json({ ok: true });
});

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

  const session = { login: channel, twitchClient: null, botClient: null, eventSubClient: null, accessToken: token, botCreds: { botUsername: botUsername || null, botToken: botToken || null } };

  // Bot client — separate user that can send messages, unchanged/manual
  if (botUsername && botToken) {
    session.botClient = new TwitchIRCClient({
      channel,
      token: botToken,
      username: botUsername,
      onMessage: () => {}, // don't echo bot's own messages
      onStatus: (status) => broadcastToAccount(twitchId, { type: "bot_status", status }),
    });
    session.botClient.connect();
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
    onRedeem: (redeem) => broadcastToAccount(twitchId, { type: "chat", msg: redeem }),
    onEvent: (event) => broadcastToAccount(twitchId, { type: "twitch_event", event }),
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
  const { paragraph, title, subreddit, basePrompt, provider } = req.body || {};
  if (!paragraph) return res.status(400).json({ error: "paragraph is required" });
  try {
    const response = await queryClaudeCLI([], "auto", basePrompt || "", null, null, { paragraph, title, subreddit }, provider || "claude");
    res.json({ response });
  } catch (err) {
    if (err.message === "OPENAI_API_KEY_MISSING") {
      return res.status(503).json({ error: "ChatGPT requires OPENAI_API_KEY in the backend environment" });
    }
    if (err.message === "CLI_NOT_FOUND") {
      const name = (provider || "claude").charAt(0).toUpperCase() + (provider || "claude").slice(1);
      return res.status(503).json({ error: `${name} CLI not found — make sure it is installed and on your PATH` });
    }
    if (err.message === "TIMEOUT") return res.status(504).json({ error: "Claude CLI timed out" });
    console.error("[reddit-thoughts]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /event-response — generate an immediate Claude reaction to a Twitch event
app.post("/event-response", async (req, res) => {
  const { event, basePrompt, provider } = req.body;
  if (!event) return res.status(400).json({ error: "event is required" });
  try {
    const response = await queryClaudeCLI([], "auto", basePrompt || "", event, null, null, provider || "claude");
    res.json({ response });
  } catch (err) {
    if (err.message === "OPENAI_API_KEY_MISSING") {
      return res.status(503).json({ error: "ChatGPT requires OPENAI_API_KEY in the backend environment" });
    }
    if (err.message === "CLI_NOT_FOUND") {
      const name = (provider || "claude").charAt(0).toUpperCase() + (provider || "claude").slice(1);
      return res.status(503).json({ error: `${name} CLI not found — make sure it is installed and on your PATH` });
    }
    if (err.message === "TIMEOUT") {
      return res.status(504).json({ error: `${provider || "claude"} CLI timed out (>60s)` });
    }
    console.error("[ai/event]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /youtube-narrate — Claude looks at the YouTube tab and narrates what's playing
app.post("/youtube-narrate", async (req, res) => {
  const { basePrompt } = req.body || {};
  try {
    const response = await queryYouTubeNarration(basePrompt || "");
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
  const { question, options, messages, basePrompt, provider, windowSec } = req.body || {};
  if (!question) return res.status(400).json({ error: "question is required" });
  try {
    const result = await queryScreenAnswer({
      question,
      options: Array.isArray(options) ? options : [],
      messages: Array.isArray(messages) ? messages : [],
      basePrompt: basePrompt || "",
      provider: provider || "claude",
      windowSec: Number(windowSec) || 20,
    });
    // { response, choiceIndex, topVoteIndex }
    res.json(result);
  } catch (err) {
    if (err.message === "OPENAI_API_KEY_MISSING") {
      return res.status(503).json({ error: "ChatGPT requires OPENAI_API_KEY in the backend environment" });
    }
    if (err.message === "CLI_NOT_FOUND") {
      const name = (provider || "claude").charAt(0).toUpperCase() + (provider || "claude").slice(1);
      return res.status(503).json({ error: `${name} CLI not found — make sure it is installed and on your PATH` });
    }
    if (err.message === "TIMEOUT") {
      return res.status(504).json({ error: `${provider || "claude"} CLI timed out (>60s)` });
    }
    console.error("[screen-answer]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── XP / ranking ─────────────────────────────────────────────────────────────

// GET /xp/ranking?limit=10 — top users by XP
app.get("/xp/ranking", (req, res) => {
  res.json({ ranking: xp.getRanking(Number(req.query.limit) || 10) });
});

// GET /overlay/xp — transparent overlay page (add as OBS browser source)
app.get("/overlay/xp", (req, res) => {
  res.sendFile(path.join(__dirname, "overlay", "xp.html"));
});

// POST /xp/config — { ignoredUsers: "name1, name2" | [] } — users that earn no XP
app.post("/xp/config", (req, res) => {
  const { ignoredUsers } = req.body || {};
  if (ignoredUsers != null) xp.setIgnored(ignoredUsers);
  res.json({ ok: true });
});

// POST /xp/reset — wipe all XP data
app.post("/xp/reset", (req, res) => {
  xp.reset();
  res.json({ ok: true });
});

// POST /xp/test — simulate a chat message to preview the overlay animation
app.post("/xp/test", (req, res) => {
  const { username, text, color } = req.body || {};
  const ev = xp.addMessage(username || "TestUser", text || "hola mundo, este es un mensaje de prueba!", color || "#9147ff");
  if (!ev) return res.json({ ok: true, ignored: true });
  broadcast({ type: "xp", ...ev });
  res.json({ ok: true, ...ev });
});

// GET /health
app.get("/health", (req, res) => res.json({ ok: true }));


// ── VTube Studio endpoints ────────────────────────────────────────────────────

// GET /vtube/status — { connected, authenticated }
app.get("/vtube/status", (req, res) => res.json(vtube.getStatus()));

// POST /vtube/config — update VTS connection settings and reconnect if URL changed
app.post("/vtube/config", (req, res) => {
  const { url, pluginName, mouthParam, sensitivity } = req.body;
  if (url || pluginName) vtube.setConfig({ url, pluginName });
  if (mouthParam) phonemes.setMouthParam(mouthParam);
  if (sensitivity != null) phonemes.setSensitivity(Number(sensitivity));
  res.json({ ok: true });
});

// POST /vtube/reconnect — manual reconnect trigger
app.post("/vtube/reconnect", (req, res) => {
  vtube.disconnect();
  vtube.connect();
  res.json({ ok: true });
});

// ── Lip-sync endpoints ────────────────────────────────────────────────────────

// POST /vtube/thinking — { active: boolean } — eyes close while Claude generates
app.post("/vtube/thinking", (req, res) => {
  if (req.body.active) animations.startThinking();
  else animations.stopThinking();
  res.json({ ok: true });
});

// ── Lip-sync endpoints ────────────────────────────────────────────────────────

// POST /lipsync/start — { text, durationMs }
app.post("/lipsync/start", (req, res) => {
  const { text, durationMs } = req.body;
  if (!text || !durationMs) return res.status(400).json({ error: "text and durationMs required" });

  // Route mouth movement to the logged-in user's own tunnel, not whatever
  // VTS connection happens to be currently configured. If they don't have
  // an approved tunnel, there's nowhere to send it — skip silently.
  const device = getApprovedDeviceForUser(req.user.twitchId);
  if (!device) return res.json({ ok: true, skipped: "no_tunnel" });

  vtube.setConfig({ url: `ws://localhost:${device.assignedPort}` });
  animations.startSpeaking();
  phonemes.schedulePhonemes(text, Number(durationMs));
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
  phonemes.cancelSchedule();
  animations.stopSpeaking();
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
  const user = getApprovedUserFromCookieHeader(req.headers.cookie);
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
});
