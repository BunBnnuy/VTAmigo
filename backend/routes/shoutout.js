// The !so shoutout overlay and its config/test API.
//
//   • GET /overlay/shoutout          — the transparent OBS page (public, like
//                                      every other /overlay page: no cookie).
//   • GET/POST /shoutout/config      — per-account clip-selection + banner
//                                      settings, read by both the panel and
//                                      the overlay's initial fetch.
//   • GET /shoutout/state            — the currently-showing clip, so a
//                                      reloaded Browser Source resumes it.
//   • POST /shoutout/test            — panel button; triggers a shoutout
//                                      without posting to chat.
//
// Auth shape mirrors overlays.js/video.js and is NOT the blanket
// PROTECTED_PREFIXES gate: "/shoutout" is deliberately absent from that list
// because the overlay endpoints must answer an OBS token as well as a session
// cookie. Every route below either carries an explicit requireApprovedUser or
// does the inline (overlay ?token= OR session cookie) check.
const express = require("express");
const path = require("path");
const { requireApprovedUser, getApprovedUserFromCookieHeader, getOverlayToken, findUserByOverlayToken } = require("../auth");
const shoutout = require("../shoutout");
const { broadcastToAccount, handleShoutout } = require("../sessions");

const router = express.Router();

// GET /overlay/shoutout?token=... — transparent overlay page (OBS browser
// source).
router.get("/overlay/shoutout", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "overlay", "shoutout.html"));
});

// GET /shoutout/overlay-url — the logged-in user's own shoutout overlay URL,
// for the ShoutoutPanel to display with a copy button.
router.get("/shoutout/overlay-url", requireApprovedUser, (req, res) => {
  const token = getOverlayToken(req.user.twitchId);
  res.json({ url: `${req.protocol}://${req.get("host")}/overlay/shoutout?token=${token}` });
});

function resolveOverlayUser(req) {
  return (req.query.token && findUserByOverlayToken(req.query.token)) || getApprovedUserFromCookieHeader(req.headers.cookie);
}

// GET /shoutout/config?token=... — clip-selection mode + banner settings.
router.get("/shoutout/config", (req, res) => {
  const user = resolveOverlayUser(req);
  if (!user) return res.status(401).json({ error: "Not authorized" });
  // The font/shape allowlists travel with the config so the panel's pickers stay
  // in sync with what the backend will actually accept.
  res.json({
    config: shoutout.getConfig(user.twitchId),
    fonts: shoutout.FONTS,
    avatarShapes: shoutout.AVATAR_SHAPES,
  });
});

// POST /shoutout/config — the streamer editing their own panel. Persists and
// pushes to any open overlay so OBS updates without a reload.
router.post("/shoutout/config", requireApprovedUser, (req, res) => {
  const config = shoutout.setConfig(req.user.twitchId, req.body || {});
  broadcastToAccount(req.user.twitchId, { type: "shoutout_config", config });
  res.json({ config });
});

// GET /shoutout/state?token=... — the clip currently on screen, or null. Lets
// the overlay resume mid-clip after OBS reloads it.
router.get("/shoutout/state", (req, res) => {
  const user = resolveOverlayUser(req);
  if (!user) return res.status(401).json({ error: "Not authorized" });
  res.json({ shoutout: shoutout.getActive(user.twitchId) });
});

// POST /shoutout/test — { username? } — fires a shoutout at the overlay
// without posting to chat. Defaults to the streamer's own channel so the
// button works with an empty box.
router.post("/shoutout/test", requireApprovedUser, async (req, res) => {
  const username = (req.body && req.body.username) || req.user.login;
  try {
    const result = await handleShoutout(req.user.twitchId, req.user.login, username, { announce: false });
    res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error("[shoutout/test]", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
