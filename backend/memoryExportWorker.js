// Worker thread for memory export. Runs off the main thread so the backend
// keeps serving chat/TTS while the (slow) CLI calls happen here. The main
// thread holds both providers' session queues for the duration, so nothing
// else can touch the two sessions while we read/write them.
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { parentPort, workerData } = require("worker_threads");
// Same process-boundary hardening as the main-thread spawnCLI in
// ai/runner.js, and the same provider descriptors (registry.js is pure, so
// this worker can load it without opening its own SQLite connection). This
// worker spawns the same agent CLIs, so it must not spawn them any less
// locked down. See agentHardening.js.
const hardening = require("./agentHardening");
const registry = require("./ai/registry");

const { from, to, models, source, target, memoriesDir, timeoutMs } = workerData;

function progress(pct, stage) {
  parentPort.postMessage({ type: "progress", pct, stage });
}

function runCLI(provider, args) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const proc = spawn(registry.get(provider).exe(), args, {
      shell: false,
      windowsHide: true,
      // stdin closed (see ai/runner.js: `opencode run` hangs on an open
      // stdin pipe), isolated scratch cwd + minimal allowlist env, plus the
      // provider's own switches — never the backend repo dir, never the
      // backend's environment (see agentHardening.js).
      stdio: ["ignore", "pipe", "pipe"],
      cwd: hardening.resolveAgentCwd(null),
      env: { ...hardening.buildRestrictedEnv(process.env, provider), ...registry.envFor(provider) },
    });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
      reject(new Error("TIMEOUT"));
    }, timeoutMs);

    proc.stdout.on("data", (c) => (stdout += c.toString()));
    proc.stderr.on("data", (c) => (stderr += c.toString()));

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      if (code !== 0) return reject(new Error(stderr.trim() || `CLI exited with code ${code}`));

      const { text, sessionId } = registry.get(provider).parse(stdout);
      resolve({ text, conversationId: sessionId });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err.code === "ENOENT" ? new Error("CLI_NOT_FOUND") : err);
    });
  });
}

function buildArgs(provider, prompt, session, isTarget = false, model = null) {
  // Session flags keep their exact shapes (see the provider descriptors);
  // the per-provider hardening flags (tool/plugin/skill/MCP lockdown) are
  // appended after them.
  const desc = registry.get(provider);
  const sessionArgs = session && session.started
    ? desc.session.resumeArgs(session)
    : isTarget
    ? desc.session.startArgs(session)
    : [];
  return [...desc.buildArgs({ prompt, sessionArgs, model }), ...desc.hardeningArgs];
}

const DUMP_PROMPT = `Necesito exportar tu memoria a otro asistente que va a ocupar tu lugar como co-presentador del stream.

Escribe en Markdown un volcado completo y detallado de todo lo que recuerdas de nuestras conversaciones: eventos del stream, viewers recurrentes y lo que sabes de cada uno, bromas internas, historias que contamos, preferencias y datos del streamer, decisiones tomadas y cualquier otro contexto que le sirva a tu sucesor.

Responde ÚNICAMENTE con el Markdown de la memoria, sin introducción ni comentarios adicionales.`;

const injectPrompt = (memory) => `Eres el co-presentador de IA de un stream. A continuación tienes la memoria exportada de otro asistente que ocupaba este rol antes que tú. Intégrala como si fueran tus propios recuerdos: a partir de ahora conoces estos eventos, viewers, bromas internas y contexto, y los usarás con naturalidad en futuras respuestas.

Responde únicamente "OK" para confirmar que la has integrado.

--- MEMORIA EXPORTADA ---

${memory}`;

(async () => {
  try {
    progress(10, `Leyendo la memoria de ${from}…`);
    const sourceArgs = buildArgs(from, DUMP_PROMPT, source, false, models?.[from] || null);
    const sourceResult = await runCLI(from, sourceArgs);
    const memory = sourceResult.text;
    if (!memory) throw new Error(`${from} devolvió una memoria vacía`);

    progress(55, "Guardando memoria en archivo .md…");
    fs.mkdirSync(memoriesDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const mdPath = path.join(memoriesDir, `memoria-${from}-a-${to}-${stamp}.md`);
    const header = `<!-- Memoria exportada de ${from} a ${to} — ${new Date().toISOString()} -->\n\n`;
    fs.writeFileSync(mdPath, header + memory + "\n", "utf8");

    progress(65, `Importando la memoria en ${to}…`);
    const targetArgs = buildArgs(to, injectPrompt(memory), target, true, models?.[to] || null);
    const targetResult = await runCLI(to, targetArgs);

    progress(100, "Exportación completada");
    parentPort.postMessage({
      type: "done",
      mdPath,
      targetSessionId: targetResult.conversationId || null,
    });
  } catch (err) {
    parentPort.postMessage({ type: "error", message: err.message });
  }
})();
