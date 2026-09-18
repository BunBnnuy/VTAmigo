// Piper TTS — local offline Spanish voices (see projects/piperttsspanish).
// piper.exe is a CLI: text on stdin → WAV file. We write to a temp file rather
// than stdout (`-f -`) because on Windows the child's stdout is text-mode and
// rewrites 0x0A audio bytes to 0x0D 0x0A, corrupting the PCM stream (audible noise).

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// PIPER_DIR/PIPER_EXE can be overridden via env (used on Linux deployments —
// see setup/piper.sh). Falls back to the Windows dev layout.
const PIPER_DIR =
  process.env.PIPER_DIR ||
  (process.platform === "win32"
    ? "C:/Users/beton/projects/piperttsspanish"
    : path.join(__dirname, "piper"));
const PIPER_EXE =
  process.env.PIPER_EXE ||
  path.join(PIPER_DIR, "piper", process.platform === "win32" ? "piper.exe" : "piper");
const VOICES_DIR = process.env.PIPER_VOICES_DIR || path.join(PIPER_DIR, "voices");
const DEFAULT_VOICE = process.env.PIPER_DEFAULT_VOICE || "es_MX-claude-14947-epoch-high.onnx";

// Abuse caps (Issue 2): Piper spawns a local exe per request — CPU-heavy, and
// unbounded concurrency would wedge the host. At most MAX_CONCURRENT_JOBS
// generations run at once; the rest get PIPER_BUSY (mapped to 429 by the
// route) instead of queueing forever. Text is capped at MAX_TEXT_CHARS
// (PIPER_TEXT_TOO_LONG, mapped to 400) so one request can't hold a slot for
// minutes. tryAcquireSlot/releaseSlot are exported for the abuse-limit test
// suite, which needs to occupy slots without a Piper binary installed.
const MAX_CONCURRENT_JOBS = 2;
const MAX_TEXT_CHARS = 1000;
let activeJobs = 0;

function tryAcquireSlot() {
  if (activeJobs >= MAX_CONCURRENT_JOBS) return false;
  activeJobs += 1;
  return true;
}

function releaseSlot() {
  activeJobs = Math.max(0, activeJobs - 1);
}

function isInstalled() {
  return fs.existsSync(PIPER_EXE);
}

// Returns [{ id, name }] — id is the .onnx filename, name a prettified label
function listVoices() {
  if (!fs.existsSync(VOICES_DIR)) return [];
  return fs
    .readdirSync(VOICES_DIR)
    .filter((f) => f.endsWith(".onnx"))
    .map((f) => ({
      id: f,
      name: f.replace(/\.onnx$/, ""),
    }));
}

// Returns a Buffer of WAV audio
function generateSpeech({ text, voice }) {
  return new Promise((resolve, reject) => {
    if (!text) return reject(new Error("TEXT_REQUIRED"));
    if (text.length > MAX_TEXT_CHARS) return reject(new Error("PIPER_TEXT_TOO_LONG"));

    // Saturation is checked before anything that needs the binary: a host
    // with no Piper installed still has a bounded number of slots, and a
    // caller holding all of them must see PIPER_BUSY, not PIPER_NOT_INSTALLED.
    // The slot is released on every early rejection below so it never leaks.
    if (!tryAcquireSlot()) return reject(new Error("PIPER_BUSY"));
    if (!isInstalled()) {
      releaseSlot();
      return reject(new Error("PIPER_NOT_INSTALLED"));
    }

    const voiceFile = voice || DEFAULT_VOICE;
    // Voice id comes from the frontend — keep it to a bare filename inside voices/
    if (voiceFile.includes("/") || voiceFile.includes("\\") || !voiceFile.endsWith(".onnx")) {
      releaseSlot();
      return reject(new Error("PIPER_BAD_VOICE"));
    }
    const modelPath = path.join(VOICES_DIR, voiceFile);
    if (!fs.existsSync(modelPath)) {
      releaseSlot();
      return reject(new Error("PIPER_BAD_VOICE"));
    }

    // Every settle path below must go through done(), or the slot leaks and
    // the cap degrades to a permanent outage after two failures.
    const done = (fn) => (value) => {
      releaseSlot();
      fn(value);
    };
    const resolveDone = done(resolve);
    const rejectDone = done(reject);

    const outPath = path.join(os.tmpdir(), `piper-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
    const proc = spawn(PIPER_EXE, ["-m", modelPath, "-f", outPath], { cwd: PIPER_DIR });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", (err) => rejectDone(err));
    proc.on("close", (code) => {
      try {
        if (code !== 0) {
          return rejectDone(new Error(`Piper exited with code ${code}: ${stderr.slice(-300)}`));
        }
        resolveDone(fs.readFileSync(outPath));
      } catch (err) {
        rejectDone(err);
      } finally {
        fs.rm(outPath, { force: true }, () => {});
      }
    });
    proc.stdin.write(text);
    proc.stdin.end();
  });
}

module.exports = { isInstalled, listVoices, generateSpeech, DEFAULT_VOICE, MAX_CONCURRENT_JOBS, MAX_TEXT_CHARS, tryAcquireSlot, releaseSlot };
