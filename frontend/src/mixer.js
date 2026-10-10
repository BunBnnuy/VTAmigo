// Client-side shape of the account audio mixer (see backend/mixer.js). The
// values are stored in the Settings blob under `mixer`, applied by the app to
// the audio it plays itself, and POSTed to /mixer so the backend can broadcast
// them to this account's OBS overlays.

export const DEFAULT_MIXER = {
  master: 1,
  botVoice: 1,
  chatTts: 1,
  chatAlerts: 1,
  videoQueue: 1,
  shoutout: 1,
  overlaySound: 1,
};

export const MIXER_CHANNELS = Object.keys(DEFAULT_MIXER);

function clamp01(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

// Always a full, clamped channel set, so a partial/legacy stored blob can
// never leave a channel undefined.
export function sanitizeMixer(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const key of MIXER_CHANNELS) out[key] = clamp01(source[key], DEFAULT_MIXER[key]);
  return out;
}

// Effective gain for a source: its own channel times the master.
export function channelGain(mixer, channel) {
  const m = sanitizeMixer(mixer);
  return m[channel] * m.master;
}
