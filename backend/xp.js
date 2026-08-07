const { db } = require("./db");

// Users that never earn XP (the AI itself + known chat bots).
// Overridden per-account by the frontend's "Ignored Users" setting via POST /xp/config.
const DEFAULT_IGNORED = "jonejo_ia, streamelements, nightbot, moobot, fossabot, streamlabs, soundalerts, wizebot, botisimo, coebot, sery_bot, kofistreambot, commanderroot, virgoproz, aparatchik, logviewer, electricallongboard, anotherttvviewer, twitchraidshadow";

// Per-account state, keyed by twitchId — each connected Twitch account has its
// own viewer XP pool and its own save file, mirroring the twitchId-keyed maps
// used elsewhere (vtubeManager's contexts, index.js's twitchSessions) so one
// streamer's viewers/resets/ignore-list can't affect another's.
const accounts = new Map(); // twitchId -> { users, ignored, saveTimer }

const selectAccountUsersStmt = db.prepare(`SELECT usernameLower, username, color, xp, messages FROM xp_users WHERE twitchId = ?`);
const upsertXpUserStmt = db.prepare(`
  INSERT INTO xp_users (twitchId, usernameLower, username, color, xp, messages)
  VALUES (@twitchId, @usernameLower, @username, @color, @xp, @messages)
  ON CONFLICT(twitchId, usernameLower) DO UPDATE SET
    username = excluded.username, color = excluded.color, xp = excluded.xp, messages = excluded.messages
`);
const deleteAccountXpStmt = db.prepare(`DELETE FROM xp_users WHERE twitchId = ?`);

function getAccount(twitchId) {
  let acc = accounts.get(twitchId);
  if (acc) return acc;
  const users = {};
  for (const row of selectAccountUsersStmt.all(twitchId)) {
    users[row.usernameLower] = { username: row.username, color: row.color, xp: row.xp, messages: row.messages };
  }
  acc = {
    users,
    ignored: new Set(DEFAULT_IGNORED.split(",").map((n) => n.trim().toLowerCase())),
    saveTimer: null,
  };
  accounts.set(twitchId, acc);
  return acc;
}

function scheduleSave(twitchId, acc) {
  if (acc.saveTimer) return;
  acc.saveTimer = setTimeout(() => {
    acc.saveTimer = null;
    try {
      const txn = db.transaction((users) => {
        for (const [usernameLower, u] of Object.entries(users)) {
          upsertXpUserStmt.run({ twitchId, usernameLower, username: u.username, color: u.color, xp: u.xp, messages: u.messages });
        }
      });
      txn(acc.users);
    } catch (err) {
      console.error("[xp] save failed:", err.message);
    }
  }, 2000);
}

// XP required to advance from `level` to `level + 1` — exponential curve
function xpToNext(level) {
  return Math.round(50 * Math.pow(1.35, level - 1));
}

// Total XP → { level, into, needed }
function levelFromXp(xp) {
  let level = 1;
  let rem = xp;
  while (rem >= xpToNext(level)) {
    rem -= xpToNext(level);
    level++;
  }
  return { level, into: rem, needed: xpToNext(level) };
}

function setIgnored(twitchId, list) {
  const acc = getAccount(twitchId);
  const names = Array.isArray(list) ? list : String(list).split(",");
  acc.ignored = new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean));
}

// Record a chat message for one account and return an XP event for
// broadcasting, or null if the user is on that account's ignore list
function addMessage(twitchId, username, text, color) {
  const acc = getAccount(twitchId);
  const key = username.toLowerCase();
  if (acc.ignored.has(key)) return null;
  const gained = Math.round(text.length / 10);
  const u = acc.users[key] || (acc.users[key] = { username, color: color || "#9147ff", xp: 0, messages: 0 });
  u.username = username;
  if (color) u.color = color;
  u.messages++;

  const before = levelFromXp(u.xp);
  u.xp += gained;
  const after = levelFromXp(u.xp);
  scheduleSave(twitchId, acc);

  return {
    username: u.username,
    color: u.color,
    gained,
    xp: u.xp,
    messages: u.messages,
    level: after.level,
    levelUp: after.level > before.level,
    xpIntoLevel: after.into,
    xpNeeded: after.needed,
    prevLevel: before.level,
    prevXpIntoLevel: before.into,
    prevXpNeeded: before.needed,
  };
}

function getRanking(twitchId, limit = 10) {
  const acc = getAccount(twitchId);
  return Object.values(acc.users)
    .sort((a, b) => b.xp - a.xp)
    .slice(0, limit)
    .map((u) => {
      const { level, into, needed } = levelFromXp(u.xp);
      return { username: u.username, color: u.color, xp: u.xp, messages: u.messages, level, xpIntoLevel: into, xpNeeded: needed };
    });
}

// Wipe one account's XP data (memory + DB)
function reset(twitchId) {
  const acc = getAccount(twitchId);
  acc.users = {};
  if (acc.saveTimer) { clearTimeout(acc.saveTimer); acc.saveTimer = null; }
  try {
    deleteAccountXpStmt.run(twitchId);
  } catch (err) {
    console.error("[xp] reset failed:", err.message);
  }
}

module.exports = { addMessage, getRanking, reset, setIgnored };
