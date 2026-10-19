// Shared supervisor for the Python TTS sidecars (KittenTTS, Kokoro).
//
// Both engines are Python libraries that load an ONNX model into memory and
// answer one request at a time, so they share the same lifecycle: spawn on the
// first request, speak JSON lines over stdin/stdout, cap concurrency, and shut
// the worker down after a period of silence to return the RAM to the host.
//
// Each engine supplies its paths, voice list and env through createWorkerEngine
// in kitten.js / kokoro.js; everything stateful lives here.

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

function createWorkerEngine({
  code, // error-code prefix: "KITTEN" -> KITTEN_BUSY, ...
  label, // human-readable name used in fallback logs
  dir,
  python,
  cacheDir,
  defaultVoice,
  voices, // [{ id, name }]
  requiredFiles = [],
  extraEnv = {},
  maxConcurrentJobs = 2,
  maxTextChars = 1000,
  startupTimeoutMs = 180000,
  requestTimeoutMs = 180000,
  idleShutdownMs = 10 * 60 * 1000,
}) {
  const workerPath = path.join(dir, "worker.py");
  let activeJobs = 0;
  let worker = null; // { child, ready, buffer, pending, stderr, startupTimer }
  let idleTimer = null;
  let nextRequestId = 1;

  function workerError(suffix, detail) {
    return new Error(detail ? `${code}_${suffix}: ${detail}` : `${code}_${suffix}`);
  }

  function tryAcquireSlot() {
    if (activeJobs >= maxConcurrentJobs) return false;
    activeJobs += 1;
    return true;
  }

  function releaseSlot() {
    activeJobs = Math.max(0, activeJobs - 1);
  }

  function isInstalled() {
    return fs.existsSync(python) && fs.existsSync(workerPath) && requiredFiles.every((file) => fs.existsSync(file));
  }

  function listVoices() {
    return voices.map((voice) => ({ ...voice }));
  }

  function rejectPending(state, err) {
    for (const entry of state.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    state.pending.clear();
  }

  function handleLine(state, line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return; // stray library output (the workers keep the protocol on fd 1)
    }

    if (message.ready) {
      clearTimeout(state.startupTimer);
      state.resolveReady(message);
      return;
    }

    const entry = state.pending.get(message.id);
    if (!entry) return;
    state.pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.ok) entry.resolve(Buffer.from(message.wav, "base64"));
    else entry.reject(workerError("FAILED", message.error || "worker returned no audio"));
  }

  function stopWorker(reason) {
    const state = worker;
    worker = null;
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (!state) return;
    rejectPending(state, workerError("WORKER_EXITED", reason));
    try {
      state.child.kill("SIGTERM");
    } catch {
      // already gone
    }
  }

  function spawnWorker() {
    if (!fs.existsSync(cacheDir)) {
      try {
        fs.mkdirSync(cacheDir, { recursive: true });
      } catch (err) {
        throw workerError("NOT_WRITABLE", `${cacheDir}: ${err.message}`);
      }
    }

    const child = spawn(python, [workerPath], {
      cwd: dir,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        ...extraEnv,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const state = {
      child,
      buffer: "",
      pending: new Map(),
      stderr: "",
      resolveReady: null,
      rejectReady: null,
      startupTimer: null,
    };

    state.ready = new Promise((resolve, reject) => {
      state.resolveReady = resolve;
      state.rejectReady = reject;
    });
    // Nothing awaits the success path until generateSpeech() does; swallow the
    // rejection here so a worker that dies while idle cannot crash the process.
    state.ready.catch(() => {});

    // A worker that dies mid-write would otherwise emit EPIPE on stdin as an
    // unhandled stream error and take the whole backend down.
    child.stdin.on("error", () => {});

    state.startupTimer = setTimeout(() => {
      state.rejectReady(workerError("TIMEOUT", "worker did not become ready"));
      stopWorker("startup timeout");
    }, startupTimeoutMs);
    state.startupTimer.unref?.();

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      state.buffer += chunk;
      let newline;
      while ((newline = state.buffer.indexOf("\n")) !== -1) {
        const line = state.buffer.slice(0, newline).trim();
        state.buffer = state.buffer.slice(newline + 1);
        if (!line) continue;
        handleLine(state, line);
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      state.stderr = (state.stderr + chunk).slice(-4000);
      // Model download progress and per-request library chatter are noisy;
      // only surface them when something actually breaks.
      if (process.env.TTS_VERBOSE === "1") process.stderr.write(chunk);
    });

    child.on("error", (err) => {
      clearTimeout(state.startupTimer);
      state.rejectReady(workerError("NOT_INSTALLED", err.message));
      rejectPending(state, workerError("NOT_INSTALLED", err.message));
      if (worker === state) worker = null;
    });

    child.on("exit", (exitCode, signal) => {
      clearTimeout(state.startupTimer);
      const tail = state.stderr.trim().split("\n").slice(-2).join(" | ");
      const detail = `exit ${exitCode ?? signal}${tail ? `: ${tail}` : ""}`;
      state.rejectReady(workerError("WORKER_EXITED", detail));
      rejectPending(state, workerError("WORKER_EXITED", detail));
      if (worker === state) worker = null;
    });

    worker = state;
    return state;
  }

  function ensureWorker() {
    const state = worker || spawnWorker();
    return state.ready;
  }

  function requestAudio(text, voice, speed) {
    const state = worker;
    if (!state) return Promise.reject(workerError("WORKER_EXITED", "worker not running"));

    const id = nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        state.pending.delete(id);
        reject(workerError("TIMEOUT", "generation timed out"));
        // The worker is single-threaded inside generate(); the only way back
        // to a clean state is to drop it and let the next request respawn.
        stopWorker("generation timeout");
      }, requestTimeoutMs);
      timer.unref?.();

      state.pending.set(id, { resolve, reject, timer });
      try {
        state.child.stdin.write(JSON.stringify({ id, text, voice, speed }) + "\n");
      } catch (err) {
        clearTimeout(timer);
        state.pending.delete(id);
        reject(workerError("WORKER_EXITED", err.message));
      }
    });
  }

  function scheduleIdleShutdown() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (activeJobs === 0) stopWorker("idle");
    }, idleShutdownMs);
    idleTimer.unref?.();
  }

  // Returns a Buffer of WAV audio.
  async function generateSpeech({ text, voice, speed }) {
    if (!text) throw workerError("TEXT_REQUIRED");
    if (text.length > maxTextChars) throw workerError("TEXT_TOO_LONG");
    // Saturation is checked before anything that needs the worker: a host with
    // no venv still has a bounded number of slots, same as Piper.
    if (!tryAcquireSlot()) throw workerError("BUSY");

    try {
      if (!isInstalled()) throw workerError("NOT_INSTALLED");
      const voiceId = voice || defaultVoice;
      if (!voices.some((candidate) => candidate.id === voiceId)) throw workerError("BAD_VOICE");
      await ensureWorker();
      return await requestAudio(text, voiceId, speed);
    } finally {
      releaseSlot();
      scheduleIdleShutdown();
    }
  }

  return {
    code,
    label,
    isInstalled,
    listVoices,
    generateSpeech,
    defaultVoice,
    maxTextChars,
    maxConcurrentJobs,
    tryAcquireSlot,
    releaseSlot,
    // Test hook: drop the worker without waiting for the idle timer.
    _shutdown: () => stopWorker("shutdown"),
  };
}

module.exports = { createWorkerEngine };
