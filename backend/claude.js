const { spawn } = require("child_process");

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

async function queryClaudeCLI(messages, style = "auto", basePrompt = "", event = null, story = null, thoughts = null, provider = "claude") {
  const prompt = event
    ? buildEventPrompt(event, basePrompt)
    : story
    ? buildStoryPrompt(story, basePrompt)
    : thoughts
    ? buildThoughtsPrompt(thoughts, basePrompt)
    : buildPrompt(messages, style, basePrompt);

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const exe = provider === "grok" ? GROK_EXE : CLAUDE_EXE;

    const proc = spawn(exe, ["-p", prompt], {
      shell: false,
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
      reject(new Error("TIMEOUT"));
    }, TIMEOUT_MS);

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

module.exports = { queryClaudeCLI };
