// Server-side copy of the frontend's Settings.jsx localStorage blob, keyed
// by twitchId in the user_settings SQLite table (see db.js). This is a
// temporary sync shim: the client still treats localStorage as the source of
// truth and POSTs its current settings here once on every login so the data
// exists server-side too — no server -> client sync yet. Remove this whole
// module (and the /settings routes + the frontend POST-on-login call) once
// settings actually live in the DB as the source of truth.
const { db } = require("./db");

const getStmt = db.prepare(`SELECT settings FROM user_settings WHERE twitchId = ?`);
const upsertStmt = db.prepare(`
  INSERT INTO user_settings (twitchId, settings, updatedAt) VALUES (?, ?, ?)
  ON CONFLICT(twitchId) DO UPDATE SET settings = excluded.settings, updatedAt = excluded.updatedAt
`);

function getSettings(twitchId) {
  const row = getStmt.get(twitchId);
  if (!row) return null;
  try {
    return JSON.parse(row.settings);
  } catch {
    return null;
  }
}

function setSettings(twitchId, settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("settings must be an object");
  }
  upsertStmt.run(twitchId, JSON.stringify(settings), new Date().toISOString());
}

module.exports = { getSettings, setSettings };
