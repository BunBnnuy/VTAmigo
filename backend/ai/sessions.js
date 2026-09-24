// Per-provider, per-user persistent sessions: the first query from a given
// Twitch account opens the session, later queries resume it, so each
// streamer's co-host remembers their own stream without mixing memories with
// anyone else on the site. IDs live in the agent_sessions SQLite table (see
// db.js) so memory survives restarts — previously a flat JSON file
// (.agent-sessions.json) next to the backend.
// Delete a (provider, twitchId) row to give that account's bot a clean slate.
const { randomUUID } = require("crypto");
const { db } = require("../db");
const registry = require("./registry");

// One session map and one serialization queue per registered provider, so
// adding a provider to the registry needs no changes here.
const sessions = {};
const queues = {};
for (const id of registry.ids()) {
  sessions[id] = {};
  queues[id] = new Map();
}

const selectSessionsStmt = db.prepare(`SELECT provider, twitchId, sessionId, started FROM agent_sessions`);
const upsertSessionStmt = db.prepare(`
  INSERT INTO agent_sessions (provider, twitchId, sessionId, started) VALUES (@provider, @twitchId, @sessionId, @started)
  ON CONFLICT(provider, twitchId) DO UPDATE SET sessionId = excluded.sessionId, started = excluded.started
`);

function loadSessions() {
  for (const row of selectSessionsStmt.all()) {
    if (!sessions[row.provider]) continue;
    sessions[row.provider][row.twitchId] = { id: row.sessionId, started: !!row.started };
  }
}

function saveSession(provider, twitchId, session) {
  try {
    upsertSessionStmt.run({ provider, twitchId, sessionId: session.id, started: session.started ? 1 : 0 });
  } catch (err) {
    console.error("Failed to save agent session:", err.message);
  }
}

function saveSessions() {
  for (const provider of Object.keys(sessions)) {
    for (const [twitchId, session] of Object.entries(sessions[provider])) {
      saveSession(provider, twitchId, session);
    }
  }
}

loadSessions();

function getSession(provider, twitchId) {
  if (!sessions[provider][twitchId]) {
    sessions[provider][twitchId] = { id: randomUUID(), started: false };
    saveSession(provider, twitchId, sessions[provider][twitchId]);
  }
  return sessions[provider][twitchId];
}

function hasStartedSession(provider, twitchId) {
  return Boolean(sessions[provider] && sessions[provider][twitchId] && sessions[provider][twitchId].started);
}

// A session can't be resumed by two processes at once, so serialize calls
// per (provider, twitchId) pair with a promise chain.
function getQueue(provider, twitchId) {
  const m = queues[provider];
  if (!m.has(twitchId)) m.set(twitchId, Promise.resolve());
  return m.get(twitchId);
}

function setQueue(provider, twitchId, promise) {
  queues[provider].set(twitchId, promise);
}

function resetSession(provider, twitchId) {
  sessions[provider][twitchId] = { id: randomUUID(), started: false };
  saveSessions();
}

// Run fn with exclusive access to the given providers' sessions for one
// Twitch account: fn starts after that account's pending queries on those
// providers finish, and new queries wait until fn settles. Used by the
// memory exporter so it never races the co-host's own queries.
function withSessions(providers, twitchId, fn) {
  const run = Promise.all(providers.map((p) => getQueue(p, twitchId))).then(() => fn(sessions, twitchId));
  for (const p of providers) setQueue(p, twitchId, run.catch(() => {}));
  return run;
}

module.exports = {
  sessions,
  getSession,
  hasStartedSession,
  saveSessions,
  resetSession,
  getQueue,
  setQueue,
  withSessions,
};
