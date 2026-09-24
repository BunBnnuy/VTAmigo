// AGY CLI provider: spawns `agy -p --output-format json`. Unlike claude/grok
// the session id is assigned by the CLI itself — the first call opens a new
// conversation and the JSON response carries its id, which later calls
// continue with --conversation.
//
// Hardening flags (the process boundary lives in agentHardening.js):
// --help exposes exactly one restriction flag — --sandbox (boolean,
// "terminal restrictions enabled"), verified accepted via node spawn. There
// are NO --tools / --disallowedTools / --permission-mode equivalents, so for
// AGY the cwd + env isolation and the prompt delimiting do the heavy
// lifting; --sandbox is still strictly better than the default. (Also
// deliberately NOT passed: --dangerously-skip-permissions — that would
// auto-approve the very tool prompts we want denied.)
const path = require("path");

const HARDENING_ARGS = ["--sandbox"];

module.exports = {
  id: "agy",
  label: "AGY",
  exe: () =>
    process.env.AGY_PATH ||
    (process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "agy", "bin", "agy.exe")
      : "C:\\Users\\beton\\AppData\\Local\\agy\\bin\\agy.exe"),
  hardeningArgs: HARDENING_ARGS,
  session: {
    // No flag opens a session: the CLI creates one and reports its id.
    startArgs: () => [],
    resumeArgs: (sess) => (sess.id ? ["--conversation", sess.id] : []),
  },
  buildArgs({ prompt, sessionArgs = [], model = null }) {
    const args = ["-p", prompt, ...sessionArgs, "--output-format", "json"];
    if (model) args.push("--model", model);
    return args;
  },
  parse(stdout) {
    try {
      const parsed = JSON.parse(stdout.trim());
      return {
        text: parsed.response != null ? String(parsed.response).trim() : stdout.trim(),
        sessionId: parsed.conversation_id || null,
      };
    } catch {
      // If JSON parse failed, fall back to plain stdout.
      return { text: stdout.trim(), sessionId: null };
    }
  },
};
