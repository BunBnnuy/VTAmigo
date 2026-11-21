// Visemes for the local Piper voices — text in, a VRM lip-sync timeline out.
//
// Pipeline:
//   text ──piper_phonemize (espeak-ng, the exact G2P the voice model consumes)
//        ──▶ phoneme tokens ──class weights──▶ [{ viseme, t, d }]
//
// The VITS models Piper exports don't expose per-phoneme durations, so the
// timeline uses language-tuned weights per phoneme class, uniformly scaled
// onto the speech span measured from the generated WAV (first/last 10 ms
// window above a noise floor). The frontend cross-fades between segments, so
// the estimate never shows up as a hard cut — only as slightly averaged
// timing, which is what most text-driven lip-sync does anyway.
//
// Viseme vocabulary (VRM expression preset names):
//   aa aa, ee e, ih i, oh o, ou u
//   "close" is not a VRM preset — the frontend multiplies the other five by
//   (1 - close) so bilabials (m/b/p) actually shut the mouth.

const { spawn } = require("child_process");
const path = require("path");
const piper = require("./piper");
const fish = require("./fish");
const kitten = require("./kitten");
const kokoro = require("./kokoro");

const BIN_DIR = path.dirname(piper.PIPER_EXE);
const PHONEMIZE_EXE = process.env.PIPER_PHONEMIZE_EXE || path.join(BIN_DIR, "piper_phonemize");
const ESPEAK_DATA = process.env.PIPER_ESPEAK_DATA || path.join(BIN_DIR, "espeak-ng-data");
const LANGUAGE = process.env.PIPER_LANGUAGE || "es";
const PHONEMIZE_TIMEOUT_MS = 8000;

// ── Phonemization ────────────────────────────────────────────────────────────

// Returns the flat espeak-ng phoneme token list for `text`. One token per
// array entry: IPA symbols ("a", "θ", "ʝ"), stress marks ("ˈ"), punctuation
// and single spaces between words — exactly what the voice model sees.
function phonemize(text) {
  return new Promise((resolve, reject) => {
    const args = ["-l", LANGUAGE, "--espeak_data", ESPEAK_DATA, "--json_input"];
    const proc = spawn(PHONEMIZE_EXE, args, { cwd: piper.PIPER_DIR });
    let out = "";
    let err = "";
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      proc.kill();
      finish(reject, new Error("PHONEMIZE_TIMEOUT"));
    }, PHONEMIZE_TIMEOUT_MS);

    proc.on("error", (e) => finish(reject, e));
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => {
      err = (err + d).slice(-2000);
    });
    proc.on("close", (code) => {
      if (code !== 0) return finish(reject, new Error(`PHONEMIZE_EXIT_${code}: ${err.slice(-300)}`));
      const phonemes = [];
      for (const line of out.split("\n")) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line);
          if (Array.isArray(row.phonemes)) phonemes.push(...row.phonemes);
        } catch {
          // A malformed line means one sentence lost its timeline, not the
          // whole request — keep the rest.
        }
      }
      if (!phonemes.length) return finish(reject, new Error("PHONEMIZE_EMPTY"));
      finish(resolve, phonemes);
    });
    // If the process dies before reading stdin, the write raises EPIPE; the
    // close handler above already reports the real failure.
    proc.stdin.on("error", () => {});
    proc.stdin.write(JSON.stringify({ text }) + "\n");
    proc.stdin.end();
  });
}

// ── Phoneme classes ─────────────────────────────────────────────────────────

const VOWEL_VISEME = { a: "aa", e: "ee", i: "ih", o: "oh", u: "ou", ɪ: "ih", ʊ: "ou" };

// Base durations (seconds at rate 1.0). Spanish runs ~150-200 ms per syllable,
// and these weights add up to roughly that before the WAV rescaling.
const VOWEL_SEC = 0.105;
const STRESS_FACTOR = 1.25;
const BILABIAL_SEC = 0.055;
const STOP_SEC = 0.05;
const FRICATIVE_SEC = 0.075;
const AFFRICATE_SEC = 0.085;
const NASAL_SEC = 0.062;
const LIQUID_SEC = 0.05;
const GLIDE_SEC = 0.048;
const WORD_GAP_SEC = 0.04;
const UNKNOWN_SEC = 0.03;

const BILABIALS = new Set(["p", "b", "m"]);
const STOPS = new Set(["t", "d", "k", "g", "ɡ", "c", "ɟ", "q"]);
const AFFRICATES = new Set(["tʃ", "dʒ"]);
const FRICATIVES = new Set(["f", "θ", "ð", "s", "z", "ʃ", "ʒ", "x", "ɣ", "β", "ʝ", "h", "ç"]);
const NASALS = new Set(["n", "ɲ", "ŋ", "ɱ"]);
const LIQUIDS = new Set(["l", "ɾ", "r", "ʎ", "ɫ", "ɹ"]);
const GLIDES = new Set(["j", "w"]);

// espeak-ng emits sentence punctuation as its own token; these are the ones
// Spanish text produces in practice.
const PAUSE_SEC = {
  ",": 0.16,
  ";": 0.18,
  ":": 0.2,
  ".": 0.3,
  "?": 0.3,
  "!": 0.3,
  "…": 0.34,
  "¿": 0,
  "¡": 0,
  "-": 0.1,
  "—": 0.1,
};

// Diacritics that arrive as standalone tokens in some voices and should not
// consume time. Stress marks are handled separately (they lengthen the vowel
// that follows), so they must not be listed here.
const IGNORED = new Set(["ː", "̃", "̩", "̯", "‿"]);

function isVowel(token) {
  return Object.prototype.hasOwnProperty.call(VOWEL_VISEME, token);
}

function isPause(token) {
  return Object.prototype.hasOwnProperty.call(PAUSE_SEC, token);
}

// Duration + viseme class for a token that is neither a vowel nor a pause.
function consonantClass(token) {
  if (BILABIALS.has(token)) return { dur: BILABIAL_SEC, amp: 1, close: true };
  if (AFFRICATES.has(token)) return { dur: AFFRICATE_SEC, amp: 0.5 };
  if (FRICATIVES.has(token)) return { dur: FRICATIVE_SEC, amp: 0.35 };
  if (STOPS.has(token)) return { dur: STOP_SEC, amp: 0.4 };
  if (NASALS.has(token)) return { dur: NASAL_SEC, amp: 0.4 };
  if (LIQUIDS.has(token)) return { dur: LIQUID_SEC, amp: 0.4 };
  if (GLIDES.has(token)) return { dur: GLIDE_SEC, amp: 0.55 };
  return { dur: UNKNOWN_SEC, amp: 0.3 };
}

// ── Timeline ────────────────────────────────────────────────────────────────

// Next vowel before the current word ends (or the previous one when the word
// has none) — consonants borrow their neighbour's mouth shape, which is what
// makes the 5-viseme approximation look like speech instead of flapping.
function neighbourVowel(phonemes, index) {
  for (let i = index + 1; i < phonemes.length; i++) {
    const p = phonemes[i];
    if (isVowel(p)) return p;
    if (p === " " || isPause(p)) break;
  }
  for (let i = index - 1; i >= 0; i--) {
    const p = phonemes[i];
    if (isVowel(p)) return p;
    if (p === " " || isPause(p)) break;
  }
  return null;
}

// [{ v, t, d }] with absolute seconds. `start`/`end` are the measured speech
// bounds inside the WAV; everything is rescaled to fill exactly that span.
function buildTimeline(phonemes, start, end) {
  const entries = [];
  let stressed = false;

  for (let i = 0; i < phonemes.length; i++) {
    const p = phonemes[i];
    if (IGNORED.has(p)) continue;
    if (p === "ˈ" || p === "ˌ") {
      stressed = p === "ˈ";
      continue;
    }
    if (p === " " || p === "\n") {
      entries.push({ v: null, dur: WORD_GAP_SEC });
      stressed = false;
      continue;
    }
    if (isPause(p)) {
      entries.push({ v: null, dur: PAUSE_SEC[p] });
      stressed = false;
      continue;
    }
    if (isVowel(p)) {
      entries.push({
        v: VOWEL_VISEME[p],
        amp: 1,
        dur: VOWEL_SEC * (stressed ? STRESS_FACTOR : 1),
      });
      stressed = false;
      continue;
    }
    const cls = consonantClass(p);
    if (cls.close) {
      entries.push({ v: "close", amp: 1, dur: cls.dur });
      continue;
    }
    const hint = neighbourVowel(phonemes, i);
    entries.push({
      v: hint ? VOWEL_VISEME[hint] : "aa",
      amp: cls.amp,
      dur: cls.dur,
    });
  }

  const total = entries.reduce((sum, e) => sum + e.dur, 0);
  const span = Math.max(0.001, end - start);
  const scale = total > 0 ? span / total : 0;

  const out = [];
  let cursor = start;
  for (const e of entries) {
    const d = e.dur * scale;
    if (e.v) out.push({ v: e.v, t: round(cursor), d: round(d), amp: e.amp });
    cursor += d;
  }
  return out;
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

// ── WAV measurement ─────────────────────────────────────────────────────────

// Reads the RIFF header and locates the first/last 10 ms window whose RMS
// clears a noise floor. Piper prefixes a short silence and appends
// `--sentence_silence`; pinning the timeline to the measured span keeps the
// first viseme from firing before the voice is audible.
function wavSpeechBounds(buffer) {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error("WAV_INVALID");
  }

  let pos = 12;
  let fmt = null;
  let data = null;
  while (pos + 8 <= buffer.length) {
    const id = buffer.toString("ascii", pos, pos + 4);
    const size = buffer.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === "fmt ") {
      fmt = {
        format: buffer.readUInt16LE(body), // 1 = PCM, 3 = IEEE float
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bits: buffer.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      data = { start: body, size: Math.min(size, buffer.length - body) };
    }
    pos = body + size + (size & 1);
    if (fmt && data) break;
  }
  if (!fmt || !data) throw new Error("WAV_INVALID");

  const bytesPerSample = fmt.bits / 8;
  const frameSize = bytesPerSample * fmt.channels;
  const frames = Math.floor(data.size / frameSize);
  const duration = frames / fmt.sampleRate;

  // Piper emits 16-bit PCM; Fish can return 16/24/32-bit or float WAV. Reading
  // the first channel covers mono and interleaved stereo, so the measured
  // speech span is provider-independent.
  const readSample = (frame) => {
    const offset = data.start + frame * frameSize;
    if (fmt.format === 3 && fmt.bits === 32) return buffer.readFloatLE(offset);
    switch (fmt.bits) {
      case 8:
        return (buffer.readUInt8(offset) - 128) / 128;
      case 16:
        return buffer.readInt16LE(offset) / 32768;
      case 24:
        return buffer.readIntLE(offset, 3) / 8388608;
      case 32:
        return buffer.readInt32LE(offset) / 2147483648;
      default:
        return null;
    }
  };
  if (readSample(0) === null) return { duration, start: 0, end: duration };

  const windowSize = Math.max(1, Math.round(fmt.sampleRate * 0.01));
  const threshold = 0.008;
  let first = -1;
  let last = -1;

  for (let w = 0; w * windowSize < frames; w++) {
    const from = w * windowSize;
    const to = Math.min(frames, from + windowSize);
    let sum = 0;
    for (let f = from; f < to; f++) {
      const sample = readSample(f);
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / Math.max(1, to - from));
    if (rms >= threshold) {
      if (first < 0) first = w;
      last = w;
    }
  }

  if (first < 0) return { duration, start: 0, end: duration };
  return {
    duration,
    start: Math.max(0, (first * windowSize) / fmt.sampleRate - 0.02),
    end: Math.min(duration, ((last + 1) * windowSize) / fmt.sampleRate + 0.05),
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

// Same text + voice always produces the same timeline, so the lab's repeated
// playbacks don't burn a Piper slot each time. Small on purpose: this is a
// prototype cache, not a TTS result store.
const CACHE_LIMIT = 16;
const cache = new Map();

function cacheGet(key) {
  if (!cache.has(key)) return null;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value); // LRU bump
  return value;
}

function cacheSet(key, value) {
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

// Every engine returns a WAV; the viseme timeline only depends on the text
// and the measured speech span, so adding an engine is one line here.
const ENGINES = ["piper", "fish", "kitten", "kokoro"];

function generateAudio(engine, { text, voice, speed }) {
  if (engine === "fish") return fish.generateSpeech({ text, voice, speed });
  if (engine === "kitten") return kitten.generateSpeech({ text, voice, speed });
  if (engine === "kokoro") return kokoro.generateSpeech({ text, voice, speed });
  return piper.generateSpeech({ text, voice });
}

// { audio: base64, mime, duration, visemes, phonemes, provider, source }
async function speechWithVisemes({ text, voice, provider = "piper", speed }) {
  const engine = ENGINES.includes(provider) ? provider : "piper";
  const key = `${engine}|${voice || ""}|${speed || ""}|${text}`;
  const cached = cacheGet(key);
  if (cached) return { ...cached, source: "cache" };

  // The phonemes come from the text, not the audio, so the same espeak-ng G2P
  // works for any engine; only the speech span is measured from the returned
  // WAV, which is what keeps the timeline glued to the actual voice.
  const [wav, phonemes] = await Promise.all([
    generateAudio(engine, { text, voice, speed }),
    // A missing/broken phonemizer must not take the audio down with it — the
    // lab still plays the voice, just without mouth movement.
    phonemize(text).catch(() => null),
  ]);

  const bounds = wavSpeechBounds(wav);
  const visemes = phonemes ? buildTimeline(phonemes, bounds.start, bounds.end) : [];

  const result = {
    audio: wav.toString("base64"),
    mime: "audio/wav",
    duration: round(bounds.duration),
    visemes,
    phonemes: phonemes || [],
    language: LANGUAGE,
    provider: engine,
  };
  if (!phonemes) result.warning = "PHONEMIZER_UNAVAILABLE";
  else cacheSet(key, result);
  return { ...result, source: engine };
}

module.exports = {
  phonemize,
  buildTimeline,
  wavSpeechBounds,
  speechWithVisemes,
  PHONEMIZE_EXE,
  ESPEAK_DATA,
};
