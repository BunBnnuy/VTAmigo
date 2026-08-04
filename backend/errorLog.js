// Client-side error log — frontend app errors (uncaught exceptions, unhandled
// promise rejections, React render errors, and explicit logError() calls) are
// POSTed here so they're visible from the Admin panel instead of only living
// in a viewer's own devtools console. Same flat-JSON-file storage pattern as
// siteConfig.js / devices.js.
const fs = require("fs");
const path = require("path");

const LOG_FILE = path.join(__dirname, "error-log.json");
const MAX_ENTRIES = 500;

function load() {
  try {
    return JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
  } catch {
    return [];
  }
}

let entries = load();

function save() {
  try {
    fs.writeFileSync(LOG_FILE, JSON.stringify(entries, null, 2));
  } catch (err) {
    console.error("Failed to save error log:", err.message);
  }
}

function addEntry({ message, stack, source, url, userAgent, twitchLogin }) {
  entries.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    message: String(message || "Unknown error").slice(0, 2000),
    stack: stack ? String(stack).slice(0, 4000) : null,
    source: source ? String(source).slice(0, 200) : null,
    url: url ? String(url).slice(0, 500) : null,
    userAgent: userAgent ? String(userAgent).slice(0, 300) : null,
    twitchLogin: twitchLogin || null,
  });
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  save();
}

function getEntries() {
  return entries;
}

function clear() {
  entries = [];
  save();
}

module.exports = { addEntry, getEntries, clear };
