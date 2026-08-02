// Tracks the 24h cooldown on downloading the bot's current memory as a file,
// persisted to disk so it survives backend restarts and can't be reset by
// just reloading the page.
const fs = require("fs");
const path = require("path");
const { dumpMemory } = require("./claude");

const STATE_FILE = path.join(__dirname, ".memory-download-state.json");
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { lastDownloadAt: 0 };
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch (err) {
    console.error("Failed to save memory download state:", err.message);
  }
}

function getStatus() {
  const { lastDownloadAt } = loadState();
  return { availableAt: lastDownloadAt ? lastDownloadAt + COOLDOWN_MS : 0 };
}

async function download(provider) {
  const { availableAt } = getStatus();
  if (Date.now() < availableAt) {
    const err = new Error("COOLDOWN");
    err.availableAt = availableAt;
    throw err;
  }
  const markdown = await dumpMemory(provider);
  saveState({ lastDownloadAt: Date.now() });
  return markdown;
}

module.exports = { getStatus, download };
