// Per-account appearance/behavior settings for the chat overlay
// (backend/overlay/chat.html), stored in the chat_overlay_config SQLite
// table (see db.js), keyed by twitchId.
//
// The option set itself lives in chatOverlaySchema.js: this module only does
// storage and merges. Kept as a separate file so the schema can be served to
// the frontend (GET /chat-overlay/schema) and shared by the validator without
// pulling in the database.
const { db } = require("./db");
const { DEFAULTS, sanitize } = require("./chatOverlaySchema");

const getConfigStmt = db.prepare(`SELECT config FROM chat_overlay_config WHERE twitchId = ?`);
const upsertConfigStmt = db.prepare(`
  INSERT INTO chat_overlay_config (twitchId, config) VALUES (?, ?)
  ON CONFLICT(twitchId) DO UPDATE SET config = excluded.config
`);

function readOne(twitchId) {
  const row = getConfigStmt.get(twitchId);
  if (!row) return null;
  try {
    return JSON.parse(row.config);
  } catch {
    return null;
  }
}

function writeOne(twitchId, config) {
  upsertConfigStmt.run(twitchId, JSON.stringify(config));
}

function getConfig(twitchId) {
  return { ...DEFAULTS, ...(readOne(twitchId) || {}) };
}

function setConfig(twitchId, partial) {
  const merged = { ...DEFAULTS, ...(readOne(twitchId) || {}), ...sanitize(partial) };
  writeOne(twitchId, merged);
  return merged;
}

module.exports = { DEFAULTS, getConfig, setConfig };
