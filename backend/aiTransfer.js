// Shared "move an account's memory from one session provider to another"
// step, used by the per-user Settings export (memoryExport.js) and the admin
// bulk migration (aiMigration.js). Runs memoryExportWorker.js in a worker
// thread while holding both providers' per-user session queues, so the bot's
// own queries can't resume either session mid-transfer.
const path = require("path");
const { randomUUID } = require("crypto");
const { Worker } = require("worker_threads");
const { withSessions, saveSessions } = require("./ai");
const siteConfig = require("./siteConfig");

const MEMORIES_DIR = path.join(__dirname, "memories");
const EXPORT_TIMEOUT_MS = 180000; // memory dumps can be long — 3 min per CLI call

// Resolves { mdPath, targetSessionId } and marks the target session started,
// or rejects with the worker's error. onProgress(pct, stage) reports the
// worker's own stages while it runs.
function transferMemory(from, to, twitchId, { onProgress = () => {} } = {}) {
  if (!twitchId) throw new Error("No autenticado");
  return withSessions([from, to], twitchId, (sessions) => {
    if (!sessions[from] || !sessions[from][twitchId] || !sessions[from][twitchId].started) {
      throw new Error(`${from} todavía no tiene memoria que exportar (ninguna consulta hecha)`);
    }
    if (!sessions[to][twitchId]) {
      sessions[to][twitchId] = { id: randomUUID(), started: false };
    }

    return new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, "memoryExportWorker.js"), {
        workerData: {
          from,
          to,
          models: { [from]: siteConfig.getModel(from), [to]: siteConfig.getModel(to) },
          source: { ...sessions[from][twitchId] },
          target: { ...sessions[to][twitchId] },
          memoriesDir: MEMORIES_DIR,
          timeoutMs: EXPORT_TIMEOUT_MS,
        },
      });

      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      worker.on("message", (msg) => {
        if (settled) return;
        if (msg.type === "progress") {
          onProgress(msg.pct, msg.stage);
        } else if (msg.type === "done") {
          settled = true;
          // The inject query started the target session if it was new.
          if (msg.targetSessionId) sessions[to][twitchId].id = msg.targetSessionId;
          sessions[to][twitchId].started = true;
          saveSessions();
          resolve({ mdPath: msg.mdPath, targetSessionId: msg.targetSessionId || null });
        } else if (msg.type === "error") {
          fail(new Error(msg.message));
        }
      });

      worker.on("error", (err) => fail(err));
      worker.on("exit", (code) => {
        fail(new Error(`El worker terminó inesperadamente (código ${code})`));
      });
    });
  });
}

module.exports = { transferMemory, MEMORIES_DIR, EXPORT_TIMEOUT_MS };
