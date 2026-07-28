const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "xp-data.json");

// users keyed by lowercase username → { username, color, xp, messages }
let users = {};
let saveTimer = null;

// Users that never earn XP (the AI itself + known chat bots).
// Overridden by the frontend's "Ignored Users" setting via POST /xp/config.
const DEFAULT_IGNORED = "jonejo_ia, streamelements, nightbot, moobot, fossabot, streamlabs, soundalerts, wizebot, botisimo, coebot, sery_bot, kofistreambot, commanderroot, virgoproz, aparatchik, logviewer, electricallongboard, anotherttvviewer, twitchraidshadow";
let ignored = new Set();

function setIgnored(list) {
  const names = Array.isArray(list) ? list : String(list).split(",");
  ignored = new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean));
}
setIgnored(DEFAULT_IGNORED);

try {
  users = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
} catch {
  users = {};
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFile(DATA_FILE, JSON.stringify(users, null, 2), (err) => {
      if (err) console.error("[xp] save failed:", err.message);
    });
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

// Record a chat message and return an XP event for broadcasting,
// or null if the user is on the ignore list
function addMessage(username, text, color) {
  const key = username.toLowerCase();
  if (ignored.has(key)) return null;
  const gained = Math.round(text.length / 10);
  const u = users[key] || (users[key] = { username, color: color || "#9147ff", xp: 0, messages: 0 });
  u.username = username;
  if (color) u.color = color;
  u.messages++;

  const before = levelFromXp(u.xp);
  u.xp += gained;
  const after = levelFromXp(u.xp);
  scheduleSave();

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

function getRanking(limit = 10) {
  return Object.values(users)
    .sort((a, b) => b.xp - a.xp)
    .slice(0, limit)
    .map((u) => {
      const { level, into, needed } = levelFromXp(u.xp);
      return { username: u.username, color: u.color, xp: u.xp, messages: u.messages, level, xpIntoLevel: into, xpNeeded: needed };
    });
}

// Wipe all XP data (memory + disk)
function reset() {
  users = {};
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  fs.rm(DATA_FILE, { force: true }, (err) => {
    if (err) console.error("[xp] reset failed:", err.message);
  });
}

module.exports = { addMessage, getRanking, reset, setIgnored };
