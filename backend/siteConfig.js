// Site-wide settings, controlled only from the Admin panel — currently just
// which AI provider answers chat/events for every user on the site (a
// per-user "preselected model" in Settings is intentionally ignored; this is
// the single source of truth). Stored as a single row in the site_config
// SQLite table (see db.js) — previously a flat JSON file (.site-config.json).
const { db } = require("./db");

const VALID_PROVIDERS = ["claude", "grok"];
const DEFAULT_PROVIDER = "claude";

function load() {
  try {
    const row = db.prepare(`SELECT config FROM site_config WHERE id = 1`).get();
    return row ? JSON.parse(row.config) : {};
  } catch {
    return {};
  }
}

let config = load();

function save() {
  try {
    db.prepare(`
      INSERT INTO site_config (id, config) VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET config = excluded.config
    `).run(JSON.stringify(config));
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
