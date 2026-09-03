// Central SQLite connection, one physical file per environment so dev/
// staging/prod never share data. Every module that used to hand-roll its own
// flat-JSON-file read/write (auth.js, chatOverlayConfig.js, siteConfig.js,
// usage.js, errorLog.js, memoryDownload.js, videoQueue.js, xp.js,
// claude.js's agent sessions) now goes through here instead.
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

// APP_ENV is the explicit knob (set in /etc/vtamigo.env on the VPS via
// vtamigo-backend.service); NODE_ENV is the fallback for anything that only
// sets that. Neither is set locally, so `npm run dev` gets its own
// "development" database without any extra setup.
const RAW_ENV = process.env.APP_ENV || process.env.NODE_ENV || "development";
const ENV = RAW_ENV.replace(/[^a-z0-9_-]/gi, "").toLowerCase() || "development";

const DB_DIR = path.join(__dirname, "data", "db");
fs.mkdirSync(DB_DIR, { recursive: true });
const DB_PATH = path.join(DB_DIR, `vtamigo.${ENV}.sqlite3`);

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    twitchId TEXT PRIMARY KEY,
    login TEXT,
    displayName TEXT,
    profileImageUrl TEXT,
    approved INTEGER NOT NULL DEFAULT 0,
    tier TEXT,
    createdAt TEXT,
    approvedAt TEXT,
    twitchAccessTokenEnc TEXT,
    twitchRefreshTokenEnc TEXT,
    twitchTokenExpiresAt INTEGER,
    botTwitchId TEXT,
    botLogin TEXT,
    botAccessTokenEnc TEXT,
    botRefreshTokenEnc TEXT,
    botTokenExpiresAt INTEGER,
    botLinkedAt TEXT,
    -- Bumped to invalidate an account's overlay token (see auth.js's
    -- rotateOverlayToken). Overlay tokens travel in query strings, so they
    -- leak into access logs and screen-shared OBS dialogs; before this there
    -- was no way to take one back short of rotating SESSION_SECRET for every
    -- account at once.
    overlayTokenVersion INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS chat_overlay_config (
    twitchId TEXT PRIMARY KEY,
    config TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS site_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    config TEXT NOT NULL
  );

  -- Client-side app settings (frontend/src/Settings.jsx), previously
  -- localStorage-only. Populated by the client POSTing its local settings
  -- back to the server right after login — see userSettings.js.
  CREATE TABLE IF NOT EXISTS user_settings (
    twitchId TEXT PRIMARY KEY,
    settings TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS usage_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    twitchId TEXT,
    login TEXT,
    provider TEXT,
    ts INTEGER NOT NULL,
    tokensIn INTEGER NOT NULL,
    tokensOut INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_usage_log_twitchId_ts ON usage_log (twitchId, ts);

  CREATE TABLE IF NOT EXISTS error_log (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    message TEXT,
    stack TEXT,
    source TEXT,
    url TEXT,
    userAgent TEXT,
    twitchLogin TEXT
  );

  CREATE TABLE IF NOT EXISTS memory_download_state (
    twitchId TEXT PRIMARY KEY,
    lastDownloadAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS video_queue (
    twitchId TEXT PRIMARY KEY,
    state TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS xp_users (
    twitchId TEXT NOT NULL,
    usernameLower TEXT NOT NULL,
    username TEXT NOT NULL,
    color TEXT,
    xp INTEGER NOT NULL DEFAULT 0,
    messages INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (twitchId, usernameLower)
  );

  -- Named layer lists for the custom Overlay Builder (backend/overlayLayouts.js).
  -- Multiple rows per account, one per named layout — unlike the single-row
  -- tables above (chat_overlay_config etc.), so twitchId isn't the PK here.
  CREATE TABLE IF NOT EXISTS overlay_layouts (
    id TEXT PRIMARY KEY,
    twitchId TEXT NOT NULL,
    name TEXT NOT NULL,
    layers TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_overlay_layouts_twitchId ON overlay_layouts (twitchId);

  CREATE TABLE IF NOT EXISTS activity_events (
    id TEXT NOT NULL,
    twitchId TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    event TEXT NOT NULL,
    PRIMARY KEY (twitchId, id)
  );
  CREATE INDEX IF NOT EXISTS idx_activity_events_twitchId_ts ON activity_events (twitchId, timestamp);

  -- Manual per-kind pre-fills for the Overlay Builder's {kind.username}
  -- tokens (backend/activity.js's getLatestByKind), for kinds Twitch's API
  -- has no history for at all (sub/resub/giftsub/raid/cheer — only follows
  -- and redemptions are backfillable). Only used as a fallback when no real
  -- event of that kind has been recorded yet; a real one always takes over.
  CREATE TABLE IF NOT EXISTS overlay_manual_activity (
    twitchId TEXT NOT NULL,
    kind TEXT NOT NULL,
    username TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    PRIMARY KEY (twitchId, kind)
  );

  CREATE TABLE IF NOT EXISTS agent_sessions (
    provider TEXT NOT NULL,
    twitchId TEXT NOT NULL,
    sessionId TEXT NOT NULL,
    started INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (provider, twitchId)
  );

  -- Streamer achievements (backend/achievements.js): one row per unlocked
  -- achievement per account. Progress itself is derived live from the existing
  -- usage_log / xp_users / activity_events tables, so only the unlock moment
  -- needs storing here.
  CREATE TABLE IF NOT EXISTS streamer_achievements (
    twitchId TEXT NOT NULL,
    achievementId TEXT NOT NULL,
    unlockedAt TEXT NOT NULL,
    PRIMARY KEY (twitchId, achievementId)
  );
`);

// Device-code enrollment for the downloadable tunnel client was a desktop-era
// feature: it granted a streamer's own PC an SSH port-forward so the hosted
// backend could reach VTube Studio running on that machine. VTS support is
// gone, so nothing reads this table any more — drop it rather than leave rows
// of public keys lying around. Idempotent: a no-op on databases created after
// the table stopped being declared above.
db.exec(`DROP TABLE IF EXISTS devices;`);

// `CREATE TABLE IF NOT EXISTS` above only shapes *new* databases, so columns
// added later have to be backfilled onto existing ones by hand. SQLite has no
// "ADD COLUMN IF NOT EXISTS", hence the table_info check.
function addColumnIfMissing(table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
}

addColumnIfMissing("users", "overlayTokenVersion", "INTEGER NOT NULL DEFAULT 1");

module.exports = { db, ENV, DB_PATH };
