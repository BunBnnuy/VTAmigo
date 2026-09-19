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

// Credential keys that must never be stored in the user_settings JSON blob.
// The bot's real tokens live only in the encrypted users-table columns, via
// the /bot-link OAuth flow (see auth.js setBotTwitchTokens). Old clients
// synced a manually-pasted bot token + username inside this blob, so both
// the write path (defense in depth against a stale frontend) and the read
// path (cleanup for rows written before the purge) strip them.
const CREDENTIAL_KEYS = new Set([
  "botToken",
  "botUsername",
  "accessToken",
  "refreshToken",
  "oauthToken",
  "twitchAccessToken",
  "twitchRefreshToken",
]);

function sanitizeSettings(settings) {
  const clean = { ...(settings || {}) };
  for (const key of CREDENTIAL_KEYS) delete clean[key];
  return clean;
}

function getSettings(twitchId) {
  const row = getStmt.get(twitchId);
  if (!row) return null;
  let parsed;
  try {
    parsed = JSON.parse(row.settings);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  // One-time cleanup: a row written by an old client still carries the
  // plaintext bot token — drop it in place so it is never served again.
  if (Object.keys(parsed).some((k) => CREDENTIAL_KEYS.has(k))) {
    const clean = sanitizeSettings(parsed);
    try {
      upsertStmt.run(twitchId, JSON.stringify(clean), new Date().toISOString());
    } catch {
      // Best-effort scrub — the sanitized copy below is still what callers get.
    }
    return clean;
  }
  return parsed;
}

function setSettings(twitchId, settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("settings must be an object");
  }
  // Stale frontends still POST their whole localStorage blob, token included —
  // drop credential keys instead of persisting them.
  upsertStmt.run(twitchId, JSON.stringify(sanitizeSettings(settings)), new Date().toISOString());
}

module.exports = { getSettings, setSettings, sanitizeSettings, CREDENTIAL_KEYS };
