// Provider registry — the single source of truth for which AI providers the
// backend can run. Adding a provider means adding one file under ./providers
// and listing it here; the session store, the memory import/export worker and
// the site/admin allow-lists all derive from this list.
//
// Descriptors are pure data/behaviour with no DB or env side effects at
// require time, so the memory-export worker thread can load the registry
// without opening its own SQLite connection.
//
// Descriptor contract:
//   id            provider id used everywhere (agent_sessions, site config)
//   label         human-readable name for error messages and the admin UI
//   exe()         absolute path to the CLI binary (env-overridable)
//   hardeningArgs per-provider argv flags that remove tool/plugin/skill/MCP
//                 surfaces (see agentHardening.js for the process boundary)
//   session.startArgs(sess)   argv opening a brand-new session
//   session.resumeArgs(sess)  argv continuing the given session
//   buildArgs({prompt, sessionArgs, model})  full argv minus hardening flags
//   parse(stdout) -> { text, sessionId }     provider output -> reply text;
//                 sessionId is set only by CLIs that assign ids themselves
//                 (agy) and is written back to the session by the runner.
const providers = [
  require("./providers/claude"),
  require("./providers/grok"),
  require("./providers/agy"),
  require("./providers/opencode"),
];

const byId = new Map(providers.map((p) => [p.id, p]));

function get(id) {
  const provider = byId.get(id);
  if (!provider) throw new Error(`UNKNOWN_PROVIDER: ${id}`);
  return provider;
}

function ids() {
  return providers.map((p) => p.id);
}

// Providers that keep a persistent per-user session (all current ones); the
// memory export/import paths are only valid between these.
function sessionIds() {
  return providers.filter((p) => p.session).map((p) => p.id);
}

// Extra environment a provider needs on top of the minimal allowlist
// (buildRestrictedEnv): e.g. opencode's permission/plugin switches. Merged
// after the allowlist so a descriptor can also re-add a var the allowlist
// dropped (opencode's OPENCODE_AUTH_CONTENT).
function envFor(id) {
  const provider = get(id);
  return typeof provider.env === "function" ? provider.env() : {};
}

function list() {
  return providers.map((p) => ({ id: p.id, label: p.label }));
}

module.exports = { get, ids, sessionIds, envFor, list };
