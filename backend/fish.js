// Fish Audio TTS — hosted API, no local model.
//
// The free developer tier is the `s2.1-pro-free` model header (billed at $0 per
// UTF-8 byte on Fish's public price list); s1/s2-pro/s2.1-pro/drama-3 are paid.
// Voices are `reference_id`s from the Fish library or the account's own clones,
// so the "voice" here is an opaque model id, not a local file.
//
// Everything is behind FISH_AUDIO_API_KEY: with no key the provider reports
// itself as unconfigured and the app keeps working with the local engines.
//
// FISH_API_BASE exists so the test suite (and a future proxy) can point the
// client at a mock server without touching api.fish.audio.

const API_BASE = (process.env.FISH_API_BASE || "https://api.fish.audio").replace(/\/+$/, "");
const API_KEY = process.env.FISH_AUDIO_API_KEY || process.env.FISH_API_KEY || "";
const MODEL = process.env.FISH_TTS_MODEL || "s2.1-pro-free";
const DEFAULT_VOICE = process.env.FISH_DEFAULT_VOICE || "";
const MAX_TEXT_CHARS = Number(process.env.FISH_MAX_TEXT_CHARS) || 1000;
const TIMEOUT_MS = Number(process.env.FISH_TIMEOUT_MS) || 30000;
const SAMPLE_RATE = Number(process.env.FISH_SAMPLE_RATE) || 24000;
const VOICES_TTL_MS = 5 * 60 * 1000;

function isConfigured() {
  return Boolean(API_KEY);
}

function status() {
  return {
    configured: isConfigured(),
    model: MODEL,
    freeTier: /-free$/.test(MODEL),
    defaultVoice: DEFAULT_VOICE,
    maxTextChars: MAX_TEXT_CHARS,
  };
}

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${API_KEY}`, ...extra };
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${API_BASE}${path}`, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") throw new Error("FISH_TIMEOUT");
    throw new Error(`FISH_NETWORK: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

async function errorFrom(res) {
  const detail = await res.json().catch(() => null);
  const message = detail?.message || detail?.detail || res.statusText || "request failed";
  return new Error(`FISH_HTTP_${res.status}: ${message}`);
}

// Returns a WAV Buffer (16-bit mono PCM from Fish's `format: "wav"`).
async function generateSpeech({ text, voice, speed } = {}) {
  if (!isConfigured()) throw new Error("FISH_NOT_CONFIGURED");
  if (!text || !String(text).trim()) throw new Error("FISH_TEXT_REQUIRED");
  if (String(text).length > MAX_TEXT_CHARS) throw new Error("FISH_TEXT_TOO_LONG");

  const body = {
    text: String(text),
    format: "wav",
    sample_rate: SAMPLE_RATE,
    // Chunking only affects very long text; keep the defaults explicit so a
    // future API change does not silently split sentences differently.
    chunk_length: 200,
    min_chunk_length: 50,
    normalize: true,
    latency: "normal",
    prosody: {
      speed: clamp(Number(speed) || 1, 0.5, 2),
      normalize_loudness: true,
    },
  };
  const referenceId = voice || DEFAULT_VOICE;
  if (referenceId) body.reference_id = referenceId;

  const res = await request("/v1/tts", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json", model: MODEL }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await errorFrom(res);

  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error("FISH_EMPTY_AUDIO");
  // A WAV response always starts with RIFF. Anything else means the API
  // answered 200 with an error payload or an unexpected format.
  if (buffer.toString("ascii", 0, 4) !== "RIFF") throw new Error("FISH_BAD_AUDIO");
  return buffer;
}

// Account-owned clones first, then popular licensed Spanish voices from the
// public library, so the picker is useful even before the streamer clones
// anything. `licensed=true` keeps the list to voices Fish has rights for.
// Cached for 5 minutes: Settings asks on mount and on every manual refresh,
// and this endpoint is rate-limited by concurrency like the rest of the API.
let voicesCache = { at: 0, voices: [] };

async function listVoices({ force = false } = {}) {
  if (!isConfigured()) return [];
  if (!force && Date.now() - voicesCache.at < VOICES_TTL_MS) return voicesCache.voices;

  const [ownRes, libraryRes] = await Promise.all([
    request("/model?self=true&page_size=100&sort_by=created_at", { headers: authHeaders() }),
    request("/model?page_size=40&language=es&licensed=true&sort_by=task_count", { headers: authHeaders() }),
  ]);
  if (!ownRes.ok && !libraryRes.ok) throw await errorFrom(ownRes);

  const [own, library] = await Promise.all([
    ownRes.ok ? ownRes.json().catch(() => ({})) : {},
    libraryRes.ok ? libraryRes.json().catch(() => ({})) : {},
  ]);
  const toVoice = (m, source) => ({
    id: m._id,
    name: m.title || m._id,
    languages: m.languages || [],
    state: m.state,
    source,
  });

  const seen = new Set();
  const voices = [];
  for (const [items, source] of [
    [own.items || [], "account"],
    [library.items || [], "library"],
  ]) {
    for (const model of items) {
      if (!model?._id || seen.has(model._id)) continue;
      seen.add(model._id);
      voices.push(toVoice(model, source));
    }
  }

  voicesCache = { at: Date.now(), voices };
  return voices;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

module.exports = {
  isConfigured,
  status,
  generateSpeech,
  listVoices,
  MAX_TEXT_CHARS,
  MODEL,
  API_BASE,
};
