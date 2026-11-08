// Per-account alert sound for the watch-streak overlay: one clip, replaced in
// place, stored on disk with a flat JSON manifest (same style as
// avatarOverlay.js/chatOverlayBg.js). The overlay fetches the binary through
// /streak/audio?token=... and plays it when the card appears.
//
// The volume is not a setting here: the streakAlert channel of the audio mixer
// (mixer.js) already owns it, so the overlay applies channel × master at
// playback time like every other alert sound.
const fs = require("fs");
const path = require("path");

// Overridable so the unit suite can point the store at a throwaway tmpdir
// instead of writing test clips into the real data directory.
const AUDIO_DIR = process.env.STREAK_AUDIO_DIR || path.join(__dirname, "data", "streakAudio");
const TMP_DIR = path.join(AUDIO_DIR, "tmp");
const MANIFEST_PATH = path.join(AUDIO_DIR, "manifest.json");

// A streak alert is a short sting, not a song. 4 MB is generous for a few
// seconds even at a high bitrate, and it stays under nginx's 5 MB body limit
// for `location /` without needing a dedicated upload location.
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_NAME = 120;
const MIME_EXT = {
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
};

fs.mkdirSync(TMP_DIR, { recursive: true });

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeManifest(manifest) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

// The original filename is display-only; strip any path and control bytes so
// it is safe to render and cannot grow unbounded.
function safeName(name) {
  const base = path.basename(String(name || "alert"));
  return base.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, MAX_NAME) || "alert";
}

function filePathFor(twitchId, ext) {
  return path.join(AUDIO_DIR, `${twitchId}.${ext}`);
}

// tmpFilePath: a multer-uploaded temp file to move into place (multer's disk
// storage already wrote it to a scratch location).
function saveAudio(twitchId, tmpFilePath, mime, sizeBytes, originalName) {
  const ext = MIME_EXT[mime];
  if (!ext) {
    fs.unlink(tmpFilePath, () => {});
    throw new Error("UNSUPPORTED_TYPE");
  }
  if (sizeBytes > MAX_BYTES) {
    fs.unlink(tmpFilePath, () => {});
    throw new Error("TOO_LARGE");
  }

  const manifest = readManifest();
  const prev = manifest[twitchId];
  // Replacing mp3 with wav leaves the old file behind unless it is removed.
  if (prev && prev.ext !== ext) {
    try { fs.unlinkSync(filePathFor(twitchId, prev.ext)); } catch {}
  }

  fs.renameSync(tmpFilePath, filePathFor(twitchId, ext));
  const entry = {
    ext,
    mime,
    name: safeName(originalName),
    sizeBytes,
    updatedAt: new Date().toISOString(),
  };
  manifest[twitchId] = entry;
  writeManifest(manifest);
  return { hasAudio: true, name: entry.name, sizeBytes, mime, updatedAt: entry.updatedAt };
}

function getAudio(twitchId) {
  const entry = readManifest()[twitchId];
  if (!entry) return null;
  const filePath = filePathFor(twitchId, entry.ext);
  if (!fs.existsSync(filePath)) return null;
  return { filePath, ...entry };
}

function getStatus(twitchId) {
  const audio = getAudio(twitchId);
  if (!audio) return { hasAudio: false };
  return {
    hasAudio: true,
    name: audio.name,
    sizeBytes: audio.sizeBytes,
    mime: audio.mime,
    updatedAt: audio.updatedAt,
  };
}

function deleteAudio(twitchId) {
  const manifest = readManifest();
  const entry = manifest[twitchId];
  if (entry) {
    try { fs.unlinkSync(filePathFor(twitchId, entry.ext)); } catch {}
    delete manifest[twitchId];
    writeManifest(manifest);
  }
  return { hasAudio: false };
}

module.exports = {
  saveAudio,
  getAudio,
  getStatus,
  deleteAudio,
  MAX_BYTES,
  TMP_DIR,
};
