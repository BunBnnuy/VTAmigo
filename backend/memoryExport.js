// Memory export job manager. Wraps aiTransfer.transferMemory (dump the source
// session, inject into the target) with a per-account progress record so the
// frontend can poll a progress bar. Only one export can run per account.
const { transferMemory } = require("./aiTransfer");
const registry = require("./ai/registry");

const SESSION_PROVIDERS = registry.sessionIds();

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
    throw new Error("Solo se puede exportar memoria entre los proveedores con sesión persistente");
  }
  if (from === to) throw new Error("El modelo de origen y destino deben ser distintos");
  if (getStatus(twitchId).running) throw new Error("Ya hay una exportación en curso");

  setJob(twitchId, { running: true, pct: 0, stage: "Esperando a que terminen las consultas en curso…", error: null, mdPath: null, from, to });

  transferMemory(from, to, twitchId, {
    onProgress: (pct, stage) => setJob(twitchId, { pct, stage }),
  })
    .then(({ mdPath }) => {
      setJob(twitchId, { running: false, pct: 100, stage: "Exportación completada", mdPath });
    })
    .catch((err) => {
      setJob(twitchId, { running: false, error: err.message });
    });
}

module.exports = { startExport, getStatus };
