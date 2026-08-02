// Tracks memory-download job progress and the 24h cooldown, persisted to
// disk so the cooldown survives backend restarts and can't be reset by
// refreshing the page. The CLI dump can take a couple of minutes, so this
// runs as a background job (like memoryExport) instead of blocking a single
// HTTP request — a synchronous request risked hitting nginx's proxy timeout
// and getting an HTML error page back instead of JSON.
const fs = require("fs");
const path = require("path");
const { dumpMemory } = require("./claude");

const STATE_FILE = path.join(__dirname, ".memory-download-state.json");
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

let job = { running: false, pct: 0, stage: "", error: null, markdown: null };
let stageTimer = null;

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { lastDownloadAt: 0 };
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch (err) {
    console.error("Failed to save memory download state:", err.message);
  }
}

function getAvailableAt() {
  const { lastDownloadAt } = loadState();
  return lastDownloadAt ? lastDownloadAt + COOLDOWN_MS : 0;
}

function getStatus() {
  return { ...job, availableAt: getAvailableAt() };
}

function friendlyError(message, provider) {
  if (message === "NO_MEMORY_YET") return "El bot todavía no tiene memoria que descargar (ninguna consulta hecha)";
  if (message === "MEMORY_EMPTY") return "El bot devolvió una memoria vacía";
  if (message === "CLI_NOT_FOUND") return `${provider} CLI no encontrado`;
  if (message === "TIMEOUT") return `${provider} CLI tardó demasiado (>3 min)`;
  return message;
}

function startDownload(provider) {
  if (job.running) throw new Error("ALREADY_RUNNING");
  const availableAt = getAvailableAt();
  if (Date.now() < availableAt) {
    const err = new Error("COOLDOWN");
    err.availableAt = availableAt;
    throw err;
  }

  job = { running: true, pct: 0, stage: STAGES[0].stage, error: null, markdown: null };
  let stageIndex = 0;
  stageTimer = setInterval(() => {
    if (stageIndex >= STAGES.length - 1) return;
    stageIndex += 1;
    job = { ...job, pct: STAGES[stageIndex].pct, stage: STAGES[stageIndex].stage };
  }, STAGE_INTERVAL_MS);

  dumpMemory(provider)
    .then((markdown) => {
      clearInterval(stageTimer);
      saveState({ lastDownloadAt: Date.now() });
      job = { running: false, pct: 100, stage: "Listo", error: null, markdown };
    })
    .catch((err) => {
      clearInterval(stageTimer);
      job = { running: false, pct: 0, stage: "", error: friendlyError(err.message, provider), markdown: null };
    });
}

module.exports = { getStatus, startDownload };
