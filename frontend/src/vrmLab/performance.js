// Turns a line of text into a small "performance": an intent (greeting,
// question, sad…) that drives facial expressions, head/body gestures and the
// odd arm wave, plus the procedural idle that plays all the time.
//
// This is deliberately rule-based, not an LLM call: a prototype should react
// in the same frame it starts speaking, and the rules are easy to audit. The
// backend already has a model that could return a richer label later — the
// stage only consumes `{ act }`, so swapping the classifier is one function.

export const ACT_LABELS = {
  neutral: "neutro",
  greeting: "saludo",
  thanks: "gracias",
  question: "pregunta",
  thinking: "pensando",
  happy: "alegre",
  surprised: "sorpresa",
  sad: "triste",
  angry: "enfado",
};

// Ordered rules; every match adds its weight and the highest total wins.
// Ties fall back to the earlier rule, so greetings/questions beat "neutral".
//
// \p{L} lookarounds instead of \b: JavaScript's \b is ASCII-only, so
// "quizá\b" never matches because "á" is not a word character.
const word = (...words) =>
  new RegExp(`(?<![\\p{L}])(?:${words.join("|")})(?![\\p{L}])`, "iu");
const prefix = (...stems) =>
  new RegExp(`(?<![\\p{L}])(?:${stems.join("|")})\\p{L}*`, "iu");

const RULES = [
  { act: "greeting", weight: 4, re: word("hola", "hey", "buenas", "saludos", "qué tal", "que tal", "bienvenido", "bienvenida") },
  { act: "thanks", weight: 4, re: word("gracias") },
  { act: "thanks", weight: 4, re: prefix("agrade") },
  { act: "question", weight: 2.5, re: /\?/ },
  { act: "question", weight: 1.5, re: word("qué", "que", "cómo", "como", "por qué", "porque", "quién", "quien", "cuándo", "cuando", "dónde", "donde", "cuál", "cual") },
  { act: "happy", weight: 3, re: word("jaja", "jeje", "genial", "increíble", "increible", "wow", "yay", "bravo", "fantástico", "fantastico", "encanta") },
  { act: "happy", weight: 2, re: /!{2,}/ },
  { act: "sad", weight: 3, re: word("triste", "siento", "perdón", "perdon", "pena") },
  { act: "angry", weight: 3, re: prefix("enfad", "molest", "odio", "basta", "furios", "irrit", "harto", "harta") },
  { act: "thinking", weight: 2.5, re: word("quizá", "quiza", "tal vez", "creo", "déjame", "dejame", "mmm", "pensar", "supongo") },
  { act: "surprised", weight: 2.5, re: word("sorpresa", "increíble", "increible", "serio", "no me lo puedo creer", "no puede ser", "no me lo esperaba") },
  { act: "surprised", weight: 1, re: /¡/ },
  { act: "thanks", weight: 1, re: word("favor", "porfa") },
];

export function classifyAct(text) {
  const clean = String(text || "");
  const scores = {};
  for (const rule of RULES) {
    if (!rule.re.test(clean)) continue;
    scores[rule.act] = (scores[rule.act] || 0) + rule.weight;
  }
  let act = "neutral";
  let best = 0;
  for (const [key, score] of Object.entries(scores)) {
    if (score > best) {
      best = score;
      act = key;
    }
  }
  return { act, score: best };
}

// Convenience for callers that only need the label.
export function actFor(text) {
  return classifyAct(text).act;
}

// ── Envelopes ───────────────────────────────────────────────────────────────

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => x * x * (3 - 2 * x);

// 0 → 1 over `attack`, hold, then back to 0 over `release` starting at `holdEnd`.
function envelope(t, attack, holdEnd, release) {
  const rise = smooth(clamp01(t / Math.max(0.001, attack)));
  if (t <= holdEnd) return rise;
  const fall = 1 - smooth(clamp01((t - holdEnd) / Math.max(0.001, release)));
  return rise * fall;
}

// ── Idle ────────────────────────────────────────────────────────────────────

// Slow, model-agnostic breathing/sway. Kept tiny on purpose: the point is that
// the avatar isn't a statue between lines, not that it "acts".
export function sampleIdle(t) {
  return {
    head: {
      pitch: Math.sin(t * 1.1) * 0.018 + Math.sin(t * 0.37) * 0.01,
      roll: Math.sin(t * 0.53) * 0.022,
      yaw: Math.sin(t * 0.31) * 0.03,
    },
    spine: {
      pitch: Math.sin(t * 0.8) * 0.008,
      roll: Math.sin(t * 0.47) * 0.01,
    },
  };
}

// ── Acts ────────────────────────────────────────────────────────────────────

// Returns deltas in radians for the head/spine, zero or one arm target, and an
// optional expression. Signs are handled by the caller (VRM 0.x is mirrored).
export function sampleAct(act, elapsed) {
  const t = Math.max(0, elapsed);
  const out = {
    head: { pitch: 0, roll: 0, yaw: 0 },
    spine: { pitch: 0, roll: 0 },
    arm: null,
    expression: null,
    weight: 0,
  };

  switch (act) {
    case "greeting": {
      const e = envelope(t, 0.35, 1.9, 0.5);
      out.arm = {
        side: "right",
        angle: 1.7 * e + Math.sin(t * 11) * 0.1 * e, // upper arm out, elbow bent
        bend: 1.6 * e,
      };
      out.expression = "happy";
      out.weight = 0.45 * e;
      out.head.roll = 0.05 * e;
      break;
    }
    case "thanks": {
      const e = envelope(t, 0.3, 1.1, 0.55);
      out.spine.pitch = 0.2 * e;
      out.head.pitch = 0.12 * e;
      out.expression = "happy";
      out.weight = 0.3 * e;
      break;
    }
    case "question": {
      const e = envelope(t, 0.3, 1.4, 0.6);
      out.head.roll = 0.17 * e;
      out.head.yaw = 0.06 * e;
      out.head.pitch = -0.02 * e;
      break;
    }
    case "thinking": {
      const e = envelope(t, 0.4, 2.2, 0.6);
      out.head.roll = -0.13 * e;
      out.head.yaw = 0.16 * e;
      out.head.pitch = -0.09 * e;
      break;
    }
    case "happy": {
      const e = envelope(t, 0.15, 1.6, 0.5);
      out.head.pitch = (0.1 + Math.sin(t * 10) * 0.1) * e;
      out.expression = "happy";
      out.weight = 0.5 * e;
      break;
    }
    case "surprised": {
      const e = envelope(t, 0.12, 0.7, 0.5);
      out.head.pitch = -0.18 * e;
      out.spine.pitch = -0.05 * e;
      out.expression = "surprised";
      out.weight = 0.55 * e;
      break;
    }
    case "sad": {
      const e = envelope(t, 0.5, 3, 0.8);
      out.head.pitch = 0.16 * e;
      out.spine.pitch = 0.07 * e;
      out.expression = "sad";
      out.weight = 0.4 * e;
      break;
    }
    case "angry": {
      const e = envelope(t, 0.25, 1.8, 0.6);
      out.head.pitch = 0.1 * e;
      out.head.roll = 0.04 * e;
      out.spine.pitch = 0.07 * e;
      out.expression = "angry";
      out.weight = 0.4 * e;
      break;
    }
    default:
      break;
  }
  return out;
}

export const EXPRESSION_NAMES = ["happy", "angry", "sad", "relaxed", "surprised"];
