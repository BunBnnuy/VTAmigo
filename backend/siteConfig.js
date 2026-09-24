// Site-wide settings, controlled only from the Admin panel — which AI
// provider answers chat/events for every user on the site and which model it
// runs (a per-user "preselected model" in Settings is intentionally ignored;
// this is the single source of truth). Stored as a single row in the
// site_config SQLite table (see db.js) — previously a flat JSON file
// (.site-config.json).
const { db } = require("./db");

const VALID_PROVIDERS = ["claude", "grok", "opencode"];
const DEFAULT_PROVIDER = "claude";

// Default model per provider, used until an admin overrides it. Only
// providers whose CLI takes a model flag use it; grok ignores it. Values are
// provider-native ids — for opencode that's `<provider>/<model>` exactly as
// `opencode models` prints them.
// Space Bunny Free is the only no-API-key Zen free model that works while the
// CLI runs with every tool permission denied (other free models answer a 403
// "free tier can only be used from within OpenCode" under restrictive
// permissions). It's also zero-retention. Free ids are limited-time, so
// expect to swap the model in the admin panel when Zen rotates it.
const DEFAULT_MODELS = { opencode: "opencode/space-bunny-free" };

// Model ids are passed as argv to the provider CLIs, so keep them to the
// characters real ids use (`opencode/claude-haiku-4-5`) and bound the length.
const MAX_MODEL_LENGTH = 120;
const MODEL_RE = /^[A-Za-z0-9._:/-]+$/;

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

function getModel(provider = getProvider()) {
  const models = config.aiModels && typeof config.aiModels === "object" ? config.aiModels : {};
  const own = models[provider];
  if (typeof own === "string" && own.trim()) return own.trim();
  return DEFAULT_MODELS[provider] || null;
}

function setModel(provider, model) {
  if (!VALID_PROVIDERS.includes(provider)) throw new Error("Invalid provider");
  const clean = typeof model === "string" ? model.trim() : "";
  if (clean && (clean.length > MAX_MODEL_LENGTH || !MODEL_RE.test(clean))) {
    throw new Error("Invalid model");
  }
  const models = { ...(config.aiModels || {}) };
  if (clean) models[provider] = clean;
  else delete models[provider];
  config = { ...config, aiModels: models };
  save();
}

module.exports = { getProvider, setProvider, getModel, setModel, VALID_PROVIDERS, DEFAULT_MODELS };
