// KittenTTS — local offline neural voices through a persistent Python worker
// (see backend/kitten/worker.py and backend/ttsWorker.js).
//
// Only the lightweight ONNX model family is exposed. KittenTTS 2 (the 1.7B
// multilingual model) needs ~2.3 GB RSS and 70-80 s per short sentence on this
// box's CPU, which does not fit the backend's 2 GB cgroup or a streamer's
// patience; KITTEN_MODEL is still overridable for a host that can afford it.
//
// The 0.8 ONNX models are English-only. Spanish streamers should pick Kokoro
// (backend/kokoro.js) or Piper.

const path = require("path");
const { createWorkerEngine } = require("./ttsWorker");

const DIR = process.env.KITTEN_DIR || path.join(__dirname, "kitten");

// The eight speakers shipped with every 0.8 ONNX model.
const VOICES = ["Bella", "Jasper", "Luna", "Bruno", "Rosie", "Hugo", "Kiki", "Leo"];

module.exports = createWorkerEngine({
  code: "KITTEN",
  label: "KittenTTS",
  dir: DIR,
  python: process.env.KITTEN_PYTHON || path.join(DIR, ".venv", "bin", "python"),
  // Keep Hugging Face downloads inside the checkout instead of the service
  // user's home directory: one model copy per instance, easy to inspect and
  // remove, and no surprise 80 MB in ~/.cache after the first request.
  cacheDir: process.env.KITTEN_CACHE_DIR || path.join(DIR, "models"),
  defaultVoice: process.env.KITTEN_DEFAULT_VOICE || "Luna",
  voices: VOICES.map((id) => ({ id, name: id })),
  // First request may have to download the model from Hugging Face.
  startupTimeoutMs: Number(process.env.KITTEN_STARTUP_TIMEOUT_MS) || 180000,
  // Long lines take ~1.5x realtime on CPU; 1000 chars is ~70 s of audio.
  requestTimeoutMs: Number(process.env.KITTEN_REQUEST_TIMEOUT_MS) || 180000,
  // Free the ~230 MB worker when nobody has spoken for a while.
  idleShutdownMs: Number(process.env.KITTEN_IDLE_MS) || 10 * 60 * 1000,
  extraEnv: {
    HF_HOME: process.env.KITTEN_CACHE_DIR || path.join(DIR, "models"),
    HF_HUB_DISABLE_TELEMETRY: "1",
    KITTEN_MODEL: process.env.KITTEN_MODEL || "KittenML/kitten-tts-mini-0.8",
    KITTEN_DEFAULT_VOICE: process.env.KITTEN_DEFAULT_VOICE || "Luna",
    // Experimental: "es" makes the English ONNX voice read Spanish phonemes.
    // Unset keeps the stock en-us G2P.
    KITTEN_LANGUAGE: process.env.KITTEN_LANGUAGE || "en-us",
    KITTEN_MAX_TEXT_CHARS: "1000",
  },
});
