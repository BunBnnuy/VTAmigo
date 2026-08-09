const { db } = require("./db");

// Persists the Activity Panel's feed (follows, subs, raids, cheers, redeems)
// so it survives page reloads/reconnects instead of resetting to empty every
// time the frontend mounts — mirrors xp.js's twitchId-keyed, sqlite-backed pattern.
const KEEP_PER_ACCOUNT = 100;

const insertStmt = db.prepare(`
  INSERT INTO activity_events (id, twitchId, timestamp, event)
  VALUES (@id, @twitchId, @timestamp, @event)
  ON CONFLICT(twitchId, id) DO UPDATE SET timestamp = excluded.timestamp, event = excluded.event
`);
const selectRecentStmt = db.prepare(`
  SELECT event FROM activity_events WHERE twitchId = ? ORDER BY timestamp DESC LIMIT ?
`);
const trimStmt = db.prepare(`
  DELETE FROM activity_events WHERE twitchId = ? AND id NOT IN (
    SELECT id FROM activity_events WHERE twitchId = ? ORDER BY timestamp DESC LIMIT ?
  )
`);

function record(twitchId, event) {
  try {
    insertStmt.run({
      id: String(event.id),
      twitchId,
      timestamp: event.timestamp || Date.now(),
      event: JSON.stringify(event),
    });
    trimStmt.run(twitchId, twitchId, KEEP_PER_ACCOUNT);
  } catch (err) {
    console.error("[activity] record failed:", err.message);
  }
}

function getRecent(twitchId, limit = 30) {
  return selectRecentStmt.all(twitchId, limit)
    .map((row) => JSON.parse(row.event))
    .reverse();
}

module.exports = { record, getRecent };
