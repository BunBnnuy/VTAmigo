// Tracks memory-download job progress and the 24h cooldown, persisted to
// disk so the cooldown survives backend restarts and can't be reset by
// refreshing the page. The CLI dump can take a couple of minutes, so this
// runs as a background job (like memoryExport) instead of blocking a single
// HTTP request — a synchronous request risked hitting nginx's proxy timeout
// and getting an HTML error page back instead of JSON. Both the job and the
// cooldown are keyed by Twitch account so one streamer's download/cooldown
// never blocks or leaks into another account's Settings panel. The cooldown
// is persisted in the memory_download_state SQLite table (see db.js) —
// previously a flat JSON file (.memory-download-state.json).
const { dumpMemory } = require("./claude");
const { db } = require("./db");

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Simulated progress — the CLI call itself doesn't report incremental
// progress, so this just ramps pct up through a few descriptive stages while
// waiting for it to resolve, capped below 100 until it actually finishes.
const STAGES = [
  { pct: 15, stage: "Conectando con el modelo…" },
  { pct: 40, stage: "Leyendo la memoria del stream…" },
  { pct: 70, stage: "Recopilando viewers, bromas internas y contexto…" },
  { pct: 90, stage: "Preparando el archivo…" },
];
const STAGE_INTERVAL_MS = 4000;

const EMPTY_JOB = { running: false, pct: 0, stage: "", error: null, markdown: null };
const jobs = new Map(); // twitchId -> job
const stageTimers = new Map(); // twitchId -> interval handle

const getLastDownloadStmt = db.prepare(`SELECT lastDownloadAt FROM memory_download_state WHERE twitchId = ?`);
const setLastDownloadStmt = db.prepare(`
  INSERT INTO memory_download_state (twitchId, lastDownloadAt) VALUES (?, ?)
  ON CONFLICT(twitchId) DO UPDATE SET lastDownloadAt = excluded.lastDownloadAt
`);

function getAvailableAt(twitchId) {
  const row = getLastDownloadStmt.get(twitchId);
  return row ? row.lastDownloadAt + COOLDOWN_MS : 0;
}

function setLastDownloadAt(twitchId, ts) {
  setLastDownloadStmt.run(twitchId, ts);
}

function getStatus(twitchId) {
  return { ...(jobs.get(twitchId) || EMPTY_JOB), availableAt: getAvailableAt(twitchId) };
}

function friendlyError(message, provider) {
  if (message === "NO_MEMORY_YET") return "El bot todavía no tiene memoria que descargar (ninguna consulta hecha)";
  if (message === "MEMORY_EMPTY") return "El bot devolvió una memoria vacía";
  if (message === "CLI_NOT_FOUND") return `${provider} CLI no encontrado`;
  if (message === "TIMEOUT") return `${provider} CLI tardó demasiado (>3 min)`;
  return message;
}

function startDownload(provider, twitchId) {
  if (!twitchId) throw new Error("No autenticado");
  if ((jobs.get(twitchId) || EMPTY_JOB).running) throw new Error("ALREADY_RUNNING");
  const availableAt = getAvailableAt(twitchId);
  if (Date.now() < availableAt) {
    const err = new Error("COOLDOWN");
    err.availableAt = availableAt;
    throw err;
  }

  jobs.set(twitchId, { running: true, pct: 0, stage: STAGES[0].stage, error: null, markdown: null });
  let stageIndex = 0;
  const timer = setInterval(() => {
    if (stageIndex >= STAGES.length - 1) return;
    stageIndex += 1;
    jobs.set(twitchId, { ...jobs.get(twitchId), pct: STAGES[stageIndex].pct, stage: STAGES[stageIndex].stage });
  }, STAGE_INTERVAL_MS);
  stageTimers.set(twitchId, timer);

  dumpMemory(provider, twitchId)
    .then((markdown) => {
      clearInterval(stageTimers.get(twitchId));
      stageTimers.delete(twitchId);
      setLastDownloadAt(twitchId, Date.now());
      jobs.set(twitchId, { running: false, pct: 100, stage: "Listo", error: null, markdown });
    })
    .catch((err) => {
      clearInterval(stageTimers.get(twitchId));
      stageTimers.delete(twitchId);
      jobs.set(twitchId, { running: false, pct: 0, stage: "", error: friendlyError(err.message, provider), markdown: null });
    });
}

module.exports = { getStatus, startDownload };
