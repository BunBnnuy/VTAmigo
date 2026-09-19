// Process-boundary hardening for the server-side agent CLIs (claude/grok/agy)
// spawned by backend/claude.js and backend/memoryExportWorker.js.
//
// Security Issue 1: POST /respond (and /event) feed user-controlled chat text
// into general-purpose *coding-agent* CLIs. Those CLIs ship with file/shell/
// plugin/hook/skill/MCP tools, and the backend used to spawn them inheriting
// the backend's cwd and full environment under the vtamigo service account —
// so a prompt-injected model could read backend code and secrets, or run
// shell commands as that user.
//
// Defense in depth here (no single layer is trusted on its own):
//   1. Per-provider CLI flags that remove tool/plugin/skill/MCP surfaces.
//   2. An isolated scratch cwd (never the backend repo dir).
//   3. A minimal allowlist env: PATH + proxy + `*_API_KEY`/`*_AUTH_TOKEN`
//      auth vars only; HOME and every known agent config-dir override point
//      at empty tmp dirs.
// Prompt-level delimiting (wrapSystemPrompt/wrapUntrusted in claude.js) stays
// as the inner layer; this module is the process boundary.
//
// Pure functions with no side effects on require, so the worker thread and
// the test suite can load this module directly.
const fs = require("fs");
const os = require("os");
const path = require("path");

// ---------------------------------------------------------------------------
// Prompt input validation
// ---------------------------------------------------------------------------

// Upper bound for the streamer-controlled basePrompt accepted via POST
// /respond and /event. Long enough for a real persona, short enough to keep
// the prompt bounded and to blunt prompt-stuffing.
const MAX_BASE_PROMPT_LENGTH = 2000;
// Bounds for viewer-controlled chat lines. buildPrompt used to interpolate
// unbounded text; a single 100kb-message caller (express.json limit) could
// otherwise blow up the CLI command line.
const MAX_MESSAGE_TEXT_LENGTH = 2000;
const MAX_MESSAGES = 50;
const MAX_USERNAME_LENGTH = 100;
const MAX_REWARD_TITLE_LENGTH = 200;

// Control characters (minus \t \n \r, which are legitimate prompt
// whitespace) cover terminal escape smuggling (\x1b), null bytes, and other
// non-printables that have no business in a chat prompt or basePrompt.
const CONTROL_CHARS_RE = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(8) + String.fromCharCode(11, 12) + String.fromCharCode(14) + "-" + String.fromCharCode(31) + String.fromCharCode(127) + "]", "g");

function stripControlChars(s) {
  return String(s ?? "").replace(CONTROL_CHARS_RE, "");
}

// Our own prompt-framing tags. wrapUntrusted() in claude.js wraps viewer text
// in <untrusted_data>…</untrusted_data>; a chat line containing a literal
// closing tag would break out of that block and could then masquerade as
// trusted instructions. Neutralize any such sequence inside untrusted text
// (and inside basePrompt, so the trusted block can't be broken either) by
// rendering it as bracketed text instead of a tag.
const OWN_TAG_RE = /<(\/?)(system_instructions|untrusted_data)\b/gi;

function neutralizeOwnTags(s) {
  return String(s ?? "").replace(OWN_TAG_RE, "[$1$2]");
}

// The streamer's basePrompt is semi-trusted (it comes from an authenticated
// user, and only ever affects their own bot), but it is still user input:
// bound it, strip control chars, and keep our framing tags unforgeable.
function sanitizeBasePrompt(input) {
  if (typeof input !== "string") return "";
  return neutralizeOwnTags(stripControlChars(input)).trim().slice(0, MAX_BASE_PROMPT_LENGTH);
}

function safeText(s, max) {
  return stripControlChars(s).slice(0, max);
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const out = [];
  for (const m of messages) {
    if (out.length >= MAX_MESSAGES) break;
    if (!m || typeof m !== "object") continue;
    const clean = {
      username: safeText(m.username || "anon", MAX_USERNAME_LENGTH),
      text: safeText(m.text || "", MAX_MESSAGE_TEXT_LENGTH),
    };
    if (m.isRedeem) {
      clean.isRedeem = true;
      clean.rewardTitle = safeText(m.rewardTitle || "Canje de puntos de canal", MAX_REWARD_TITLE_LENGTH);
    }
    out.push(clean);
  }
  return out;
}

// ---------------------------------------------------------------------------
// CLI tool-surface flags, per provider.
//
// Verified 2026-09 against the exact binaries this backend shells out to
// (`<cli> --help` on the deploy box); version floors are noted where a flag
// is recent. Unknown flags make these CLIs exit non-zero, which surfaces
// through the existing CLI error path (never silently ignored), so a stale
// binary fails loudly instead of running unhardened.
// ---------------------------------------------------------------------------

// Claude Code: --tools "" disables ALL built-in tools (verified in --help:
// 'Use "" to disable all tools'); --strict-mcp-config with no --mcp-config
// means zero MCP servers; --disable-slash-commands disables all skills;
// --bare skips hooks, plugin sync, auto-memory and CLAUDE.md discovery —
// and, critically, makes auth strictly ANTHROPIC_API_KEY (OAuth/keychain
// files are never read), which is why file-credential copying was removed
// from server/install-service.sh; --permission-mode dontAsk denies anything
// left by default. Deliberately NOT --no-session-persistence: persistent
// --session-id/--resume sessions are the product feature.
// (--setting-sources has no "none" value — valid options are only
// user,project,local — so there is no reliable flag to fully unload settings
// files; --tools "" makes their permission rules moot because no tool
// remains in the model's context to approve.)
const CLAUDE_HARDENING_ARGS = [
  "--bare",
  "--tools", "",
  "--disallowedTools", "mcp__*",
  "--strict-mcp-config",
  "--disable-slash-commands",
  "--permission-mode", "dontAsk",
];

// Grok CLI: --tools takes the built-in allow-list (comma-separated); an
// empty value was verified accepted (exit 0) via node spawn. --max-turns 1
// was probed live: a file-read attempt burned the single turn on the tool
// call and the content never came back ("Max turns reached"), so even a
// tool the allow-list missed can't exfiltrate through the transcript.
// --disable-web-search / --no-subagents / --permission-mode dontAsk are
// verbatim --help flags. NOT used: --sandbox (takes an undocumented
// <PROFILE> value — guessing one risks a startup failure; the scratch
// cwd + minimal env below are the sandbox) and --deny/--disallowed-tools
// (redundant once the allow-list is empty).
const GROK_HARDENING_ARGS = [
  "--tools", "",
  "--disable-web-search",
  "--no-subagents",
  "--permission-mode", "dontAsk",
  "--max-turns", "1",
];

// AGY CLI: --help exposes exactly one restriction flag — --sandbox (boolean,
// "terminal restrictions enabled"), verified accepted via node spawn. There
// are NO --tools / --disallowedTools / --permission-mode equivalents, so for
// AGY the cwd + env isolation below and the prompt delimiting do the heavy
// lifting; --sandbox is still strictly better than the default. (Also
// deliberately NOT passed: --dangerously-skip-permissions — that would
// auto-approve the very tool prompts we want denied.)
const AGY_HARDENING_ARGS = ["--sandbox"];

function getHardeningArgs(provider) {
  if (provider === "grok") return [...GROK_HARDENING_ARGS];
  if (provider === "agy") return [...AGY_HARDENING_ARGS];
  return [...CLAUDE_HARDENING_ARGS];
}

// ---------------------------------------------------------------------------
// Isolated working directory
// ---------------------------------------------------------------------------

const SCRATCH_ROOT_NAME = "vtamigo-agent-scratch";

function getScratchRoot() {
  const dir = path.join(os.tmpdir(), SCRATCH_ROOT_NAME);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// The agent CLIs must never run with the backend repo as cwd: several of
// them treat cwd as the workspace (file tools resolve relative paths there,
// session transcripts key off it). Run them in an empty tmp work dir.
// A caller-supplied cwd is honored only if it exists, is a directory, and
// resolves OUTSIDE the backend tree — otherwise it falls back to scratch.
function resolveAgentCwd(requestedCwd) {
  const scratch = path.join(getScratchRoot(), "work");
  fs.mkdirSync(scratch, { recursive: true });
  if (typeof requestedCwd === "string" && requestedCwd) {
    try {
      const abs = path.resolve(requestedCwd);
      const backendRoot = path.resolve(__dirname);
      const rel = path.relative(backendRoot, abs);
      const insideBackend = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
      if (!insideBackend && fs.statSync(abs).isDirectory()) return abs;
    } catch {
      // Unresolvable / not a directory — fall through to scratch.
    }
  }
  return scratch;
}

// An intentionally empty home dir for the agent child processes. Nothing
// reads credentials from here (Claude --bare ignores OAuth files by design;
// API-key auth rides in on the preserved env vars below), and nothing
// sensitive may be written here by the backend.
function getEmptyHome() {
  const dir = path.join(getScratchRoot(), "empty-home");
  fs.mkdirSync(dir, { recursive: true });
  for (const sub of ["claude", "grok", "agy", "config", "cache", "data"]) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Minimal environment
// ---------------------------------------------------------------------------

// Passed through verbatim when present: process lookup + temp files.
// PATHEXT/SystemRoot/SystemDrive are Windows-only but harmless to list.
const VERBATIM_ENV_VARS = ["PATH", "Path", "PATHEXT", "SystemRoot", "SystemDrive", "TEMP", "TMP"];
// Case-insensitive allow patterns for vars the CLI needs to function:
//  - proxy vars (no network without them behind a proxy),
//  - API-key/auth-token vars (the ONLY auth channel once HOME is emptied:
//    e.g. ANTHROPIC_API_KEY, XAI_API_KEY).
// Everything else — SESSION_SECRET, TWITCH_*_SECRET, ADMIN_PASSWORD,
// database paths, feature flags — is dropped so a compromised child can't
// even see it. Notably NEVER passed: NODE_OPTIONS (arbitrary --require
// injection), LD_PRELOAD / DYLD_* (library injection).
const PRESERVE_ENV_PATTERNS = [/^(https?|all)_proxy$/i, /^no_proxy$/i, /(_api_key|_auth_token)$/i];

function buildRestrictedEnv(sourceEnv = process.env) {
  const env = {};
  for (const name of VERBATIM_ENV_VARS) {
    if (sourceEnv[name] != null) env[name] = String(sourceEnv[name]);
  }
  for (const name of Object.keys(sourceEnv)) {
    if (name in env) continue;
    if (PRESERVE_ENV_PATTERNS.some((re) => re.test(name))) env[name] = String(sourceEnv[name]);
  }

  const emptyHome = getEmptyHome();
  env.HOME = emptyHome;
  env.USERPROFILE = emptyHome; // Windows equivalent of HOME
  if (process.platform === "win32") {
    const { root } = path.parse(emptyHome);
    env.HOMEDRIVE = root.replace(/\\$/, "");
    env.HOMEPATH = emptyHome.slice(env.HOMEDRIVE.length) || "\\";
  }
  env.XDG_CONFIG_HOME = path.join(emptyHome, "config");
  env.XDG_CACHE_HOME = path.join(emptyHome, "cache");
  env.XDG_DATA_HOME = path.join(emptyHome, "data");
  // Config-dir overrides, so even a CLI that ignores HOME can't wander back
  // to the service account's real config. CLAUDE_CONFIG_DIR is documented;
  // GROK_/AGY_ names are best-effort (no equivalent found in their --help) —
  // harmless if unrecognized, and cwd/env/flags still bind those CLIs.
  env.CLAUDE_CONFIG_DIR = path.join(emptyHome, "claude");
  env.GROK_CONFIG_DIR = path.join(emptyHome, "grok");
  env.AGY_CONFIG_DIR = path.join(emptyHome, "agy");
  // Best-effort telemetry off-switch (common convention; ignored if unknown).
  env.DISABLE_TELEMETRY = "1";
  return env;
}

module.exports = {
  MAX_BASE_PROMPT_LENGTH,
  MAX_MESSAGE_TEXT_LENGTH,
  MAX_MESSAGES,
  CLAUDE_HARDENING_ARGS,
  GROK_HARDENING_ARGS,
  AGY_HARDENING_ARGS,
  getHardeningArgs,
  getScratchRoot,
  resolveAgentCwd,
  getEmptyHome,
  buildRestrictedEnv,
  sanitizeBasePrompt,
  sanitizeMessages,
  neutralizeOwnTags,
  stripControlChars,
};
