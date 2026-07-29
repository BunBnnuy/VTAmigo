// Memory export job manager. Launches memoryExportWorker.js in a worker
// thread and tracks its progress so the frontend can poll a progress bar.
// Only one export can run at a time.
const path = require("path");
const { Worker } = require("worker_threads");
const { withSessions, saveSessions, CLI_PATHS } = require("./claude");

const MEMORIES_DIR = path.join(__dirname, "memories");
const EXPORT_TIMEOUT_MS = 180000; // memory dumps can be long — 3 min per CLI call

const SESSION_PROVIDERS = ["claude", "grok", "agy"];

// Current/last job state, shape matches what GET /memory/export/status returns
let job = { running: false, pct: 0, stage: "", error: null, mdPath: null, from: null, to: null };

function getStatus() {
  return job;
}

function startExport(from, to) {
  if (!SESSION_PROVIDERS.includes(from) || !SESSION_PROVIDERS.includes(to)) {
    throw new Error("Solo se puede exportar memoria entre Claude, Grok y AGY (ChatGPT no tiene sesión persistente)");
  }
  if (from === to) throw new Error("El modelo de origen y destino deben ser distintos");
  if (job.running) throw new Error("Ya hay una exportación en curso");

  job = { running: true, pct: 0, stage: "Esperando a que terminen las consultas en curso…", error: null, mdPath: null, from, to };

  // Hold both providers' session queues so the bot's own queries can't
  // resume these sessions mid-export.
  withSessions([from, to], (sessions) => {
    if (!sessions[from].started) {
      job = { ...job, running: false, error: `${from} todavía no tiene memoria que exportar (ninguna consulta hecha)` };
      return;
    }

    return new Promise((resolve) => {
      const worker = new Worker(path.join(__dirname, "memoryExportWorker.js"), {
        workerData: {
          from,
          to,
          exes: CLI_PATHS,
          source: { ...sessions[from] },
          target: { ...sessions[to] },
          memoriesDir: MEMORIES_DIR,
          timeoutMs: EXPORT_TIMEOUT_MS,
        },
      });

      const finish = (patch) => {
        job = { ...job, running: false, ...patch };
        resolve();
      };

      worker.on("message", (msg) => {
        if (msg.type === "progress") {
          job = { ...job, pct: msg.pct, stage: msg.stage };
        } else if (msg.type === "done") {
          // The inject query started the target session if it was new
          if (msg.targetSessionId) {
            sessions[to].id = msg.targetSessionId;
          }
          if (!sessions[to].started) {
            sessions[to].started = true;
          }
          saveSessions();
          finish({ pct: 100, stage: "Exportación completada", mdPath: msg.mdPath });
        } else if (msg.type === "error") {
          finish({ error: msg.message });
        }
      });

      worker.on("error", (err) => finish({ error: err.message }));
      worker.on("exit", (code) => {
        if (job.running) finish({ error: `El worker terminó inesperadamente (código ${code})` });
      });
    });
  }).catch((err) => {
    job = { ...job, running: false, error: err.message };
  });
}

module.exports = { startExport, getStatus };
