// Client-side error log — frontend app errors (uncaught exceptions, unhandled
// promise rejections, React render errors, and explicit logError() calls) are
// POSTed here so they're visible from the Admin panel instead of only living
// in a viewer's own devtools console. Stored in the error_log SQLite table
// (see db.js) — previously a flat JSON file (error-log.json), same pattern
// siteConfig.js / devices.js used to follow.
const { db } = require("./db");

const MAX_ENTRIES = 500;

const insertStmt = db.prepare(`
  INSERT INTO error_log (id, timestamp, message, stack, source, url, userAgent, twitchLogin)
  VALUES (@id, @timestamp, @message, @stack, @source, @url, @userAgent, @twitchLogin)
`);
const trimStmt = db.prepare(`
  DELETE FROM error_log WHERE id NOT IN (
    SELECT id FROM error_log ORDER BY timestamp DESC LIMIT ?
  )
`);

function addEntry({ message, stack, source, url, userAgent, twitchLogin }) {
  insertStmt.run({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    message: String(message || "Unknown error").slice(0, 2000),
    stack: stack ? String(stack).slice(0, 4000) : null,
    source: source ? String(source).slice(0, 200) : null,
    url: url ? String(url).slice(0, 500) : null,
    userAgent: userAgent ? String(userAgent).slice(0, 300) : null,
    twitchLogin: twitchLogin || null,
  });
  trimStmt.run(MAX_ENTRIES);
}

function getEntries() {
  return db.prepare(`SELECT * FROM error_log ORDER BY timestamp ASC`).all();
}

function clear() {
  db.prepare(`DELETE FROM error_log`).run();
}

module.exports = { addEntry, getEntries, clear };
