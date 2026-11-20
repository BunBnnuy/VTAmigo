// Account-scoped image/video library for the custom Overlay Builder
// (backend/overlayLayouts.js, backend/overlay/custom.html). Assets are kept
// separate from layouts so the same upload can be reused across several
// layouts — stored on disk with a flat JSON manifest, same style as
// avatarOverlay.js/chatOverlayBg.js, keyed by a generated id instead of a
// fixed slot since an account can have any number of assets.
//
// File bytes are content-addressed: every upload is hashed with SHA-256 and
// stored once under data/overlayAssets/blobs/<sha256>, while the manifest
// keeps one entry per account/asset pointing at that hash. Two users (or the
// same user twice) uploading identical bytes therefore share a single file on
// disk, and the file is only unlinked when the last manifest entry that
// references it is deleted. URLs and quota accounting stay per-asset.
const fs = require("fs");
const path = require("path");
const { randomUUID, createHash } = require("crypto");

// Tests pin OVERLAY_ASSETS_DIR to a temp directory before requiring this
// module (see backend/test/overlayAssets.test.js); production uses the repo
// data directory.
const ASSETS_DIR = process.env.OVERLAY_ASSETS_DIR || path.join(__dirname, "data", "overlayAssets");
const MANIFEST_PATH = path.join(ASSETS_DIR, "manifest.json");
const BLOBS_DIR = path.join(ASSETS_DIR, "blobs");
// One per-file cap for every asset kind (image, video, audio). Keeping a
// single number is what lets the routes, the JSON-body budget in app.js and
// the nginx upload location stay in sync; the per-account total is still
// bounded by QUOTA_BYTES below.
const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = MAX_ASSET_BYTES;
const MAX_VIDEO_BYTES = MAX_ASSET_BYTES;
const MAX_AUDIO_BYTES = MAX_ASSET_BYTES;
// Total disk quota across every asset kind combined, per account.
const QUOTA_BYTES = 100 * 1024 * 1024;
// Cap for user-provided asset names (metadata only, never used as a path).
const MAX_NAME_LENGTH = 80;
function cleanName(name) {
  return String(name ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_NAME_LENGTH);
}
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
fs.mkdirSync(BLOBS_DIR, { recursive: true });

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

// Legacy per-asset path (before content addressing). Kept for the one-time
// migration and as a fallback for any entry that still lacks a sha256.
function filePathFor(twitchId, assetId, ext) {
  return path.join(ASSETS_DIR, `${twitchId}-${assetId}.${ext}`);
}

// Blobs are named only by hash (no extension): the manifest already stores the
// mime type, and the asset route sets Content-Type explicitly.
function blobPath(sha256) {
  return path.join(BLOBS_DIR, sha256);
}

function hashBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function hashFile(filePath) {
  return hashBuffer(fs.readFileSync(filePath));
}

// Moves an upload into the blob store, or discards it when the same bytes are
// already there. Either way the caller ends up with a manifest-ready hash.
function storeBlob(buffer, hash) {
  const target = blobPath(hash);
  if (!fs.existsSync(target)) fs.writeFileSync(target, buffer);
}

function storeBlobFromFile(tmpFilePath, hash) {
  const target = blobPath(hash);
  if (fs.existsSync(target)) {
    fs.unlinkSync(tmpFilePath);
    return;
  }
  fs.renameSync(tmpFilePath, target);
}

// Hash + store one multer temp file, cleaning the scratch file if anything
// goes wrong so a failed upload can't leak into data/overlayAssets/tmp.
function hashAndStoreUpload(tmpFilePath) {
  try {
    const hash = hashFile(tmpFilePath);
    storeBlobFromFile(tmpFilePath, hash);
    return hash;
  } catch (err) {
    try { fs.unlinkSync(tmpFilePath); } catch {}
    throw err;
  }
}

// True while any account still has an entry pointing at this blob.
function blobIsReferenced(manifest, hash) {
  for (const account of Object.values(manifest)) {
    for (const entry of Object.values(account || {})) {
      if (entry && entry.sha256 === hash) return true;
    }
  }
  return false;
}

// One-time upgrade for assets stored before hashing: hash the legacy file,
// move it to its content-addressed blob (deduping against an existing one)
// and record the sha in the manifest. Idempotent, so node --watch restarts
// and a crash mid-migration are both safe.
function migrateLegacyAssets() {
  const manifest = readManifest();
  let moved = 0;
  let deduped = 0;
  let missing = 0;

  for (const [twitchId, account] of Object.entries(manifest)) {
    for (const [assetId, entry] of Object.entries(account || {})) {
      if (!entry || entry.sha256) continue;
      const legacyPath = filePathFor(twitchId, assetId, entry.ext);
      if (!fs.existsSync(legacyPath)) { missing++; continue; }
      try {
        const hash = hashFile(legacyPath);
        const target = blobPath(hash);
        if (fs.existsSync(target)) {
          fs.unlinkSync(legacyPath);
          deduped++;
        } else {
          fs.renameSync(legacyPath, target);
          moved++;
        }
        entry.sha256 = hash;
      } catch (err) {
        // Don't let one unreadable file prevent the backend from starting;
        // getAsset still falls back to the legacy path for this entry.
        console.error(`[overlayAssets] could not migrate ${twitchId}/${assetId}:`, err.message);
      }
    }
  }

  if (moved || deduped || missing) {
    writeManifest(manifest);
    console.log(`[overlayAssets] migrated ${moved} asset(s), deduped ${deduped}, missing files ${missing}`);
  }
}

// Sum of every asset's sizeBytes for one account, across all kinds — the
// number QUOTA_BYTES is measured against.
function getUsageBytes(twitchId) {
  const account = readManifest()[twitchId] || {};
  return Object.values(account).reduce((sum, entry) => sum + (entry.sizeBytes || 0), 0);
}

// dataUrl: "data:image/png;base64,AAAA..." — as produced by FileReader.readAsDataURL
function saveImage(twitchId, dataUrl, name) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || "");
  if (!match) throw new Error("BAD_DATA_URL");
  const [, mime, base64] = match;
  const ext = IMAGE_MIME_EXT[mime];
  if (!ext) throw new Error("UNSUPPORTED_TYPE");

  const buffer = Buffer.from(base64, "base64");
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error("TOO_LARGE");
  if (getUsageBytes(twitchId) + buffer.length > QUOTA_BYTES) throw new Error("QUOTA_EXCEEDED");

  const sha256 = hashBuffer(buffer);
  storeBlob(buffer, sha256);

  const assetId = randomUUID();
  const assetName = cleanName(name);
  const manifest = readManifest();
  const account = manifest[twitchId] || (manifest[twitchId] = {});
  account[assetId] = { kind: "image", ext, mime, sizeBytes: buffer.length, name: assetName, sha256, createdAt: new Date().toISOString() };
  writeManifest(manifest);

  return { id: assetId, kind: "image", mime, sizeBytes: buffer.length, name: assetName };
}

// tmpFilePath: a multer-uploaded temp file to move into place (not copy —
// multer's disk storage already wrote it to a scratch location).
function saveVideo(twitchId, tmpFilePath, mime, sizeBytes, name) {
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

  const sha256 = hashAndStoreUpload(tmpFilePath);

  const assetId = randomUUID();
  const assetName = cleanName(name);
  const manifest = readManifest();
  const account = manifest[twitchId] || (manifest[twitchId] = {});
  account[assetId] = { kind: "video", ext, mime, sizeBytes, name: assetName, sha256, createdAt: new Date().toISOString() };
  writeManifest(manifest);

  return { id: assetId, kind: "video", mime, sizeBytes, name: assetName };
}

// Same shape as saveVideo — a multer temp file moved into place.
function saveAudio(twitchId, tmpFilePath, mime, sizeBytes, name) {
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

  const sha256 = hashAndStoreUpload(tmpFilePath);

  const assetId = randomUUID();
  const assetName = cleanName(name);
  const manifest = readManifest();
  const account = manifest[twitchId] || (manifest[twitchId] = {});
  account[assetId] = { kind: "audio", ext, mime, sizeBytes, name: assetName, sha256, createdAt: new Date().toISOString() };
  writeManifest(manifest);

  return { id: assetId, kind: "audio", mime, sizeBytes, name: assetName };
}

// Returns { filePath, mime, kind, sizeBytes } or null.
function getAsset(twitchId, assetId) {
  const entry = readManifest()[twitchId]?.[assetId];
  if (!entry) return null;
  // Fallback to the legacy path keeps a pre-migration entry readable if the
  // one-time migration hasn't run yet (or hit a missing file).
  const filePath = entry.sha256 ? blobPath(entry.sha256) : filePathFor(twitchId, assetId, entry.ext);
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
    name: entry.name || "",
    createdAt: entry.createdAt,
  }));
}

// Metadata-only rename: the id, storage path and ext stay the same, so every
// layer using this asset keeps working and simply picks up the new label.
function renameAsset(twitchId, assetId, name) {
  const manifest = readManifest();
  const entry = manifest[twitchId]?.[assetId];
  if (!entry) return null;
  entry.name = cleanName(name);
  writeManifest(manifest);
  return { id: assetId, kind: entry.kind, mime: entry.mime, sizeBytes: entry.sizeBytes, name: entry.name };
}

// removeAssetEverywhere: injected by index.js (overlayLayouts.removeAssetEverywhere)
// to avoid a circular require between this module and overlayLayouts.js.
function deleteAsset(twitchId, assetId, removeAssetEverywhere) {
  const manifest = readManifest();
  const entry = manifest[twitchId]?.[assetId];
  if (!entry) return false;

  delete manifest[twitchId][assetId];
  writeManifest(manifest);

  // Content-addressed files are shared: only remove the bytes when no other
  // account/asset entry still points at the same sha. Everything here is
  // synchronous, so no upload can add a reference between the write and this
  // check. Legacy (pre-hash) entries keep their old per-asset cleanup path.
  if (entry.sha256) {
    if (!blobIsReferenced(manifest, entry.sha256)) {
      try { fs.unlinkSync(blobPath(entry.sha256)); } catch {}
    }
  } else {
    try { fs.unlinkSync(filePathFor(twitchId, assetId, entry.ext)); } catch {}
  }

  if (removeAssetEverywhere) removeAssetEverywhere(twitchId, assetId);
  return true;
}

// One-time, idempotent upgrade for all legacy per-asset files.
migrateLegacyAssets();

module.exports = {
  saveImage, saveVideo, saveAudio, getAsset, listAssets, renameAsset, deleteAsset, getUsageBytes,
  MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, MAX_AUDIO_BYTES, QUOTA_BYTES,
};
