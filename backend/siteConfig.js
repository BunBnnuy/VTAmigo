// Site-wide settings, controlled only from the Admin panel — currently just
// which AI provider answers chat/events for every user on the site (a
// per-user "preselected model" in Settings is intentionally ignored; this is
// the single source of truth).
const fs = require("fs");
const path = require("path");

const CONFIG_FILE = path.join(__dirname, ".site-config.json");
const VALID_PROVIDERS = ["claude", "grok"];
const DEFAULT_PROVIDER = "claude";

function load() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

let config = load();

function save() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error("Failed to save site config:", err.message);
  }
}

function getProvider() {
  return VALID_PROVIDERS.includes(config.aiProvider) ? config.aiProvider : DEFAULT_PROVIDER;
}

function setProvider(provider) {
  if (!VALID_PROVIDERS.includes(provider)) throw new Error("Invalid provider");
  config = { ...config, aiProvider: provider };
  save();
}

module.exports = { getProvider, setProvider, VALID_PROVIDERS };
