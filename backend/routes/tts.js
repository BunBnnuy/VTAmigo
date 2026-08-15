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
const piper = require("../piper");
const { broadcastToAccount } = require("../sessions");

const router = express.Router();

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

// POST /tts/piper — { text, voice? } → audio/wav
router.post("/tts/piper", async (req, res) => {
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

module.exports = router;
