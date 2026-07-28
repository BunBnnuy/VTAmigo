// ElevenLabs TTS — proxies the API so the frontend avoids CORS and never
// ships the key in browser requests to a third party.

const API_BASE = "https://api.elevenlabs.io/v1";
const DEFAULT_MODEL = "eleven_multilingual_v2";

// Returns [{ voice_id, name, labels }]
async function listVoices(apiKey) {
  const res = await fetch(`${API_BASE}/voices`, {
    headers: { "xi-api-key": apiKey },
  });
  if (res.status === 401) throw new Error("ELEVENLABS_UNAUTHORIZED");
  if (!res.ok) throw new Error(`ElevenLabs voices request failed (${res.status})`);
  const data = await res.json();
  return (data.voices || []).map((v) => ({
    voice_id: v.voice_id,
    name: v.name,
    category: v.category || "",
  }));
}

// Returns a Buffer of MP3 audio
async function generateSpeech({ text, apiKey, voiceId, modelId }) {
  if (!text) throw new Error("TEXT_REQUIRED");
  if (!apiKey) throw new Error("APIKEY_REQUIRED");
  if (!voiceId) throw new Error("VOICE_REQUIRED");

  const res = await fetch(`${API_BASE}/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: modelId || DEFAULT_MODEL,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (res.status === 401) throw new Error("ELEVENLABS_UNAUTHORIZED");
  if (res.status === 422) throw new Error("ELEVENLABS_BAD_REQUEST");
  if (!res.ok) {
    let detail = "";
    try { detail = JSON.stringify(await res.json()); } catch {}
    throw new Error(`ElevenLabs TTS failed (${res.status})${detail ? ` ${detail}` : ""}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { listVoices, generateSpeech };
