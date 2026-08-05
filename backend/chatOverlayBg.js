// Per-account background-panel image for the chat overlay
// (backend/overlay/chat.html), rendered there as a nine-slice texture behind
// the message feed. One file per account — same storage pattern as
// avatarOverlay.js (flat JSON manifest + one image file per account on disk).
const fs = require("fs");
const path = require("path");

const IMAGES_DIR = path.join(__dirname, "data", "chatOverlayBg");
const MANIFEST_PATH = path.join(IMAGES_DIR, "manifest.json");
const MAX_BYTES = 5 * 1024 * 1024;
const MIME_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

fs.mkdirSync(IMAGES_DIR, { recursive: true });

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

// dataUrl: "data:image/png;base64,AAAA..." — as produced by FileReader.readAsDataURL
function saveImage(twitchId, dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || "");
  if (!match) throw new Error("BAD_DATA_URL");
  const [, mime, base64] = match;
  const ext = MIME_EXT[mime];
  if (!ext) throw new Error("UNSUPPORTED_TYPE");

  const buffer = Buffer.from(base64, "base64");
  if (buffer.length > MAX_BYTES) throw new Error("TOO_LARGE");

  const manifest = readManifest();
  const prev = manifest[twitchId];
  if (prev && prev.ext !== ext) {
    try { fs.unlinkSync(path.join(IMAGES_DIR, `${twitchId}.${prev.ext}`)); } catch {}
  }

  fs.writeFileSync(path.join(IMAGES_DIR, `${twitchId}.${ext}`), buffer);
  manifest[twitchId] = { ext, mime };
  writeManifest(manifest);
}

function deleteImage(twitchId) {
  const manifest = readManifest();
  const entry = manifest[twitchId];
  if (!entry) return;
  try { fs.unlinkSync(path.join(IMAGES_DIR, `${twitchId}.${entry.ext}`)); } catch {}
  delete manifest[twitchId];
  writeManifest(manifest);
}

// Returns { filePath, mime } or null if this account has no background image.
function getImage(twitchId) {
  const entry = readManifest()[twitchId];
  if (!entry) return null;
  const filePath = path.join(IMAGES_DIR, `${twitchId}.${entry.ext}`);
  if (!fs.existsSync(filePath)) return null;
  return { filePath, mime: entry.mime };
}

function hasImage(twitchId) {
  return !!readManifest()[twitchId];
}

module.exports = { saveImage, deleteImage, getImage, hasImage, MAX_BYTES };
