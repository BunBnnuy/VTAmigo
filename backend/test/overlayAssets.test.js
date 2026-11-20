// Content-addressed storage for Overlay Builder assets: identical uploads
// (even across accounts) share one file, and deletion only removes the bytes
// when the last manifest reference is gone. OVERLAY_ASSETS_DIR must be set
// before requiring the module because it resolves its directory at load time.
import { afterAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ASSETS_DIR = path.join(os.tmpdir(), `vtamigo-overlay-assets-${process.pid}`);
process.env.OVERLAY_ASSETS_DIR = ASSETS_DIR;
const BLOBS_DIR = path.join(ASSETS_DIR, "blobs");
const MANIFEST_PATH = path.join(ASSETS_DIR, "manifest.json");

// Seed a pre-hash ("legacy") asset before the module loads so its one-time
// migration runs as part of the require below.
const LEGACY_USER = "legacy-user";
const LEGACY_ID = "legacy-asset";
const LEGACY_BYTES = Buffer.from("legacy-image-bytes");
fs.mkdirSync(ASSETS_DIR, { recursive: true });
fs.writeFileSync(path.join(ASSETS_DIR, `${LEGACY_USER}-${LEGACY_ID}.png`), LEGACY_BYTES);
fs.writeFileSync(MANIFEST_PATH, JSON.stringify({
  [LEGACY_USER]: {
    [LEGACY_ID]: { kind: "image", ext: "png", mime: "image/png", sizeBytes: LEGACY_BYTES.length, name: "Legacy" },
  },
}));

const overlayAssets = require("../overlayAssets");

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const blobCount = () => fs.readdirSync(BLOBS_DIR).length;
const readEntry = (twitchId, assetId) => JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"))[twitchId][assetId];

afterAll(() => fs.rmSync(ASSETS_DIR, { recursive: true, force: true }));

describe("overlayAssets content addressing", () => {
  it("migrates legacy per-asset files into the blob store", () => {
    const hash = crypto.createHash("sha256").update(LEGACY_BYTES).digest("hex");
    expect(fs.existsSync(path.join(ASSETS_DIR, `${LEGACY_USER}-${LEGACY_ID}.png`))).toBe(false);
    expect(fs.existsSync(path.join(BLOBS_DIR, hash))).toBe(true);
    expect(readEntry(LEGACY_USER, LEGACY_ID).sha256).toBe(hash);
    expect(overlayAssets.getAsset(LEGACY_USER, LEGACY_ID).filePath).toBe(path.join(BLOBS_DIR, hash));
  });

  it("stores identical uploads from different users only once", () => {
    const before = blobCount();
    const first = overlayAssets.saveImage("user-a", PNG, "Shared");
    const second = overlayAssets.saveImage("user-b", PNG, "Shared too");
    expect(blobCount()).toBe(before + 1);
    expect(readEntry("user-a", first.id).sha256).toBe(readEntry("user-b", second.id).sha256);
    expect(overlayAssets.getAsset("user-a", first.id)).toBeTruthy();
    expect(overlayAssets.getAsset("user-b", second.id)).toBeTruthy();
  });

  it("keeps the blob until the last reference is deleted", () => {
    const unique = `data:image/png;base64,${Buffer.from("unique-image-bytes").toString("base64")}`;
    const before = blobCount();
    const first = overlayAssets.saveImage("del-a", unique, "One");
    const second = overlayAssets.saveImage("del-b", unique, "Two");
    expect(blobCount()).toBe(before + 1);

    expect(overlayAssets.deleteAsset("del-a", first.id)).toBe(true);
    expect(blobCount()).toBe(before + 1);
    expect(overlayAssets.getAsset("del-b", second.id)).toBeTruthy();

    expect(overlayAssets.deleteAsset("del-b", second.id)).toBe(true);
    expect(blobCount()).toBe(before);
  });

  it("dedups multer-style uploads and cleans the temp files", () => {
    const firstTmp = path.join(ASSETS_DIR, "clip-1.tmp");
    const secondTmp = path.join(ASSETS_DIR, "clip-2.tmp");
    const bytes = Buffer.from("identical-video-bytes");
    fs.writeFileSync(firstTmp, bytes);
    fs.writeFileSync(secondTmp, bytes);

    const before = blobCount();
    const first = overlayAssets.saveVideo("vid-a", firstTmp, "video/mp4", bytes.length, "clip.mp4");
    const second = overlayAssets.saveVideo("vid-b", secondTmp, "video/mp4", bytes.length, "clip-2.mp4");

    expect(blobCount()).toBe(before + 1);
    expect(fs.existsSync(firstTmp)).toBe(false);
    expect(fs.existsSync(secondTmp)).toBe(false);
    expect(overlayAssets.getAsset("vid-a", first.id)).toBeTruthy();
    expect(overlayAssets.getAsset("vid-b", second.id)).toBeTruthy();

    overlayAssets.deleteAsset("vid-a", first.id);
    expect(blobCount()).toBe(before + 1);
    overlayAssets.deleteAsset("vid-b", second.id);
    expect(blobCount()).toBe(before);
  });
});
