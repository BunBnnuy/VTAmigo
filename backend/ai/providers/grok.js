// Grok CLI provider: spawns `grok -p` with one persistent session per
// Twitch account (--session-id opens it, --resume continues it).
//
// Hardening flags (the process boundary lives in agentHardening.js):
// --tools takes the built-in allow-list (comma-separated); an empty value
// was verified accepted (exit 0) via node spawn. --max-turns 1 was probed
// live: a file-read attempt burned the single turn on the tool call and the
// content never came back ("Max turns reached"), so even a tool the
// allow-list missed can't exfiltrate through the transcript.
// --disable-web-search / --no-subagents / --permission-mode dontAsk are
// verbatim --help flags. NOT used: --sandbox (takes an undocumented
// <PROFILE> value — guessing one risks a startup failure; the scratch cwd +
// minimal env below are the sandbox) and --deny/--disallowed-tools
// (redundant once the allow-list is empty).
const HARDENING_ARGS = [
  "--tools", "",
  "--disable-web-search",
  "--no-subagents",
  "--permission-mode", "dontAsk",
  "--max-turns", "1",
];

module.exports = {
  id: "grok",
  label: "Grok",
  exe: () => process.env.GROK_PATH || "C:\\Users\\beton\\.grok\\bin\\grok.exe",
  hardeningArgs: HARDENING_ARGS,
  session: {
    startArgs: (sess) => ["--session-id", sess.id],
    resumeArgs: (sess) => ["--resume", sess.id],
  },
  buildArgs({ prompt, sessionArgs = [] }) {
    // No --model: the Grok CLI does not take one here (only claude/agy do).
    return ["-p", prompt, ...sessionArgs];
  },
  parse: (stdout) => ({ text: stdout.trim(), sessionId: null }),
};
