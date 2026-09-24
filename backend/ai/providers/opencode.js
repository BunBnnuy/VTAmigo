// OpenCode CLI provider (`opencode run`), pointed at OpenCode Zen (or any
// provider whose API key is in the environment). Sessions are assigned by
// opencode itself: the first call opens one and the JSON event stream carries
// its id, later calls continue it with --session.
//
// Hardening (the process boundary lives in agentHardening.js):
//   --format json        machine-readable events; every line carries sessionID
//                        and text parts are complete when emitted.
//   OPENCODE_PURE / OPENCODE_DISABLE_DEFAULT_PLUGINS  skip plugins.
//   OPENCODE_DISABLE_PROJECT_CONFIG  a planted opencode.json in the scratch
//                        cwd can never load (defense in depth; cwd is empty).
//   OPENCODE_DISABLE_AUTOUPDATE  a spawned child must not replace its binary.
//   OPENCODE_PERMISSION  denies every tool. The config defaults define read /
//                        external_directory / doom_loop explicitly, and
//                        config.permission is merged LAST over those defaults
//                        (Agent.state in the CLI), so a bare {"*":"deny"}
//                        would leave read allowed — every defaulted key is
//                        denied explicitly. "deny" fails closed: a
//                        non-interactive run can never get an allow prompt.
//   OPENCODE_CONFIG_DIR  (set by buildRestrictedEnv, like CLAUDE_CONFIG_DIR)
//                        points into the empty tmp home, so the service
//                        account's real config/auth is never read. Auth rides
//                        in via OPENCODE_API_KEY (kept by the *_api_key
//                        allowlist) or OPENCODE_AUTH_CONTENT (re-passed below
//                        because it doesn't match the allowlist).
const fs = require("fs");
const path = require("path");

const DENY_ALL_PERMISSIONS = JSON.stringify({
  "*": "deny",
  read: { "*": "deny" },
  external_directory: { "*": "deny" },
  doom_loop: "deny",
  question: "deny",
  plan_enter: "deny",
  plan_exit: "deny",
});

function defaultExe() {
  if (process.env.OPENCODE_PATH) return process.env.OPENCODE_PATH;
  // On Windows the npm shim is a .cmd, which spawn(shell:false) can't run —
  // fall back to the real binary the npm package downloads. On Linux the
  // binary is on PATH and the plain name works.
  if (process.platform === "win32" && process.env.APPDATA) {
    for (const pkg of ["opencode-windows-x64", "opencode-windows-x64-baseline"]) {
      const candidate = path.join(
        process.env.APPDATA,
        "npm",
        "node_modules",
        "opencode-ai",
        "node_modules",
        pkg,
        "bin",
        "opencode.exe"
      );
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return "opencode";
}

module.exports = {
  id: "opencode",
  label: "OpenCode",
  exe: defaultExe,
  // All hardening for this provider is env-driven (see above), not argv.
  hardeningArgs: [],
  env: () => {
    const env = {
      OPENCODE_PURE: "1",
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_PERMISSION: DENY_ALL_PERMISSIONS,
    };
    if (process.env.OPENCODE_AUTH_CONTENT) {
      env.OPENCODE_AUTH_CONTENT = process.env.OPENCODE_AUTH_CONTENT;
    }
    return env;
  },
  session: {
    // No flag opens a session: the CLI creates one and reports its id.
    startArgs: () => [],
    resumeArgs: (sess) => (sess.id ? ["--session", sess.id] : []),
  },
  buildArgs({ prompt, sessionArgs = [], model = null }) {
    const args = ["run", prompt, ...sessionArgs, "--format", "json"];
    if (model) args.push("--model", model);
    return args;
  },
  parse(stdout) {
    const lines = stdout.split(/\r?\n/);
    const texts = [];
    let sessionId = null;
    let sawEvent = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let ev;
      try {
        ev = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (!ev || typeof ev !== "object") continue;
      sawEvent = true;
      if (!sessionId && typeof ev.sessionID === "string") sessionId = ev.sessionID;
      if (ev.type === "text" && ev.part && typeof ev.part.text === "string") texts.push(ev.part.text);
    }
    // Unparseable output (e.g. an older CLI) falls back to raw stdout, like
    // the other providers; the session is then simply restarted next call.
    if (!sawEvent) return { text: stdout.trim(), sessionId: null };
    return { text: texts.join("\n").trim(), sessionId };
  },
  DENY_ALL_PERMISSIONS,
};
