// AI provider layer — replaces the old backend/claude.js, whose name no
// longer matched its job (it hosts every provider CLI, not just Claude).
//
//   registry.js   provider descriptors (claude / grok / agy / …)
//   prompt.js     persona wrapping + untrusted-data delimiting
//   sessions.js   per-provider, per-user persistent sessions + queues
//   runner.js     the single spawn/session/retry path
//   memory.js     session memory import/export
const { queryAI } = require("./runner");
const { importMemory, dumpMemory } = require("./memory");
const { withSessions, saveSessions, hasStartedSession } = require("./sessions");
const {
  wrapSystemPrompt,
  wrapUntrusted,
  buildPrompt,
  buildEventPrompt,
  containsPromptLeak,
} = require("./prompt");
const registry = require("./registry");

module.exports = {
  queryAI,
  importMemory,
  dumpMemory,
  withSessions,
  saveSessions,
  hasStartedSession,
  containsPromptLeak,
  wrapSystemPrompt,
  wrapUntrusted,
  buildPrompt,
  buildEventPrompt,
  providers: registry,
};
