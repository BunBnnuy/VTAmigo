// The Custom Overlay Builder (frontend/src/OverlayBuilder.jsx): named layouts
// of freely-placed image/text/video/audio layers, the account-scoped media
// library behind them, and the OBS-facing page that renders one.
//
// Auth is mixed, matching what was in app.js:
//
//   • everything under "/overlay-builder/..." sits under that
//     PROTECTED_PREFIXES entry, so req.user is already populated by the
//     blanket gate in app.js, which is registered before this router is
//     mounted. That is why none of them repeat requireApprovedUser.
//   • bare "/overlay-builder" (the Studio SPA page itself) is EXCLUDED from
//     that gate and never reaches this router at all — it falls through to
//     the SPA catch-all and does its own client-side /auth/me check. Keep
//     that exclusion in app.js in sync with this file.
//   • the "/overlay/custom/..." routes are OBS-facing and "/overlay" is not a
//     protected prefix, so they do their own inline check (overlay ?token= OR
//     session cookie).
const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { getApprovedUserFromCookieHeader, getOverlayToken, findUserByOverlayToken } = require("../auth");
const activity = require("../activity");
const achievements = require("../achievements");
const overlayAssets = require("../overlayAssets");
const overlayLayouts = require("../overlayLayouts");
const { broadcastToAccount, notifyAchievements } = require("../sessions");

const router = express.Router();

const overlayVideoTmpDir = path.join(__dirname, "..", "data", "overlayAssets", "tmp");
fs.mkdirSync(overlayVideoTmpDir, { recursive: true });
const overlayVideoUpload = multer({
  dest: overlayVideoTmpDir,
  limits: { fileSize: overlayAssets.MAX_VIDEO_BYTES },
});
const overlayAudioUpload = multer({
  dest: overlayVideoTmpDir,
  limits: { fileSize: overlayAssets.MAX_AUDIO_BYTES },
});

// ── Authed builder API (requireApprovedUser via PROTECTED_PREFIXES) ─────────

router.get("/overlay-builder/layouts", (req, res) => {
  res.json({ layouts: overlayLayouts.listLayouts(req.user.twitchId) });
});

router.post("/overlay-builder/layouts", (req, res) => {
  const layout = overlayLayouts.createLayout(req.user.twitchId, req.body?.name);
  notifyAchievements(req.user.twitchId, achievements.checkAndUnlock(req.user.twitchId));
  res.json({ layout });
});

router.get("/overlay-builder/layouts/:id", (req, res) => {
  const layout = overlayLayouts.getLayout(req.user.twitchId, req.params.id);
  if (!layout) return res.status(404).json({ error: "Not found" });
  res.json({ layout });
});

// PUT /overlay-builder/layouts/:id — { name?, layers? }; broadcasts the new
// layers to any open OBS view of this layout over the /chat WS so it updates
// live without a manual browser-source refresh.
router.put("/overlay-builder/layouts/:id", (req, res) => {
  const layout = overlayLayouts.updateLayout(req.user.twitchId, req.params.id, req.body || {});
  if (!layout) return res.status(404).json({ error: "Not found" });
  const liveToken = getOverlayToken(req.user.twitchId);
  const resolvedLayers = layout.layers.map((l) => (
    l.assetId ? { ...l, assetUrl: `/overlay/custom/asset/${l.assetId}?token=${liveToken}` } : l
  ));
  broadcastToAccount(req.user.twitchId, { type: "custom_overlay_update", layoutId: layout.id, layers: resolvedLayers });
  res.json({ layout });
});

router.delete("/overlay-builder/layouts/:id", (req, res) => {
  overlayLayouts.deleteLayout(req.user.twitchId, req.params.id);
  res.json({ ok: true });
});

// GET /overlay-builder/overlay-url/:layoutId — the OBS Browser Source URL for
// one layout, for the builder's "Copy OBS URL" button. `token` is also
// returned on its own (same value regardless of layoutId — it's per-account)
// so the canvas editor can build asset-preview URLs without a second route.
router.get("/overlay-builder/overlay-url/:layoutId", (req, res) => {
  const token = getOverlayToken(req.user.twitchId);
  res.json({ url: `${req.protocol}://${req.get("host")}/overlay/custom/${req.params.layoutId}?token=${token}`, token });
});

router.get("/overlay-builder/assets", (req, res) => {
  res.json({
    assets: overlayAssets.listAssets(req.user.twitchId),
    usageBytes: overlayAssets.getUsageBytes(req.user.twitchId),
    quotaBytes: overlayAssets.QUOTA_BYTES,
  });
});

// GET /overlay-builder/latest-activity — most recent event per kind (follow,
// sub, resub, giftsub, raid, cheer, redeem), so the builder can preview
// {follower.username}-style template tokens with real data instead of
// showing the raw placeholder while editing.
router.get("/overlay-builder/latest-activity", (req, res) => {
  res.json({ latestByKind: activity.getLatestByKind(req.user.twitchId) });
});

// PUT /overlay-builder/latest-activity/:kind — { username } — manually
// pre-fills {<namespace>.username} for a kind Twitch's API has no history
// for at all (sub/resub/giftsub/raid/cheer — see activity.js). A real live
// event of that kind always takes over once one happens; an empty username
// clears the pre-fill.
router.put("/overlay-builder/latest-activity/:kind", (req, res) => {
  try {
    activity.setManualLatest(req.user.twitchId, req.params.kind, req.body?.username);
    res.json({ latestByKind: activity.getLatestByKind(req.user.twitchId) });
  } catch (err) {
    if (err.message === "BAD_KIND") return res.status(400).json({ error: "Unknown kind" });
    console.error("[overlay-builder/latest-activity]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /overlay-builder/assets — { dataUrl } — image upload, same base64
// pattern as /overlay/avatar/upload.
router.post("/overlay-builder/assets", (req, res) => {
  try {
    const asset = overlayAssets.saveImage(req.user.twitchId, req.body?.dataUrl);
    res.json({ asset });
  } catch (err) {
    if (err.message === "BAD_DATA_URL") return res.status(400).json({ error: "dataUrl is required" });
    if (err.message === "UNSUPPORTED_TYPE") return res.status(400).json({ error: "Image must be JPEG, PNG, GIF, or WebP" });
    if (err.message === "TOO_LARGE") return res.status(413).json({ error: `Image must be under ${overlayAssets.MAX_IMAGE_BYTES / (1024 * 1024)}MB` });
    if (err.message === "QUOTA_EXCEEDED") return res.status(413).json({ error: `Storage quota exceeded — you get ${overlayAssets.QUOTA_BYTES / (1024 * 1024)}MB total across all media. Delete some uploads to free up space.` });
    console.error("[overlay-builder/assets]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /overlay-builder/assets/video — multipart upload (field name "video"),
// real files rather than base64 since videos are far bigger than the
// 10mb JSON body cap comfortably allows.
router.post("/overlay-builder/assets/video", (req, res) => {
  overlayVideoUpload.single("video")(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: `Video must be under ${overlayAssets.MAX_VIDEO_BYTES / (1024 * 1024)}MB` });
      console.error("[overlay-builder/assets/video]", err.message);
      return res.status(400).json({ error: "Upload failed" });
    }
    if (!req.file) return res.status(400).json({ error: "video file is required" });
    try {
      const asset = overlayAssets.saveVideo(req.user.twitchId, req.file.path, req.file.mimetype, req.file.size);
      res.json({ asset });
    } catch (saveErr) {
      if (saveErr.message === "UNSUPPORTED_TYPE") return res.status(400).json({ error: "Video must be MP4 or WebM" });
      if (saveErr.message === "TOO_LARGE") return res.status(413).json({ error: `Video must be under ${overlayAssets.MAX_VIDEO_BYTES / (1024 * 1024)}MB` });
      if (saveErr.message === "QUOTA_EXCEEDED") return res.status(413).json({ error: `Storage quota exceeded — you get ${overlayAssets.QUOTA_BYTES / (1024 * 1024)}MB total across all media. Delete some uploads to free up space.` });
      console.error("[overlay-builder/assets/video]", saveErr.message);
      res.status(500).json({ error: saveErr.message });
    }
  });
});

// POST /overlay-builder/assets/audio — multipart upload (field name "audio"),
// same reasoning as the video route above.
router.post("/overlay-builder/assets/audio", (req, res) => {
  overlayAudioUpload.single("audio")(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: `Audio must be under ${overlayAssets.MAX_AUDIO_BYTES / (1024 * 1024)}MB` });
      console.error("[overlay-builder/assets/audio]", err.message);
      return res.status(400).json({ error: "Upload failed" });
    }
    if (!req.file) return res.status(400).json({ error: "audio file is required" });
    try {
      const asset = overlayAssets.saveAudio(req.user.twitchId, req.file.path, req.file.mimetype, req.file.size);
      res.json({ asset });
    } catch (saveErr) {
      if (saveErr.message === "UNSUPPORTED_TYPE") return res.status(400).json({ error: "Audio must be MP3, WAV, or OGG" });
      if (saveErr.message === "TOO_LARGE") return res.status(413).json({ error: `Audio must be under ${overlayAssets.MAX_AUDIO_BYTES / (1024 * 1024)}MB` });
      if (saveErr.message === "QUOTA_EXCEEDED") return res.status(413).json({ error: `Storage quota exceeded — you get ${overlayAssets.QUOTA_BYTES / (1024 * 1024)}MB total across all media. Delete some uploads to free up space.` });
      console.error("[overlay-builder/assets/audio]", saveErr.message);
      res.status(500).json({ error: saveErr.message });
    }
  });
});

router.delete("/overlay-builder/assets/:id", (req, res) => {
  overlayAssets.deleteAsset(req.user.twitchId, req.params.id, overlayLayouts.removeAssetEverywhere);
  res.json({ ok: true });
});

// ── Public/dual-auth OBS-facing routes ───────────────────────────────────────

// GET /overlay/custom/:layoutId?token=... — transparent overlay page (OBS
// browser source), public like every other /overlay/* page since OBS can't
// send the session cookie; the token in its query string scopes the data
// fetch + WS feed to one account.
router.get("/overlay/custom/:layoutId", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "overlay", "custom.html"));
});

// GET /overlay/custom/:layoutId/data?token=... — layout name + layers, with
// asset references resolved to fetchable URLs. Dual auth like /xp/ranking.
router.get("/overlay/custom/:layoutId/data", (req, res) => {
  const user = (req.query.token && findUserByOverlayToken(req.query.token)) || getApprovedUserFromCookieHeader(req.headers.cookie);
  if (!user) return res.status(401).json({ error: "Not authorized" });
  const layout = overlayLayouts.getLayout(user.twitchId, req.params.layoutId);
  if (!layout) return res.status(404).json({ error: "Not found" });
  res.json({
    name: layout.name,
    canvas: { w: overlayLayouts.CANVAS_W, h: overlayLayouts.CANVAS_H },
    layers: layout.layers.map((l) => (
      l.assetId ? { ...l, assetUrl: `/overlay/custom/asset/${l.assetId}?token=${req.query.token || ""}` } : l
    )),
    // For text layers using {follower.username}-style tokens (see
    // overlay/custom.html's fillTemplate) — the initial snapshot; live
    // updates arrive over the /chat WS as new events happen.
    latestByKind: activity.getLatestByKind(user.twitchId),
  });
});

// GET /overlay/custom/asset/:assetId?token=... — serves an uploaded
// image/video/audio binary. Dual auth like /overlay/avatar/image. Video and
// audio responses support Range requests (206 Partial Content) so
// <video>/<audio> playback/seeking in OBS doesn't require downloading the
// whole file up front — none of the other overlays need this since their
// images are small and never streamed.
router.get("/overlay/custom/asset/:assetId", (req, res) => {
  const user = (req.query.token && findUserByOverlayToken(req.query.token)) || getApprovedUserFromCookieHeader(req.headers.cookie);
  if (!user) return res.status(401).json({ error: "Not authorized" });
  const asset = overlayAssets.getAsset(user.twitchId, req.params.assetId);
  if (!asset) return res.status(404).end();
  res.set("Cache-Control", "no-store");

  if (asset.kind !== "video" && asset.kind !== "audio") {
    res.set("Content-Type", asset.mime);
    return res.sendFile(asset.filePath);
  }

  const stat = fs.statSync(asset.filePath);
  const range = req.headers.range;
  if (!range) {
    res.set({ "Content-Type": asset.mime, "Content-Length": stat.size, "Accept-Ranges": "bytes" });
    return fs.createReadStream(asset.filePath).pipe(res);
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) return res.status(416).set("Content-Range", `bytes */${stat.size}`).end();
  const start = match[1] ? parseInt(match[1], 10) : 0;
  const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
  if (start >= stat.size || end >= stat.size || start > end) {
    return res.status(416).set("Content-Range", `bytes */${stat.size}`).end();
  }
  res.status(206).set({
    "Content-Type": asset.mime,
    "Content-Range": `bytes ${start}-${end}/${stat.size}`,
    "Content-Length": end - start + 1,
    "Accept-Ranges": "bytes",
  });
  fs.createReadStream(asset.filePath, { start, end }).pipe(res);
});

module.exports = router;
