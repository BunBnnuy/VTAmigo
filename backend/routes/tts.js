// Text-to-speech: the local Piper CLI voices, and the two routes that tell an
// account's avatar overlay whether TTS audio is currently playing.
//
// Both halves belong to the same "the bot is talking" moment — the frontend
// player calls /avatar/speaking/start right before it plays a Piper clip and
// /avatar/speaking/stop when it ends — which is why they share a router even
// though the avatar *images* are served by routes/overlays.js.
//
// "/avatar" and "/tts" are both PROTECTED_PREFIXES entries, so req.user is
// already populated by the blanket gate in app.js, which is registered before
// this router is mounted. backend/test/purge.test.js depends on that gate
// answering 401 for the removed /tts/elevenlabs* routes.
const express = require("express");
const path = require("path");
const piper = require("../piper");
const { aiLimiter } = require("../rateLimits");
const { getApprovedUserFromCookieHeader, findUserByOverlayToken } = require("../auth");
const { broadcastToAccount } = require("../sessions");

const router = express.Router();

// Resolves who an OBS-facing route is acting for — `?token=` overlay token OR
// the streamer's session cookie, same dual auth as /xp/ranking and
// /overlay/custom/*. The OBS Browser Source is a separate CEF instance with no
// access to the session cookie, so token is the normal path.
function overlayUser(req) {
  return (req.query.token && findUserByOverlayToken(req.query.token)) || getApprovedUserFromCookieHeader(req.headers.cookie);
}

function clampNum(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// One mapping for every Piper failure so /tts/piper and /overlay/tts/piper
// answer identically.
function sendPiperError(res, err) {
  if (err.message === "PIPER_BUSY") return res.status(429).json({ error: "TTS is busy, try again shortly" });
  if (err.message === "PIPER_TEXT_TOO_LONG") return res.status(400).json({ error: `Text too long (max ${piper.MAX_TEXT_CHARS} characters)` });
  if (err.message === "PIPER_NOT_INSTALLED") return res.status(503).json({ error: "piper.exe not found in projects/piperttsspanish" });
  if (err.message === "PIPER_BAD_VOICE") return res.status(400).json({ error: "Unknown Piper voice (must be a .onnx file in voices/)" });
  console.error("[piper/tts]", err.message);
  res.status(502).json({ error: err.message });
}

// ── Avatar speaking state ─────────────────────────────────────────────────────
//
// These two routes are the *only* driver of the avatar-swap overlay
// (backend/overlay/avatar.html): it flips between the uploaded speaking and
// silent images purely on the { type: "tts_state", playing } messages
// broadcast here over the /chat WS. The frontend TTS player calls start
// right before it plays a clip and stop when playback ends or is cancelled.
//
// They used to be POST /lipsync/start|stop and also drove VTube Studio (mouth
// phonemes + head-bob animations) through a per-account VTS tunnel — a
// leftover from the single-streamer Windows desktop build, where the backend
// ran on the streamer's own PC next to VTube Studio. The hosted multi-account
// site can't reach anyone's local VTS, so that half is gone; the broadcast,
// which every account's overlay depends on, is not.

// POST /avatar/speaking/start — { text, durationMs } — tells this account's
// avatar overlay to show the "speaking" image.
router.post("/avatar/speaking/start", (req, res) => {
  const { text, durationMs } = req.body || {};
  if (!text || !durationMs) return res.status(400).json({ error: "text and durationMs required" });

  broadcastToAccount(req.user.twitchId, { type: "tts_state", playing: true });
  res.json({ ok: true });
});

// POST /avatar/speaking/stop — back to the "silent" image.
router.post("/avatar/speaking/stop", (req, res) => {
  broadcastToAccount(req.user.twitchId, { type: "tts_state", playing: false });
  res.json({ ok: true });
});

// ── Piper TTS (local CLI) ─────────────────────────────────────────────────────

// GET /tts/piper/voices — { installed, voices: [{ id, name }] }
router.get("/tts/piper/voices", (req, res) => {
  res.json({ installed: piper.isInstalled(), voices: piper.listVoices() });
});

// POST /tts/piper — { text, voice? } → audio/wav. Shares aiLimiter (5/min
// per IP) with POST /respond: each call spawns the local Piper exe.
router.post("/tts/piper", aiLimiter, async (req, res) => {
  const { text, voice } = req.body || {};
  if (!text) return res.status(400).json({ error: "text is required" });
  try {
    const audio = await piper.generateSpeech({ text, voice });
    res.set("Content-Type", "audio/wav");
    res.send(audio);
  } catch (err) {
    sendPiperError(res, err);
  }
});

// ── Voice overlay (OBS browser source) ───────────────────────────────────────
//
// The separate "bot voice" overlay plays the AI's TTS inside OBS, so the
// streamer no longer has to capture the app window's audio. The app POSTs the
// response text to /tts/speak (session-authed, under the "/tts" prefix); that
// broadcasts a {type:"tts_speak"} event to the account, and overlay/voice.html
// queues it, speaks it (browser voices first, Piper as the fallback that
// actually exists inside OBS's CEF), and reports the audible window back so
// the avatar overlay keeps mouth-syncing.

// POST /tts/speak — { text, voiceURI, piperVoice, rate, volume, forcePiper }
router.post("/tts/speak", (req, res) => {
  const { text, voiceURI, piperVoice, rate, volume, forcePiper } = req.body || {};
  const clean = typeof text === "string" ? text.trim() : "";
  if (!clean) return res.status(400).json({ error: "text is required" });

  broadcastToAccount(req.user.twitchId, {
    type: "tts_speak",
    text: clean.slice(0, piper.MAX_TEXT_CHARS),
    voiceURI: voiceURI || null,
    piperVoice: piperVoice || null,
    rate: clampNum(rate, 0.5, 2, 1),
    volume: clampNum(volume, 0, 1, 1),
    forcePiper: !!forcePiper,
  });
  res.json({ ok: true });
});

// POST /tts/skip — the app's Skip button, when the voice overlay is the active
// output: tell the overlay to drop its queue and stop the current clip.
router.post("/tts/skip", (req, res) => {
  broadcastToAccount(req.user.twitchId, { type: "tts_skip" });
  res.json({ ok: true });
});

// POST /tts/chat-speak — the separate chat-command TTS queue ("!tts ..."). Same
// payload as /tts/speak but broadcast as its own message type, so the Chat TTS
// overlay source and the bot-voice overlay never play each other's lines.
router.post("/tts/chat-speak", (req, res) => {
  const { text, voiceURI, piperVoice, rate, volume, forcePiper } = req.body || {};
  const clean = typeof text === "string" ? text.trim() : "";
  if (!clean) return res.status(400).json({ error: "text is required" });

  broadcastToAccount(req.user.twitchId, {
    type: "chat_tts_speak",
    text: clean.slice(0, piper.MAX_TEXT_CHARS),
    voiceURI: voiceURI || null,
    piperVoice: piperVoice || null,
    rate: clampNum(rate, 0.5, 2, 1),
    volume: clampNum(volume, 0, 1, 1),
    forcePiper: !!forcePiper,
  });
  res.json({ ok: true });
});

// POST /tts/chat-skip — chat TTS has no skip button, but disabling it (or a
// mute) should silence a clip already queued on the overlay.
router.post("/tts/chat-skip", (req, res) => {
  broadcastToAccount(req.user.twitchId, { type: "chat_tts_skip" });
  res.json({ ok: true });
});

// GET /overlay/voice — the transparent OBS page itself.
router.get("/overlay/voice", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "overlay", "voice.html"));
});

// GET /overlay/chat-tts — the chat-command TTS overlay page.
router.get("/overlay/chat-tts", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "overlay", "chat-tts.html"));
});

// POST /overlay/tts/piper?token=... — { text, voice } → audio/wav. The voice
// overlay's fallback engine when the OBS browser engine has no
// speechSynthesis voices. Not behind aiLimiter: OBS shares one IP and a
// streamer can legitimately speak far more than 5 clips/min — Piper's own
// concurrency cap (PIPER_BUSY) is the real backpressure here.
router.post("/overlay/tts/piper", async (req, res) => {
  const user = overlayUser(req);
  if (!user) return res.status(401).json({ error: "Not authorized" });
  const { text, voice } = req.body || {};
  if (!text) return res.status(400).json({ error: "text is required" });
  try {
    const audio = await piper.generateSpeech({ text, voice });
    res.set("Content-Type", "audio/wav");
    res.send(audio);
  } catch (err) {
    sendPiperError(res, err);
  }
});

// POST /overlay/tts/speaking/start|stop?token=... — the voice overlay brackets
// the audible window so the avatar overlay swaps to its speaking image at the
// same moment the app's own player used to (see /avatar/speaking/* above).
router.post("/overlay/tts/speaking/start", (req, res) => {
  const user = overlayUser(req);
  if (!user) return res.status(401).json({ error: "Not authorized" });
  broadcastToAccount(user.twitchId, { type: "tts_state", playing: true });
  res.json({ ok: true });
});

router.post("/overlay/tts/speaking/stop", (req, res) => {
  const user = overlayUser(req);
  if (!user) return res.status(401).json({ error: "Not authorized" });
  broadcastToAccount(user.twitchId, { type: "tts_state", playing: false });
  res.json({ ok: true });
});

module.exports = router;
