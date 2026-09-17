// Routes for avatar state that is not tied to the bot TTS player.
const express = require("express");
const path = require("path");
const { requireApprovedUser, getApprovedUserFromCookieHeader, getOverlayToken, findUserByOverlayToken } = require("../auth");
const { broadcastToAccount } = require("../sessions");
const reactiveAvatarOverlay = require("../reactiveAvatarOverlay");

const router = express.Router();

router.get("/overlay/avatar-reactive", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "overlay", "avatar-reactive.html"));
});

router.get("/overlay/avatar-reactive/image", (req, res) => {
  const user = (req.query.token && findUserByOverlayToken(req.query.token)) || getApprovedUserFromCookieHeader(req.headers.cookie);
  if (!user) return res.status(401).json({ error: "Not authorized" });
  const image = reactiveAvatarOverlay.getImage(user.twitchId, req.query.slot);
  if (!image) return res.status(404).end();
  res.set("Content-Type", image.mime);
  res.set("Cache-Control", "no-store");
  res.sendFile(image.filePath);
});

router.get("/avatar/reactive/overlay-url", requireApprovedUser, (req, res) => {
  const token = getOverlayToken(req.user.twitchId);
  res.json({
    url: `${req.protocol}://${req.get("host")}/overlay/avatar-reactive?token=${token}`,
    token,
    ...reactiveAvatarOverlay.getStatus(req.user.twitchId),
  });
});

router.post("/avatar/reactive/upload", requireApprovedUser, (req, res) => {
  const { slot, dataUrl } = req.body || {};
  try {
    reactiveAvatarOverlay.saveImage(req.user.twitchId, slot, dataUrl);
    res.json({ ok: true, ...reactiveAvatarOverlay.getStatus(req.user.twitchId) });
  } catch (err) {
    if (err.message === "BAD_SLOT") return res.status(400).json({ error: "slot must be 'speaking' or 'silent'" });
    if (err.message === "BAD_DATA_URL") return res.status(400).json({ error: "dataUrl is required" });
    if (err.message === "UNSUPPORTED_TYPE") return res.status(400).json({ error: "Image must be JPEG, PNG, GIF, or WebP" });
    if (err.message === "TOO_LARGE") return res.status(413).json({ error: `Image must be under ${reactiveAvatarOverlay.MAX_BYTES / (1024 * 1024)}MB` });
    console.error("[avatar/reactive/upload]", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/avatar/reactive/start", (req, res) => {
  broadcastToAccount(req.user.twitchId, { type: "reactive_avatar_state", speaking: true });
  res.json({ ok: true });
});

router.post("/avatar/reactive/stop", (req, res) => {
  broadcastToAccount(req.user.twitchId, { type: "reactive_avatar_state", speaking: false });
  res.json({ ok: true });
});

module.exports = router;
