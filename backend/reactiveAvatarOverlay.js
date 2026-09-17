// Per-account speaking/silent images for the microphone-driven avatar overlay.
// This store is deliberately separate from avatarOverlay.js: the bot TTS
// avatar and the streamer's reactive avatar must never replace each other's
// images or manifests.
const fs = require("fs");
const path = require("path");

const AVATARS_DIR = process.env.REACTIVE_AVATARS_DIR || path.join(__dirname, "data", "reactive-avatars");
const MANIFEST_PATH = path.join(AVATARS_DIR, "manifest.json");
const MAX_BYTES = 5 * 1024 * 1024;
const SLOTS = ["speaking", "silent"];
const MIME_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

fs.mkdirSync(AVATARS_DIR, { recursive: true });

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

function saveImage(twitchId, slot, dataUrl) {
  if (!SLOTS.includes(slot)) throw new Error("BAD_SLOT");
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || "");
  if (!match) throw new Error("BAD_DATA_URL");
  const [, mime, base64] = match;
  const ext = MIME_EXT[mime];
  if (!ext) throw new Error("UNSUPPORTED_TYPE");

  const buffer = Buffer.from(base64, "base64");
  if (buffer.length > MAX_BYTES) throw new Error("TOO_LARGE");

  const manifest = readManifest();
  const account = manifest[twitchId] || {};
  const prev = account[slot];
  if (prev && prev.ext !== ext) {
    try { fs.unlinkSync(path.join(AVATARS_DIR, `${twitchId}-${slot}.${prev.ext}`)); } catch {}
  }

  fs.writeFileSync(path.join(AVATARS_DIR, `${twitchId}-${slot}.${ext}`), buffer);
  account[slot] = { ext, mime };
  manifest[twitchId] = account;
  writeManifest(manifest);
}

function getImage(twitchId, slot) {
  if (!SLOTS.includes(slot)) return null;
  const entry = readManifest()[twitchId]?.[slot];
  if (!entry) return null;
  const filePath = path.join(AVATARS_DIR, `${twitchId}-${slot}.${entry.ext}`);
  if (!fs.existsSync(filePath)) return null;
  return { filePath, mime: entry.mime };
}

function getStatus(twitchId) {
  const account = readManifest()[twitchId] || {};
  return { hasSpeaking: !!account.speaking, hasSilent: !!account.silent };
}

module.exports = { saveImage, getImage, getStatus, MAX_BYTES };
