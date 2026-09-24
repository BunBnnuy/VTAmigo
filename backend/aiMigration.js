// Admin bulk provider migration: move every account's memory from one
// session provider to another.
//
// Session ids are provider-internal (a Claude session means nothing to
// OpenCode), so "migrating" is the same dump→inject transfer the per-user
// Settings export runs, applied to every account that has a started session
// on the source provider. That's two CLI calls per account, so the run can
// take hours — hence the agent_migrations table:
//   - each account is one row (pending → running → done | error);
//   - `done` rows are skipped, `error` rows are retried on the next run;
//   - a run interrupted by a restart leaves `running` rows, and the next
//     start resets anything not `done` back to pending.
// The job is deliberately sequential (one transfer at a time) and global
// (one migration at a time) — the provider CLIs are heavy processes.
const { db } = require("./db");
const registry = require("./ai/registry");
const { transferMemory } = require("./aiTransfer");

// The running job, or null: { from, to, current, stage, startedAt }.
let live = null;

const selectCandidatesStmt = db.prepare(
  `SELECT DISTINCT twitchId FROM agent_sessions WHERE provider = ? AND started = 1`
);
const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO agent_migrations (twitchId, fromProvider, toProvider, status, error, updatedAt)
  VALUES (?, ?, ?, 'pending', NULL, ?)
`);
const resetStmt = db.prepare(`
  UPDATE agent_migrations SET status = 'pending', error = NULL, updatedAt = ?
  WHERE twitchId = ? AND fromProvider = ? AND toProvider = ? AND status != 'done'
`);
const setStatusStmt = db.prepare(`
  UPDATE agent_migrations SET status = ?, error = ?, updatedAt = ?
  WHERE twitchId = ? AND fromProvider = ? AND toProvider = ?
`);
const selectPendingStmt = db.prepare(`
  SELECT twitchId FROM agent_migrations
  WHERE fromProvider = ? AND toProvider = ? AND status = 'pending'
  ORDER BY twitchId
`);
const countStmt = db.prepare(`
  SELECT status, COUNT(*) AS n FROM agent_migrations
  WHERE fromProvider = ? AND toProvider = ?
  GROUP BY status
`);

function assertProvider(id) {
  if (!registry.sessionIds().includes(id)) throw new Error("Invalid provider");
}

function startMigration(from, to, { transfer = transferMemory } = {}) {
  assertProvider(from);
  assertProvider(to);
  if (from === to) throw new Error("Origen y destino deben ser distintos");
  if (live) throw new Error("ALREADY_RUNNING");

  const now = new Date().toISOString();
  const candidates = selectCandidatesStmt.all(from).map((row) => row.twitchId);
  db.transaction(() => {
    for (const twitchId of candidates) {
      insertStmt.run(twitchId, from, to, now);
      resetStmt.run(now, twitchId, from, to);
    }
  })();

  const job = { from, to, current: null, stage: "Preparando…", startedAt: now };
  live = job;

  (async () => {
    try {
      const pending = selectPendingStmt.all(from, to);
      for (const row of pending) {
        job.current = row.twitchId;
        job.stage = "Extrayendo memoria…";
        setStatusStmt.run("running", null, new Date().toISOString(), row.twitchId, from, to);
        try {
          await transfer(from, to, row.twitchId, {
            onProgress: (_pct, stage) => {
              job.stage = stage;
            },
          });
          setStatusStmt.run("done", null, new Date().toISOString(), row.twitchId, from, to);
        } catch (err) {
          setStatusStmt.run("error", err.message, new Date().toISOString(), row.twitchId, from, to);
        }
      }
    } finally {
      live = null;
    }
  })();
}

function getStatus(from, to) {
  assertProvider(from);
  assertProvider(to);
  const counts = {};
  for (const row of countStmt.all(from, to)) counts[row.status] = row.n;
  const job = live && live.from === from && live.to === to ? live : null;
  const pending = (counts.pending || 0) + (counts.running || 0);
  return {
    running: !!job,
    from,
    to,
    total: pending + (counts.done || 0) + (counts.error || 0),
    done: counts.done || 0,
    failed: counts.error || 0,
    pending,
    current: job ? job.current : null,
    stage: job ? job.stage : "",
    startedAt: job ? job.startedAt : null,
  };
}

module.exports = { startMigration, getStatus };
