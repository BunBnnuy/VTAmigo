// Memory export job manager. Launches memoryExportWorker.js in a worker
// thread and tracks its progress so the frontend can poll a progress bar.
// Only one export can run at a time.
const path = require("path");
const { randomUUID } = require("crypto");
const { Worker } = require("worker_threads");
const { withSessions, saveSessions, CLI_PATHS } = require("./claude");

const MEMORIES_DIR = path.join(__dirname, "memories");
const EXPORT_TIMEOUT_MS = 180000; // memory dumps can be long — 3 min per CLI call

const SESSION_PROVIDERS = ["claude", "grok", "agy"];

// One job per Twitch account, so one streamer's export never blocks or
// reports progress into another account's Settings panel.
const jobs = new Map(); // twitchId -> job

const EMPTY_JOB = { running: false, pct: 0, stage: "", error: null, mdPath: null, from: null, to: null };

function getStatus(twitchId) {
  return jobs.get(twitchId) || EMPTY_JOB;
}

function setJob(twitchId, patch) {
  jobs.set(twitchId, { ...(jobs.get(twitchId) || EMPTY_JOB), ...patch });
}

function startExport(from, to, twitchId) {
  if (!twitchId) throw new Error("No autenticado");
  if (!SESSION_PROVIDERS.includes(from) || !SESSION_PROVIDERS.includes(to)) {
    throw new Error("Solo se puede exportar memoria entre Claude, Grok y AGY (ChatGPT no tiene sesión persistente)");
  }
  if (from === to) throw new Error("El modelo de origen y destino deben ser distintos");
  if (getStatus(twitchId).running) throw new Error("Ya hay una exportación en curso");

  setJob(twitchId, { running: true, pct: 0, stage: "Esperando a que terminen las consultas en curso…", error: null, mdPath: null, from, to });

  // Hold both providers' session queues (for this account only) so the
  // bot's own queries can't resume these sessions mid-export.
  withSessions([from, to], twitchId, (sessions) => {
    if (!sessions[from][twitchId] || !sessions[from][twitchId].started) {
      setJob(twitchId, { running: false, error: `${from} todavía no tiene memoria que exportar (ninguna consulta hecha)` });
      return;
    }
    if (!sessions[to][twitchId]) {
      sessions[to][twitchId] = { id: randomUUID(), started: false };
    }

    return new Promise((resolve) => {
      const worker = new Worker(path.join(__dirname, "memoryExportWorker.js"), {
        workerData: {
          from,
          to,
          exes: CLI_PATHS,
          source: { ...sessions[from][twitchId] },
          target: { ...sessions[to][twitchId] },
          memoriesDir: MEMORIES_DIR,
          timeoutMs: EXPORT_TIMEOUT_MS,
        },
      });

      const finish = (patch) => {
        setJob(twitchId, { running: false, ...patch });
        resolve();
      };

      worker.on("message", (msg) => {
        if (msg.type === "progress") {
          setJob(twitchId, { pct: msg.pct, stage: msg.stage });
        } else if (msg.type === "done") {
          // The inject query started the target session if it was new
          if (msg.targetSessionId) {
            sessions[to][twitchId].id = msg.targetSessionId;
          }
          if (!sessions[to][twitchId].started) {
            sessions[to][twitchId].started = true;
          }
          saveSessions();
          finish({ pct: 100, stage: "Exportación completada", mdPath: msg.mdPath });
        } else if (msg.type === "error") {
          finish({ error: msg.message });
        }
      });

      worker.on("error", (err) => finish({ error: err.message }));
      worker.on("exit", (code) => {
        if (getStatus(twitchId).running) finish({ error: `El worker terminó inesperadamente (código ${code})` });
      });
    });
  }).catch((err) => {
    setJob(twitchId, { running: false, error: err.message });
  });
}

module.exports = { startExport, getStatus };
