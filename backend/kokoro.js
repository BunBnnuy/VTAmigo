// Kokoro-82M — local offline neural voices with official Spanish support
// (see backend/kokoro/worker.py and backend/ttsWorker.js).
//
// This is the provider to pick for Spanish: KittenTTS's lightweight ONNX
// models are English-only, while Kokoro ships three Spanish speakers
// (ef_dora, em_alex, em_santa) under Apache 2.0.
//
// fp32 (`kokoro-v1.0.onnx`, 311 MB, ~640 MB RSS) is the default because the
// int8 export measured ~3x slower on this CPU (10 s vs 3-4 s per sentence).
// The voice list is deliberately short — Spanish plus the most useful English
// speakers — since every extra language adds a dropdown entry; extend VOICES
// here (and in worker.py's FALLBACK_VOICES) to expose more of the 54.

const path = require("path");
const { createWorkerEngine } = require("./ttsWorker");

const DIR = process.env.KOKORO_DIR || path.join(__dirname, "kokoro");
const MODEL_PATH = process.env.KOKORO_MODEL || path.join(DIR, "models", "kokoro-v1.0.onnx");
const VOICES_PATH = process.env.KOKORO_VOICES || path.join(DIR, "models", "voices-v1.0.bin");

const VOICES = [
  { id: "ef_dora", name: "Dora · ES" },
  { id: "em_alex", name: "Alex · ES" },
  { id: "em_santa", name: "Santa · ES" },
  { id: "af_heart", name: "Heart · EN-US" },
  { id: "af_bella", name: "Bella · EN-US" },
  { id: "af_nova", name: "Nova · EN-US" },
  { id: "am_michael", name: "Michael · EN-US" },
  { id: "am_fenrir", name: "Fenrir · EN-US" },
  { id: "bf_emma", name: "Emma · EN-GB" },
  { id: "bm_george", name: "George · EN-GB" },
];

module.exports = createWorkerEngine({
  code: "KOKORO",
  label: "Kokoro",
  dir: DIR,
  python: process.env.KOKORO_PYTHON || path.join(DIR, ".venv", "bin", "python"),
  cacheDir: path.join(DIR, "models"),
  defaultVoice: process.env.KOKORO_DEFAULT_VOICE || "ef_dora",
  voices: VOICES,
  // Unlike KittenTTS, the model is downloaded by setup.sh, not on first use:
  // 311 MB is too much to fetch inside a live request.
  requiredFiles: [MODEL_PATH, VOICES_PATH],
  startupTimeoutMs: Number(process.env.KOKORO_STARTUP_TIMEOUT_MS) || 60000,
  requestTimeoutMs: Number(process.env.KOKORO_REQUEST_TIMEOUT_MS) || 120000,
  idleShutdownMs: Number(process.env.KOKORO_IDLE_MS) || 10 * 60 * 1000,
  extraEnv: {
    KOKORO_MODEL: MODEL_PATH,
    KOKORO_VOICES: VOICES_PATH,
    KOKORO_DEFAULT_VOICE: process.env.KOKORO_DEFAULT_VOICE || "ef_dora",
    KOKORO_MAX_TEXT_CHARS: "1000",
  },
});
