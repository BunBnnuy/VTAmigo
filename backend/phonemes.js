// Phoneme scheduler — converts text to a mouth-open timeline and drives VTube Studio.

const { injectParam } = require("./vtube");

// Mouth-open value (0–1) per lowercase letter
const CHAR_VALUE = {
  // Wide open
  a: 1.0,
  // Open
  o: 0.85,
  // Mid open — vowels and approximants
  e: 0.5, i: 0.5, u: 0.5, l: 0.5, r: 0.5, y: 0.5, w: 0.5,
  // Small open — fricatives, nasals, stops (non-labial)
  n: 0.25, d: 0.25, t: 0.25, s: 0.25, z: 0.25,
  f: 0.25, v: 0.25, h: 0.25, k: 0.25, g: 0.25,
  c: 0.25, j: 0.25, q: 0.25, x: 0.25,
  // Closed — labials
  m: 0.0, b: 0.0, p: 0.0,
};

let mouthParam = "MouthOpen";
let sensitivity = 0.8;
let activeTimeouts = [];

function setMouthParam(param) { mouthParam = param; }
function setSensitivity(s) { sensitivity = Math.max(0, Math.min(1, s)); }

// Build a flat array of [0–1] values, one per character slot
function textToValues(text) {
  const lower = text.toLowerCase();
  const out = [];
  for (const ch of lower) {
    if (/[^a-z]/.test(ch)) {
      out.push(0); // spaces, punctuation, digits → closed
    } else {
      out.push(CHAR_VALUE[ch] ?? 0.25);
    }
  }
  return out;
}

// Kick off phoneme injection timed to durationMs
function schedulePhonemes(text, durationMs) {
  cancelSchedule();
  if (!text || durationMs <= 0) return;

  const values = textToValues(text);
  if (values.length === 0) return;

  const msPerChar = durationMs / values.length;

  values.forEach((val, i) => {
    const t = setTimeout(() => {
      injectParam(mouthParam, val * sensitivity);
    }, Math.round(i * msPerChar));
    activeTimeouts.push(t);
  });

  // Smooth return to closed after speech ends
  activeTimeouts.push(setTimeout(() => {
    injectParam(mouthParam, 0);
  }, durationMs + 150));
}

function cancelSchedule() {
  for (const t of activeTimeouts) clearTimeout(t);
  activeTimeouts = [];
  // Reset mouth immediately
  injectParam(mouthParam, 0);
}

module.exports = { schedulePhonemes, cancelSchedule, setMouthParam, setSensitivity };
