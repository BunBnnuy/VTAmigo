// Account-scoped image/video library for the custom Overlay Builder
// (backend/overlayLayouts.js, backend/overlay/custom.html). Assets are kept
// separate from layouts so the same upload can be reused across several
// layouts — stored on disk with a flat JSON manifest, same style as
// avatarOverlay.js/chatOverlayBg.js, keyed by a generated id instead of a
// fixed slot since an account can have any number of assets.
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const ASSETS_DIR = path.join(__dirname, "data", "overlayAssets");
const MANIFEST_PATH = path.join(ASSETS_DIR, "manifest.json");
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 150 * 1024 * 1024;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
// Total disk quota across every asset kind combined, per account.
const QUOTA_BYTES = 100 * 1024 * 1024;
const IMAGE_MIME_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};
const VIDEO_MIME_EXT = {
  "video/mp4": "mp4",
  "video/webm": "webm",
};
const AUDIO_MIME_EXT = {
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
};

fs.mkdirSync(ASSETS_DIR, { recursive: true });

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

function filePathFor(twitchId, assetId, ext) {
  return path.join(ASSETS_DIR, `${twitchId}-${assetId}.${ext}`);
}

// Sum of every asset's sizeBytes for one account, across all kinds — the
// number QUOTA_BYTES is measured against.
function getUsageBytes(twitchId) {
  const account = readManifest()[twitchId] || {};
  return Object.values(account).reduce((sum, entry) => sum + (entry.sizeBytes || 0), 0);
}

// dataUrl: "data:image/png;base64,AAAA..." — as produced by FileReader.readAsDataURL
function saveImage(twitchId, dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || "");
  if (!match) throw new Error("BAD_DATA_URL");
  const [, mime, base64] = match;
  const ext = IMAGE_MIME_EXT[mime];
  if (!ext) throw new Error("UNSUPPORTED_TYPE");

  const buffer = Buffer.from(base64, "base64");
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error("TOO_LARGE");
  if (getUsageBytes(twitchId) + buffer.length > QUOTA_BYTES) throw new Error("QUOTA_EXCEEDED");

  const assetId = randomUUID();
  fs.writeFileSync(filePathFor(twitchId, assetId, ext), buffer);

  const manifest = readManifest();
  const account = manifest[twitchId] || (manifest[twitchId] = {});
  account[assetId] = { kind: "image", ext, mime, sizeBytes: buffer.length, createdAt: new Date().toISOString() };
  writeManifest(manifest);

  return { id: assetId, kind: "image", mime, sizeBytes: buffer.length };
}

// tmpFilePath: a multer-uploaded temp file to move into place (not copy —
// multer's disk storage already wrote it to a scratch location).
function saveVideo(twitchId, tmpFilePath, mime, sizeBytes) {
  const ext = VIDEO_MIME_EXT[mime];
  if (!ext) {
    fs.unlink(tmpFilePath, () => {});
    throw new Error("UNSUPPORTED_TYPE");
  }
  if (sizeBytes > MAX_VIDEO_BYTES) {
    fs.unlink(tmpFilePath, () => {});
    throw new Error("TOO_LARGE");
  }
  if (getUsageBytes(twitchId) + sizeBytes > QUOTA_BYTES) {
    fs.unlink(tmpFilePath, () => {});
    throw new Error("QUOTA_EXCEEDED");
  }

  const assetId = randomUUID();
  fs.renameSync(tmpFilePath, filePathFor(twitchId, assetId, ext));

  const manifest = readManifest();
  const account = manifest[twitchId] || (manifest[twitchId] = {});
  account[assetId] = { kind: "video", ext, mime, sizeBytes, createdAt: new Date().toISOString() };
  writeManifest(manifest);

  return { id: assetId, kind: "video", mime, sizeBytes };
}

// Same shape as saveVideo — a multer temp file moved into place.
function saveAudio(twitchId, tmpFilePath, mime, sizeBytes) {
  const ext = AUDIO_MIME_EXT[mime];
  if (!ext) {
    fs.unlink(tmpFilePath, () => {});
    throw new Error("UNSUPPORTED_TYPE");
  }
  if (sizeBytes > MAX_AUDIO_BYTES) {
    fs.unlink(tmpFilePath, () => {});
    throw new Error("TOO_LARGE");
  }
  if (getUsageBytes(twitchId) + sizeBytes > QUOTA_BYTES) {
    fs.unlink(tmpFilePath, () => {});
    throw new Error("QUOTA_EXCEEDED");
  }

  const assetId = randomUUID();
  fs.renameSync(tmpFilePath, filePathFor(twitchId, assetId, ext));

  const manifest = readManifest();
  const account = manifest[twitchId] || (manifest[twitchId] = {});
  account[assetId] = { kind: "audio", ext, mime, sizeBytes, createdAt: new Date().toISOString() };
  writeManifest(manifest);

  return { id: assetId, kind: "audio", mime, sizeBytes };
}

// Returns { filePath, mime, kind, sizeBytes } or null.
function getAsset(twitchId, assetId) {
  const entry = readManifest()[twitchId]?.[assetId];
  if (!entry) return null;
  const filePath = filePathFor(twitchId, assetId, entry.ext);
  if (!fs.existsSync(filePath)) return null;
  return { filePath, mime: entry.mime, kind: entry.kind, sizeBytes: entry.sizeBytes };
}

function listAssets(twitchId) {
  const account = readManifest()[twitchId] || {};
  return Object.entries(account).map(([id, entry]) => ({
    id,
    kind: entry.kind,
    mime: entry.mime,
    sizeBytes: entry.sizeBytes,
    createdAt: entry.createdAt,
  }));
}

// removeAssetEverywhere: injected by index.js (overlayLayouts.removeAssetEverywhere)
// to avoid a circular require between this module and overlayLayouts.js.
function deleteAsset(twitchId, assetId, removeAssetEverywhere) {
  const manifest = readManifest();
  const entry = manifest[twitchId]?.[assetId];
  if (!entry) return false;

  try { fs.unlinkSync(filePathFor(twitchId, assetId, entry.ext)); } catch {}
  delete manifest[twitchId][assetId];
  writeManifest(manifest);

  if (removeAssetEverywhere) removeAssetEverywhere(twitchId, assetId);
  return true;
}

module.exports = {
  saveImage, saveVideo, saveAudio, getAsset, listAssets, deleteAsset, getUsageBytes,
  MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, MAX_AUDIO_BYTES, QUOTA_BYTES,
};
