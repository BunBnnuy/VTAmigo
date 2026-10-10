// Account audio mixer — one 0..1 gain per sound source plus a master gain,
// applied two ways:
//
//   • by the frontend to the audio it plays itself (bot TTS, chat-command TTS);
//   • broadcast over the /chat WS to every one of the account's OBS overlay
//     pages, which apply it at playback time (chat alerts, the video queue,
//     shoutouts, custom-overlay sound/video layers and the bot-voice overlay).
//
// That is what lets the Mixer panel balance the whole stream from one place.
// The values are persisted as the `mixer` key inside the same user_settings
// blob the frontend syncs (see userSettings.js) — this module only owns the
// shape and clamping, not the storage.
const userSettings = require("./userSettings");

const DEFAULT_MIXER = Object.freeze({
  master: 1,
  botVoice: 1,
  chatTts: 1,
  chatAlerts: 1,
  videoQueue: 1,
  shoutout: 1,
  overlaySound: 1,
});

const CHANNELS = Object.keys(DEFAULT_MIXER);

function clamp01(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

// Always returns a full, clamped channel set — a partial/foreign blob can never
// drop a channel or push a gain outside 0..1.
function sanitizeMixer(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const key of CHANNELS) out[key] = clamp01(source[key], DEFAULT_MIXER[key]);
  return out;
}

function getMixer(twitchId) {
  const settings = userSettings.getSettings(twitchId);
  return sanitizeMixer(settings && settings.mixer);
}

function setMixer(twitchId, raw) {
  const mixer = sanitizeMixer(raw);
  const settings = userSettings.getSettings(twitchId) || {};
  userSettings.setSettings(twitchId, { ...settings, mixer });
  return mixer;
}

module.exports = { DEFAULT_MIXER, CHANNELS, clamp01, sanitizeMixer, getMixer, setMixer };
