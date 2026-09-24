// Hand-picked memory import/export for the provider CLIs that keep a
// persistent session. The provider list comes from the registry, so a new
// session-capable provider works here without changes.
const { runCLI } = require("./runner");
const registry = require("./registry");
const { hasStartedSession } = require("./sessions");

function requireSessionProvider(provider) {
  if (!registry.sessionIds().includes(provider)) {
    const names = registry.list().map((p) => p.label).join(", ");
    throw new Error(`Solo ${names} tienen sesión persistente`);
  }
}

// Loads a hand-picked .md memory file into a provider's live session — same
// prompt shape as the export worker's inject step, but for a file the user
// supplies themselves rather than a dump from another provider.
const IMPORT_PROMPT = (memory) => `Eres el co-presentador de IA de un stream. A continuación tienes una memoria guardada que quiero que integres como si fueran tus propios recuerdos: a partir de ahora conoces estos eventos, viewers, bromas internas y contexto, y los usarás con naturalidad en futuras respuestas.

Responde únicamente "OK" para confirmar que la has integrado.

--- MEMORIA ---

${memory}`;

async function importMemory(markdown, provider = "claude", twitchId = null, model = null) {
  if (!markdown || !markdown.trim()) throw new Error("MEMORY_EMPTY");
  requireSessionProvider(provider);
  return runCLI(IMPORT_PROMPT(markdown), { provider, twitchId, model, timeoutMs: 180000 });
}

// Same prompt shape as the export worker's dump step, but for downloading the
// bot's current memory as a file rather than handing it to another provider.
const DUMP_PROMPT = `Escribe en Markdown un volcado completo y detallado de todo lo que recuerdas de nuestras conversaciones: eventos del stream, viewers recurrentes y lo que sabes de cada uno, bromas internas, historias que contamos, preferencias y datos del streamer, decisiones tomadas y cualquier otro contexto relevante.

Responde ÚNICAMENTE con el Markdown de la memoria, sin introducción ni comentarios adicionales.`;

async function dumpMemory(provider = "claude", twitchId = null, model = null) {
  requireSessionProvider(provider);
  if (!twitchId || !hasStartedSession(provider, twitchId)) {
    throw new Error("NO_MEMORY_YET");
  }
  const result = await runCLI(DUMP_PROMPT, { provider, twitchId, model, timeoutMs: 180000 });
  if (!result || !result.trim()) throw new Error("MEMORY_EMPTY");
  return result;
}

module.exports = { importMemory, dumpMemory, IMPORT_PROMPT, DUMP_PROMPT };
