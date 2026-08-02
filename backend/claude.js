const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");

const TIMEOUT_MS = 60000;

const DEFAULT_BASE_PROMPT = `Eres un co-presentador de IA para un stream de Twitch de gaming y just-chatting.

Responde en 1–3 oraciones. Sé ingenioso, no cringe. Aporta algo — no solo repitas lo que dijo el chat. Iguala la energía: tranquilo cuando ellos están tranquilos, hypeado cuando están hypeados.`;

function buildStoryPrompt(story, basePrompt) {
  const base = (basePrompt || DEFAULT_BASE_PROMPT).trim();
  return `${base}

Acabo de encontrar esta historia de Reddit en r/${story.subreddit} y quiero contársela al chat. Nárramela en voz alta como si estuvieras leyéndola en el stream: con dramatismo, comentarios propios, reacciones naturales. Puedes resumir si es muy larga. Máximo 5–6 oraciones.

Título: ${story.title}

Historia:
${story.text}

Narrala ahora.`;
}

function describeEvent(event) {
  switch (event.kind) {
    case "follow":
      return `¡${event.username} acaba de seguir el canal!`;
    case "sub":
      return `¡${event.username} acaba de suscribirse al canal${event.isGift ? " (regalo)" : ""}!`;
    case "resub":
      return `¡${event.username} renovó su suscripción por ${event.months} ${event.months === 1 ? "mes" : "meses"}!${event.message ? ` Mensaje: "${event.message}"` : ""}`;
    case "giftsub":
      return event.isAnonymous
        ? `¡Un anónimo regaló ${event.count} ${event.count === 1 ? "suscripción" : "suscripciones"}!`
        : `¡${event.username} regaló ${event.count} ${event.count === 1 ? "suscripción" : "suscripciones"}!`;
    case "raid":
      return `¡${event.username} está haciendo un raid con ${event.viewers} ${event.viewers === 1 ? "espectador" : "espectadores"}!`;
    case "cheer":
      return event.isAnonymous
        ? `¡Un anónimo donó ${event.bits} bits!${event.message ? ` Mensaje: "${event.message}"` : ""}`
        : `¡${event.username} donó ${event.bits} bits!${event.message ? ` Mensaje: "${event.message}"` : ""}`;
    default:
      return `Evento desconocido de ${event.username}.`;
  }
}

function buildEventPrompt(event, basePrompt) {
  const base = (basePrompt || DEFAULT_BASE_PROMPT).trim();
  const description = describeEvent(event);
  return `${base}

Acaba de ocurrir el siguiente evento en el stream:
${description}

Reacciona y agradece este evento en 1–2 oraciones. Sé entusiasta y auténtico. Responde ahora.`;
}

function buildPrompt(messages, style, basePrompt) {
  const base = (basePrompt || DEFAULT_BASE_PROMPT).trim();

  const styleInstruction =
    style === "chatbot"
      ? "Céntrate en dirigirte al chat directamente como un chatbot amigable."
      : style === "narrator"
      ? "Céntrate en comentar como un narrador hypeado y apasionado."
      : "Decide tu estilo según el contexto: si el chat hace preguntas o bromea → responde como un chatbot amigable; si el chat reacciona a algo del stream → comenta como un narrador hypeado; si es una mezcla → combina ambos de forma natural.";

  const chatLines = messages
    .map((m) => {
      if (m.isRedeem) {
        const reward = m.rewardTitle || "Canje de puntos de canal";
        const body = m.text || reward;
        return `[CANJE: "${reward}"] ${m.username}: ${body}`;
      }
      return `${m.username}: ${m.text}`;
    })
    .join("\n");

  const hasRedeems = messages.some((m) => m.isRedeem);
  const redeemNote = hasRedeems
    ? "\nNota: los mensajes marcados con [CANJE] son canjes de puntos de canal — dales un poco más de protagonismo al responder.\n"
    : "";

  return `${base}

${styleInstruction}
${redeemNote}
Mensajes recientes del chat:
${chatLines}

Responde ahora.`;
}

function buildThoughtsPrompt(thoughts, basePrompt) {
  const base = (basePrompt || DEFAULT_BASE_PROMPT).trim();
  const context = thoughts.title
    ? `Historia de r/${thoughts.subreddit}: "${thoughts.title}"`
    : `Historia de Reddit`;
  return `${base}

Acabo de terminar de leer en voz alta una historia de Reddit para el stream. Este fue el último párrafo:

"${thoughts.paragraph}"

(${context})

Comparte tu reacción o pensamiento en 1–3 oraciones. Sé auténtico, puede ser gracioso, sorprendido, reflexivo o lo que encaje. Responde ahora.`;
}

const GROK_EXE =
  process.env.GROK_PATH || "C:\\Users\\beton\\.grok\\bin\\grok.exe";

const CLAUDE_EXE =
  process.env.CLAUDE_PATH ||
  "C:\\Users\\beton\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe\\claude.exe";

const AGY_EXE =
  process.env.AGY_PATH ||
  (process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "agy", "bin", "agy.exe")
    : "C:\\Users\\beton\\AppData\\Local\\agy\\bin\\agy.exe");

// Shared CLI runner — spawns `claude -p` (or grok) and resolves with stdout
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

function runOpenAI(prompt, { timeoutMs = TIMEOUT_MS } = {}) {
  if (!process.env.OPENAI_API_KEY) return Promise.reject(new Error("OPENAI_API_KEY_MISSING"));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: OPENAI_MODEL, input: prompt }),
    signal: controller.signal,
  })
    .then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message || `OpenAI API request failed (${response.status})`);
      if (!body.output_text?.trim()) throw new Error("OpenAI API returned an empty response");
      return body.output_text.trim();
    })
    .catch((err) => {
      if (err.name === "AbortError") throw new Error("TIMEOUT");
      throw err;
    })
    .finally(() => clearTimeout(timer));
}

// Per-provider, per-user persistent sessions: the first query from a given
// Twitch account opens the session with --session-id, later queries from
// that same account --resume it, so each streamer's co-host remembers their
// own stream without mixing memories with anyone else on the site. IDs live
// in a JSON file next to the backend so memory survives restarts — delete
// the file (or a user's entry) to give that account's bot a clean slate.
const SESSIONS_FILE = path.join(__dirname, ".agent-sessions.json");

function loadSessions() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"));
  } catch {
    // Missing or unreadable file → start fresh
  }
  // Old file shape (pre per-user sessions) was a single { id, started } per
  // provider shared site-wide — there's no safe owner to migrate it to, so
  // it's discarded and each account starts a clean session instead.
  const restoreProvider = (p) => {
    const entry = saved[p];
    const out = {};
    if (entry && typeof entry === "object" && typeof entry.id !== "string") {
      for (const [twitchId, s] of Object.entries(entry)) {
        if (s && typeof s.id === "string") out[twitchId] = { id: s.id, started: !!s.started };
      }
    }
    return out;
  };
  return { claude: restoreProvider("claude"), grok: restoreProvider("grok"), agy: restoreProvider("agy") };
}

function saveSessions() {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
  } catch (err) {
    console.error("Failed to save agent sessions:", err.message);
  }
}

const sessions = loadSessions();

function getSession(provider, twitchId) {
  if (!sessions[provider][twitchId]) {
    sessions[provider][twitchId] = { id: randomUUID(), started: false };
  }
  return sessions[provider][twitchId];
}

// A session can't be resumed by two processes at once, so serialize calls
// per (provider, twitchId) pair with a promise chain.
const queues = { claude: new Map(), grok: new Map(), agy: new Map() };

function getQueue(provider, twitchId) {
  const m = queues[provider];
  if (!m.has(twitchId)) m.set(twitchId, Promise.resolve());
  return m.get(twitchId);
}

function setQueue(provider, twitchId, promise) {
  queues[provider].set(twitchId, promise);
}

function resetSession(provider, twitchId) {
  sessions[provider][twitchId] = { id: randomUUID(), started: false };
  saveSessions();
}

// Run fn with exclusive access to the given providers' sessions for one
// Twitch account: fn starts after that account's pending queries on those
// providers finish, and new queries wait until fn settles. Used by the
// memory exporter so it never races the co-host's own queries.
function withSessions(providers, twitchId, fn) {
  const run = Promise.all(providers.map((p) => getQueue(p, twitchId))).then(() => fn(sessions, twitchId));
  for (const p of providers) setQueue(p, twitchId, run.catch(() => {}));
  return run;
}

function runCLI(prompt, { provider = "claude", twitchId = null, model = null, cwd = null, timeoutMs = TIMEOUT_MS, session = true } = {}) {
  if (provider === "chatgpt") return runOpenAI(prompt, { timeoutMs });
  if (!session || !twitchId || !sessions[provider]) {
    return spawnCLI(prompt, { provider, model, cwd, timeoutMs });
  }

  const run = getQueue(provider, twitchId).then(async () => {
    const sess = getSession(provider, twitchId);
    let sessionArgs = [];
    if (provider === "agy") {
      if (sess.started && sess.id) {
        sessionArgs = ["--conversation", sess.id];
      }
    } else {
      sessionArgs = sess.started
        ? ["--resume", sess.id]
        : ["--session-id", sess.id];
    }
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
        const freshArgs = provider === "agy"
          ? (fresh.started && fresh.id ? ["--conversation", fresh.id] : [])
          : ["--session-id", fresh.id];
        const out = await spawnCLI(prompt, {
          provider, model, cwd, timeoutMs,
          sessionArgs: freshArgs,
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
  return run;
}

function spawnCLI(prompt, { provider = "claude", model = null, cwd = null, timeoutMs = TIMEOUT_MS, sessionArgs = [], sessionRef = null } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const exe = provider === "grok" ? GROK_EXE : provider === "agy" ? AGY_EXE : CLAUDE_EXE;
    const args = ["-p", prompt, ...sessionArgs];
    if (provider === "agy") {
      args.push("--output-format", "json");
    }
    if (model && (provider === "claude" || provider === "agy")) args.push("--model", model);

    const proc = spawn(exe, args, {
      shell: false,
      windowsHide: true,
      ...(cwd ? { cwd } : {}),
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
        const notFound =
          code === 127 ||
          msg.toLowerCase().includes("not found") ||
          msg.toLowerCase().includes("no se reconoce") ||
          msg.toLowerCase().includes("is not recognized") ||
          msg.toLowerCase().includes("commandnotfoundexception");
        if (notFound) return reject(new Error("CLI_NOT_FOUND"));
        return reject(new Error(msg));
      }

      if (provider === "agy") {
        try {
          const parsed = JSON.parse(stdout.trim());
          if (parsed.conversation_id && sessionRef) {
            sessionRef.id = parsed.conversation_id;
          }
          if (parsed.response != null) {
            return resolve(parsed.response.trim());
          }
        } catch {
          // If JSON parse failed, fall back to plain stdout
        }
      }

      resolve(stdout.trim());
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

async function queryClaudeCLI(messages, style = "auto", basePrompt = "", event = null, story = null, thoughts = null, provider = "claude", twitchId = null) {
  const prompt = event
    ? buildEventPrompt(event, basePrompt)
    : story
    ? buildStoryPrompt(story, basePrompt)
    : thoughts
    ? buildThoughtsPrompt(thoughts, basePrompt)
    : buildPrompt(messages, style, basePrompt);

  return runCLI(prompt, { provider, twitchId });
}

// Use Windows UI Automation to enumerate ALL Chrome windows (including background ones)
// and find the one with YouTube as the active tab.
function getYouTubeTitleFromAllWindows() {
  return new Promise((resolve) => {
    const script = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Chrome_WidgetWin_1'
)
$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
$found = $windows | ForEach-Object {
  $_.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::NameProperty)
} | Where-Object { $_ -like '*YouTube*' } | Select-Object -First 1
if ($found) { $found } else { '' }
`.trim();

    const ps = spawn(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { shell: false, windowsHide: true }
    );
    let out = "";
    ps.stdout.on("data", (c) => { out += c.toString(); });
    ps.on("close", () => resolve(out.trim()));
    ps.on("error", () => resolve(""));
  });
}

async function queryYouTubeNarration(basePrompt, provider = "claude", twitchId = null) {
  const rawTitle = await getYouTubeTitleFromAllWindows();
  // Strip " - YouTube - Google Chrome" → keep just the video title
  const videoTitle = rawTitle
    .replace(/ - YouTube.*$/i, "")
    .replace(/ - Google Chrome\s*$/i, "")
    .trim();

  if (!videoTitle) {
    throw new Error("No se encontró ninguna pestaña de YouTube abierta en Chrome.");
  }

  const base = (basePrompt || DEFAULT_BASE_PROMPT).trim();
  const prompt = `${base}

El streamer está viendo en YouTube: "${videoTitle}".

Comenta brevemente en 1–3 oraciones como co-presentador del stream: de qué trata, por qué puede ser interesante, o una reacción natural. Sé espontáneo, como si lo comentaras en directo.`;

  return runCLI(prompt, { provider, twitchId });
}

// ── Screen question detection (screenwatch) ───────────────────────────────────

// Vision pass: ask Haiku (cheap + fast) to extract a question + options from
// the screenshot. The CLI reads the image itself; cwd is set to the image dir
// so the read is auto-allowed in headless mode.
async function extractScreenQuestion(imagePath) {
  const prompt = `Lee la imagen "${path.basename(imagePath)}" que está en el directorio actual.

Determina si en la pantalla hay una pregunta tipo trivia/quiz/encuesta con opciones de respuesta visibles (por ejemplo un juego de preguntas, un quiz o una encuesta).

Responde ÚNICAMENTE con JSON válido, sin texto adicional ni markdown:
{"hasQuestion": true, "question": "texto exacto de la pregunta", "options": ["opción 1", "opción 2"]}

En "options" pon solo el texto de cada opción, sin letras ni números de enumeración (nada de "A)", "1.", etc.).

Si no hay ninguna pregunta con opciones claras (chat, menús, gameplay normal, código, etc. NO cuentan), responde:
{"hasQuestion": false, "question": "", "options": []}`;

  // Sessionless on purpose: this is a utility vision pass on a different
  // model — it shouldn't enter (or wait on) the co-host's conversation.
  const raw = await runCLI(prompt, { model: "haiku", cwd: path.dirname(imagePath), session: false });
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Vision extraction returned no JSON: ${raw.slice(0, 200)}`);
  const parsed = JSON.parse(match[0]);
  return {
    hasQuestion: !!parsed.hasQuestion,
    question: String(parsed.question || "").trim(),
    options: Array.isArray(parsed.options)
      ? parsed.options
          .map((o) => String(o).trim().replace(/^([a-j]|\d{1,2})[\).:\-]\s+/i, ""))
          .filter(Boolean)
      : [],
  };
}

// Fuzzy-match chat messages to options: letter ("a"), number ("2"), or option text
function tallyVotes(options, messages) {
  const letters = "abcdefghij";
  const counts = options.map(() => 0);
  for (const m of messages) {
    const text = (m.text || "").toLowerCase().trim();
    if (!text) continue;
    const short = text.replace(/[^a-z0-9áéíóúñü]/gi, "");
    for (let i = 0; i < options.length; i++) {
      const opt = options[i].toLowerCase().trim();
      const optShort = opt.replace(/[^a-z0-9áéíóúñü]/gi, "");
      if (
        short === letters[i] ||
        short === String(i + 1) ||
        (opt.length >= 4 && text.includes(opt)) ||
        (short.length >= 4 && optShort.includes(short))
      ) {
        counts[i]++;
        break;
      }
    }
  }
  return counts;
}

async function queryScreenAnswer({ question, options, messages, basePrompt, provider = "claude", twitchId = null, windowSec = 20 }) {
  const base = (basePrompt || DEFAULT_BASE_PROMPT).trim();
  const letters = "ABCDEFGHIJ";

  const optionLines = options.map((o, i) => `${letters[i]}) ${o}`).join("\n");

  const counts = tallyVotes(options, messages);
  const totalVotes = counts.reduce((a, b) => a + b, 0);
  const voteLines = totalVotes > 0
    ? "Votos del chat:\n" + counts
        .map((c, i) => (c > 0 ? `${letters[i]}) ${options[i]} — ${c} ${c === 1 ? "voto" : "votos"}` : null))
        .filter(Boolean)
        .join("\n")
    : "";

  const chatLines = messages.length > 0
    ? messages.slice(-30).map((m) => `${m.username}: ${m.text}`).join("\n")
    : "(el chat no dijo nada)";

  const prompt = `${base}

En el stream apareció esta pregunta en pantalla (quiz/trivia):

Pregunta: ${question}
Opciones:
${optionLines}

Esperé ${windowSec} segundos para que el chat opinara. Esto dijeron:
${chatLines}
${voteLines ? `\n${voteLines}\n` : ""}
Da tu respuesta final como co-presentador: di qué opción eliges y por qué, en 1–3 oraciones. Ten en cuenta lo que dijo el chat, pero usa tu propio conocimiento — si crees que el chat se equivoca, dilo con gracia. Empieza tu respuesta EXACTAMENTE con la letra de la opción elegida entre corchetes, por ejemplo "[B] " y después tu comentario. Responde ahora.`;

  const raw = await runCLI(prompt, { provider, twitchId });

  // Pull the leading "[B]" marker out of the spoken text
  let choiceIndex = null;
  let response = raw;
  const marker = raw.match(/^\s*\[([A-J])\]\s*/i);
  if (marker) {
    const idx = letters.indexOf(marker[1].toUpperCase());
    if (idx >= 0 && idx < options.length) choiceIndex = idx;
    response = raw.slice(marker[0].length).trim() || raw;
  }

  const topVoteIndex = totalVotes > 0 ? counts.indexOf(Math.max(...counts)) : null;

  return { response, choiceIndex, topVoteIndex };
}

// Loads a hand-picked .md memory file into a provider's live session — same
// prompt shape as the export worker's inject step, but for a file the user
// supplies themselves rather than a dump from another provider.
const IMPORT_PROMPT = (memory) => `Eres el co-presentador de IA de un stream. A continuación tienes una memoria guardada que quiero que integres como si fueran tus propios recuerdos: a partir de ahora conoces estos eventos, viewers, bromas internas y contexto, y los usarás con naturalidad en futuras respuestas.

Responde únicamente "OK" para confirmar que la has integrado.

--- MEMORIA ---

${memory}`;

async function importMemory(markdown, provider = "claude", twitchId = null) {
  if (!markdown || !markdown.trim()) throw new Error("MEMORY_EMPTY");
  if (!["claude", "grok", "agy"].includes(provider)) {
    throw new Error("Solo Claude, Grok y AGY tienen sesión persistente");
  }
  return runCLI(IMPORT_PROMPT(markdown), { provider, twitchId, timeoutMs: 180000 });
}

// Same prompt shape as the export worker's dump step, but for downloading the
// bot's current memory as a file rather than handing it to another provider.
const DUMP_PROMPT = `Escribe en Markdown un volcado completo y detallado de todo lo que recuerdas de nuestras conversaciones: eventos del stream, viewers recurrentes y lo que sabes de cada uno, bromas internas, historias que contamos, preferencias y datos del streamer, decisiones tomadas y cualquier otro contexto relevante.

Responde ÚNICAMENTE con el Markdown de la memoria, sin introducción ni comentarios adicionales.`;

async function dumpMemory(provider = "claude", twitchId = null) {
  if (!["claude", "grok", "agy"].includes(provider)) {
    throw new Error("Solo Claude, Grok y AGY tienen sesión persistente");
  }
  if (!twitchId || !sessions[provider][twitchId] || !sessions[provider][twitchId].started) {
    throw new Error("NO_MEMORY_YET");
  }
  const result = await runCLI(DUMP_PROMPT, { provider, twitchId, timeoutMs: 180000 });
  if (!result || !result.trim()) throw new Error("MEMORY_EMPTY");
  return result;
}

module.exports = {
  queryClaudeCLI,
  queryYouTubeNarration,
  extractScreenQuestion,
  queryScreenAnswer,
  importMemory,
  dumpMemory,
  withSessions,
  saveSessions,
  CLI_PATHS: { claude: CLAUDE_EXE, grok: GROK_EXE, agy: AGY_EXE },
};
