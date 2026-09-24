// Claude Code CLI provider: spawns `claude -p` and keeps one persistent
// session per Twitch account (--session-id opens it, --resume continues it).
//
// Hardening flags (the process boundary lives in agentHardening.js):
// --tools "" disables ALL built-in tools (verified in --help: 'Use "" to
// disable all tools'); --strict-mcp-config with no --mcp-config means zero
// MCP servers; --disable-slash-commands disables all skills; --bare skips
// hooks, plugin sync, auto-memory and CLAUDE.md discovery — and, critically,
// makes auth strictly ANTHROPIC_API_KEY (OAuth/keychain files are never
// read), which is why file-credential copying was removed from
// server/install-service.sh; --permission-mode dontAsk denies anything left
// by default. Deliberately NOT --no-session-persistence: persistent
// --session-id/--resume sessions are the product feature.
// (--setting-sources has no "none" value — valid options are only
// user,project,local — so there is no reliable flag to fully unload settings
// files; --tools "" makes their permission rules moot because no tool
// remains in the model's context to approve.)
const HARDENING_ARGS = [
  "--bare",
  "--tools", "",
  "--disallowedTools", "mcp__*",
  "--strict-mcp-config",
  "--disable-slash-commands",
  "--permission-mode", "dontAsk",
];

module.exports = {
  id: "claude",
  label: "Claude",
  // Resolved at call time so tests can point the env var at a shim.
  exe: () =>
    process.env.CLAUDE_PATH ||
    "C:\\Users\\beton\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe\\claude.exe",
  hardeningArgs: HARDENING_ARGS,
  session: {
    startArgs: (sess) => ["--session-id", sess.id],
    resumeArgs: (sess) => ["--resume", sess.id],
  },
  buildArgs({ prompt, sessionArgs = [], model = null }) {
    const args = ["-p", prompt, ...sessionArgs];
    if (model) args.push("--model", model);
    return args;
  },
  parse: (stdout) => ({ text: stdout.trim(), sessionId: null }),
};
