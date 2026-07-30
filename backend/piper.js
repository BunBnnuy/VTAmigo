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
    if (!isInstalled()) return reject(new Error("PIPER_NOT_INSTALLED"));

    const voiceFile = voice || DEFAULT_VOICE;
    // Voice id comes from the frontend — keep it to a bare filename inside voices/
    if (voiceFile.includes("/") || voiceFile.includes("\\") || !voiceFile.endsWith(".onnx")) {
      return reject(new Error("PIPER_BAD_VOICE"));
    }
    const modelPath = path.join(VOICES_DIR, voiceFile);
    if (!fs.existsSync(modelPath)) return reject(new Error("PIPER_BAD_VOICE"));

    const outPath = path.join(os.tmpdir(), `piper-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
    const proc = spawn(PIPER_EXE, ["-m", modelPath, "-f", outPath], { cwd: PIPER_DIR });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      try {
        if (code !== 0) {
          return reject(new Error(`Piper exited with code ${code}: ${stderr.slice(-300)}`));
        }
        resolve(fs.readFileSync(outPath));
      } catch (err) {
        reject(err);
      } finally {
        fs.rm(outPath, { force: true }, () => {});
      }
    });
    proc.stdin.write(text);
    proc.stdin.end();
  });
}

module.exports = { isInstalled, listVoices, generateSpeech, DEFAULT_VOICE };
