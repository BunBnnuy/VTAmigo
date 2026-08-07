// One-time import of the old flat-JSON-file data stores into the
// per-environment SQLite DB (see db.js). Safe to run more than once — every
// import is a no-op if the corresponding SQLite table already has rows, so
// re-running after a partial failure just picks up where it left off.
//
// Usage: APP_ENV=production node migrate-to-sqlite.js   (from backend/)
// APP_ENV/NODE_ENV selects which vtamigo.<env>.sqlite3 file gets written to,
// same as the running server — run this once per environment you have JSON
// data for.
const fs = require("fs");
const path = require("path");
const { db, ENV, DB_PATH } = require("./db");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, file), "utf8"));
  } catch {
    return fallback;
  }
}

function tableEmpty(table) {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n === 0;
}

function migrateUsers() {
  if (!tableEmpty("users")) return console.log("[migrate] users: already populated, skipping");
  const users = readJson("users.json", []);
  if (!users.length) return console.log("[migrate] users: no users.json, skipping");
  const columns = [
    "twitchId", "login", "displayName", "profileImageUrl", "approved", "tier",
    "createdAt", "approvedAt", "twitchAccessTokenEnc", "twitchRefreshTokenEnc",
    "twitchTokenExpiresAt", "botTwitchId", "botLogin", "botAccessTokenEnc",
    "botRefreshTokenEnc", "botTokenExpiresAt", "botLinkedAt",
  ];
  const insert = db.prepare(`INSERT INTO users (${columns.join(", ")}) VALUES (${columns.map((c) => "@" + c).join(", ")})`);
  const txn = db.transaction((list) => {
    for (const u of list) {
      const row = {};
      for (const c of columns) row[c] = c === "approved" ? (u[c] ? 1 : 0) : u[c] === undefined ? null : u[c];
      insert.run(row);
    }
  });
  txn(users);
  console.log(`[migrate] users: imported ${users.length}`);
}

function migrateChatOverlayConfig() {
  if (!tableEmpty("chat_overlay_config")) return console.log("[migrate] chat_overlay_config: already populated, skipping");
  const all = readJson("chatOverlayConfig.json", {});
  const entries = Object.entries(all);
  if (!entries.length) return console.log("[migrate] chat_overlay_config: no chatOverlayConfig.json, skipping");
  const insert = db.prepare(`INSERT INTO chat_overlay_config (twitchId, config) VALUES (?, ?)`);
  const txn = db.transaction((list) => {
    for (const [twitchId, config] of list) insert.run(twitchId, JSON.stringify(config));
  });
  txn(entries);
  console.log(`[migrate] chat_overlay_config: imported ${entries.length}`);
}

function migrateSiteConfig() {
  if (!tableEmpty("site_config")) return console.log("[migrate] site_config: already populated, skipping");
  const config = readJson(".site-config.json", null);
  if (!config) return console.log("[migrate] site_config: no .site-config.json, skipping");
  db.prepare(`INSERT INTO site_config (id, config) VALUES (1, ?)`).run(JSON.stringify(config));
  console.log("[migrate] site_config: imported");
}

function migrateDevices() {
  if (!tableEmpty("devices")) return console.log("[migrate] devices: already populated, skipping");
  const devices = readJson("devices.json", []);
  if (!devices.length) return console.log("[migrate] devices: no devices.json, skipping");
  const columns = ["deviceCode", "userCode", "publicKey", "twitchId", "status", "assignedPort", "createdAt", "approvedAt"];
  const insert = db.prepare(`INSERT INTO devices (${columns.join(", ")}) VALUES (${columns.map((c) => "@" + c).join(", ")})`);
  const txn = db.transaction((list) => {
    for (const d of list) {
      const row = {};
      for (const c of columns) row[c] = d[c] === undefined ? null : d[c];
      insert.run(row);
    }
  });
  txn(devices);
  console.log(`[migrate] devices: imported ${devices.length}`);
}

function migrateUsage() {
  if (!tableEmpty("usage_log")) return console.log("[migrate] usage_log: already populated, skipping");
  const entries = readJson("usage.json", []);
  if (!entries.length) return console.log("[migrate] usage_log: no usage.json, skipping");
  const insert = db.prepare(`INSERT INTO usage_log (twitchId, login, provider, ts, tokensIn, tokensOut) VALUES (@twitchId, @login, @provider, @ts, @tokensIn, @tokensOut)`);
  const txn = db.transaction((list) => {
    for (const e of list) insert.run(e);
  });
  txn(entries);
  console.log(`[migrate] usage_log: imported ${entries.length}`);
}

function migrateErrorLog() {
  if (!tableEmpty("error_log")) return console.log("[migrate] error_log: already populated, skipping");
  const entries = readJson("error-log.json", []);
  if (!entries.length) return console.log("[migrate] error_log: no error-log.json, skipping");
  const insert = db.prepare(`INSERT INTO error_log (id, timestamp, message, stack, source, url, userAgent, twitchLogin) VALUES (@id, @timestamp, @message, @stack, @source, @url, @userAgent, @twitchLogin)`);
  const txn = db.transaction((list) => {
    for (const e of list) insert.run(e);
  });
  txn(entries);
  console.log(`[migrate] error_log: imported ${entries.length}`);
}

function migrateAgentSessions() {
  if (!tableEmpty("agent_sessions")) return console.log("[migrate] agent_sessions: already populated, skipping");
  const saved = readJson(".agent-sessions.json", {});
  const insert = db.prepare(`INSERT INTO agent_sessions (provider, twitchId, sessionId, started) VALUES (?, ?, ?, ?)`);
  let count = 0;
  const txn = db.transaction(() => {
    for (const provider of ["claude", "grok", "agy"]) {
      const entry = saved[provider];
      // Old file shape (pre per-user sessions) was a single { id, started }
      // per provider shared site-wide — not a safe owner to migrate, skip it.
      if (!entry || typeof entry !== "object" || typeof entry.id === "string") continue;
      for (const [twitchId, s] of Object.entries(entry)) {
        if (s && typeof s.id === "string") {
          insert.run(provider, twitchId, s.id, s.started ? 1 : 0);
          count++;
        }
      }
    }
  });
  txn();
  console.log(`[migrate] agent_sessions: imported ${count}`);
}

function migrateMemoryDownloadState() {
  if (!tableEmpty("memory_download_state")) return console.log("[migrate] memory_download_state: already populated, skipping");
  const state = readJson(".memory-download-state.json", {});
  const entries = Object.entries(state).filter(([, v]) => v && typeof v.lastDownloadAt === "number");
  if (!entries.length) return console.log("[migrate] memory_download_state: no .memory-download-state.json, skipping");
  const insert = db.prepare(`INSERT INTO memory_download_state (twitchId, lastDownloadAt) VALUES (?, ?)`);
  const txn = db.transaction((list) => {
    for (const [twitchId, v] of list) insert.run(twitchId, v.lastDownloadAt);
  });
  txn(entries);
  console.log(`[migrate] memory_download_state: imported ${entries.length}`);
}

function migrateVideoQueue() {
  if (!tableEmpty("video_queue")) return console.log("[migrate] video_queue: already populated, skipping");
  const all = readJson(path.join("data", "videoQueue.json"), {});
  const entries = Object.entries(all);
  if (!entries.length) return console.log("[migrate] video_queue: no data/videoQueue.json, skipping");
  const insert = db.prepare(`INSERT INTO video_queue (twitchId, state) VALUES (?, ?)`);
  const txn = db.transaction((list) => {
    for (const [twitchId, state] of list) insert.run(twitchId, JSON.stringify(state));
  });
  txn(entries);
  console.log(`[migrate] video_queue: imported ${entries.length}`);
}

function migrateXp() {
  if (!tableEmpty("xp_users")) return console.log("[migrate] xp_users: already populated, skipping");
  const dir = path.join(__dirname, "xp-data");
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return console.log("[migrate] xp_users: no xp-data/ dir, skipping");
  }
  if (!files.length) return console.log("[migrate] xp_users: no per-account files, skipping");
  const insert = db.prepare(`INSERT INTO xp_users (twitchId, usernameLower, username, color, xp, messages) VALUES (?, ?, ?, ?, ?, ?)`);
  let count = 0;
  const txn = db.transaction(() => {
    for (const file of files) {
      const twitchId = file.replace(/\.json$/, "");
      const users = readJson(path.join("xp-data", file), {});
      for (const [usernameLower, u] of Object.entries(users)) {
        insert.run(twitchId, usernameLower, u.username, u.color || null, u.xp || 0, u.messages || 0);
        count++;
      }
    }
  });
  txn();
  console.log(`[migrate] xp_users: imported ${count}`);
}

console.log(`[migrate] target DB (env=${ENV}): ${DB_PATH}`);
migrateUsers();
migrateChatOverlayConfig();
migrateSiteConfig();
migrateDevices();
migrateUsage();
migrateErrorLog();
migrateAgentSessions();
migrateMemoryDownloadState();
migrateVideoQueue();
migrateXp();
console.log("[migrate] done.");
