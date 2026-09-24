// The single path every AI call takes: sanitize/build the prompt, pick the
// provider descriptor from the registry, run it under the process-boundary
// hardening, and manage that account's persistent session (resume, or open a
// fresh one after a broken session).
const { spawn } = require("child_process");
const errorLog = require("../errorLog");
const hardening = require("../agentHardening");
const registry = require("./registry");
const { getSession, resetSession, saveSessions, getQueue, setQueue } = require("./sessions");
const { buildPrompt, buildEventPrompt, rememberBasePrompt, stripMarkdown } = require("./prompt");

const TIMEOUT_MS = 60000;

// A CLI call that resolves cleanly (no thrown error) but with blank stdout
// surfaces to the user as "No response" with nothing to go on. Log it here —
// the single spot every provider branch funnels through — so it shows up in
// the admin error log with enough context (provider, prompt) to investigate.
function logEmptyResponse(out, { provider, twitchId, prompt }) {
  if (out != null && !String(out).trim()) {
    errorLog.addEntry({
      message: `${provider} CLI returned an empty response`,
      source: "runCLI:empty",
      stack: prompt ? `Prompt:\n${prompt.slice(0, 1000)}` : null,
      twitchLogin: twitchId || null,
    });
  }
  return out;
}

function runCLI(prompt, { provider = "claude", twitchId = null, model = null, cwd = null, timeoutMs = TIMEOUT_MS, session = true } = {}) {
  const desc = registry.get(provider);

  if (!session || !twitchId) {
    return spawnCLI(prompt, { provider, model, cwd, timeoutMs }).then((out) => logEmptyResponse(out, { provider, twitchId, prompt }));
  }

  const run = getQueue(provider, twitchId).then(async () => {
    const sess = getSession(provider, twitchId);
    const sessionArgs = sess.started ? desc.session.resumeArgs(sess) : desc.session.startArgs(sess);
    try {
      const out = await spawnCLI(prompt, { provider, model, cwd, timeoutMs, sessionArgs, sessionRef: sess });
      if (!sess.started) {
        sess.started = true;
        saveSessions();
      }
      return out;
    } catch (err) {
      // A broken/missing session would otherwise wedge the bot — start a
      // fresh one and retry once. Timeouts and missing CLIs aren't session
      // problems, so let those surface.
      if (sess.started && err.message !== "TIMEOUT" && err.message !== "CLI_NOT_FOUND") {
        resetSession(provider, twitchId);
        const fresh = getSession(provider, twitchId);
        const out = await spawnCLI(prompt, {
          provider, model, cwd, timeoutMs,
          sessionArgs: desc.session.startArgs(fresh),
          sessionRef: fresh,
        });
        fresh.started = true;
        saveSessions();
        return out;
      }
      throw err;
    }
  });

  setQueue(provider, twitchId, run.catch(() => {}));
  return run.then((out) => logEmptyResponse(out, { provider, twitchId, prompt }));
}

function spawnCLI(prompt, { provider = "claude", model = null, cwd = null, timeoutMs = TIMEOUT_MS, sessionArgs = [], sessionRef = null } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const desc = registry.get(provider);
    // Session args (-p prompt plus the provider's own session flags) keep
    // their exact positions and shapes; the hardening flags are appended
    // after them (flag order is irrelevant to these CLIs), so session
    // behavior is unchanged. See agentHardening.js for what each flag does
    // and the verification notes per provider.
    const args = [...desc.buildArgs({ prompt, sessionArgs, model }), ...desc.hardeningArgs];

    const proc = spawn(desc.exe(), args, {
      shell: false,
      windowsHide: true,
      // Never inherit the backend's cwd (agent CLIs treat cwd as their
      // workspace) nor its environment (backend secrets, tokens, paths).
      // resolveAgentCwd falls back to an isolated tmp work dir unless the
      // caller passed an explicit dir OUTSIDE the backend tree.
      cwd: hardening.resolveAgentCwd(cwd),
      // Provider-specific switches (opencode's permission/plugin lockdown)
      // merge on top of the minimal allowlist.
      env: { ...hardening.buildRestrictedEnv(process.env, provider), ...registry.envFor(provider) },
    });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
      reject(new Error("TIMEOUT"));
    }, timeoutMs);

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return;

      if (code !== 0) {
        const msg = stderr.trim() || `${provider} CLI exited with code ${code}`;
        // Deliberately NOT a bare "not found" match on stderr. We spawn with
        // shell:false, so a genuinely missing executable can only ever arrive
        // as ENOENT on the "error" event below — never as stderr text. Every
        // CLI, on the other hand, says "not found" about sessions, models and
        // files: grok answers a dead --resume id with `Session "…" not found
        // locally` / `404 Not Found`, which used to be reported to the
        // streamer as "Grok CLI not found" and, worse, told the caller not to
        // retry (see runCLI) — so the stale session never got reset and the
        // bot stayed wedged. The phrases kept below come from a shell that
        // failed to resolve the command, so they can't be confused with that.
        const lower = msg.toLowerCase();
        const notFound =
          code === 127 ||
          lower.includes("no se reconoce") ||
          lower.includes("is not recognized") ||
          lower.includes("commandnotfoundexception");
        if (notFound) return reject(new Error("CLI_NOT_FOUND"));
        return reject(new Error(msg));
      }

      const { text, sessionId } = desc.parse(stdout);
      if (sessionId && sessionRef) sessionRef.id = sessionId;
      resolve(text);
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(new Error("CLI_NOT_FOUND"));
      } else {
        reject(err);
      }
    });
  });
}

// The `story` and `thoughts` prompt shapes that used to sit between `event`
// and `messages` here fed the Reddit story reader, a desktop-era feature that
// no longer exists — hence the shorter parameter list. `options.model` is the
// configured model id for providers that take one (opencode/claude/agy).
async function queryAI(messages, style = "auto", basePrompt = "", event = null, provider = "claude", twitchId = null, { model = null } = {}) {
  // Central validation for every prompt built here (/respond, /event):
  // basePrompt is bounded/stripped, chat lines are shape-checked + bounded.
  // (Framing of both sides still happens in wrapSystemPrompt/wrapUntrusted
  // via buildPrompt/buildEventPrompt below.)
  messages = hardening.sanitizeMessages(messages);
  basePrompt = hardening.sanitizeBasePrompt(basePrompt);
  if (typeof style !== "string" || !style) style = "auto";
  rememberBasePrompt(twitchId, basePrompt);
  const prompt = event
    ? buildEventPrompt(event, basePrompt)
    : buildPrompt(messages, style, basePrompt);

  return stripMarkdown(await runCLI(prompt, { provider, twitchId, model }));
}

module.exports = {
  TIMEOUT_MS,
  runCLI,
  spawnCLI,
  queryAI,
  logEmptyResponse,
};
