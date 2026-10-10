// The Mixer panel: one gain per sound source. The streamer route persists the
// values (inside the same user_settings blob as the rest of Settings) and
// broadcasts them to every one of the account's OBS overlays; the OBS-facing
// state route lets a freshly-loaded overlay pick up the current gains.
//
// "/mixer" is NOT a PROTECTED_PREFIXES entry, so the streamer route carries an
// explicit requireApprovedUser and the overlay route does its own token-or-
// cookie check — the same split as routes/settings.js. Keep it that way.
const express = require("express");
const { requireApprovedUser, getApprovedUserFromCookieHeader, findUserByOverlayToken } = require("../auth");
const mixer = require("../mixer");
const { broadcastToAccount } = require("../sessions");

const router = express.Router();

// POST /mixer — { ...channels } or { mixer: { ...channels } } — saves and
// broadcasts the new gains to this account's overlays.
router.post("/mixer", requireApprovedUser, (req, res) => {
  const saved = mixer.setMixer(req.user.twitchId, req.body?.mixer ?? req.body);
  broadcastToAccount(req.user.twitchId, { type: "mixer_state", mixer: saved });
  res.json({ mixer: saved });
});

// GET /mixer/state?token=... — current gains for an OBS overlay page. Token OR
// session cookie, since OBS's Browser Source has no access to the cookie.
router.get("/mixer/state", (req, res) => {
  const user = (req.query.token && findUserByOverlayToken(req.query.token)) || getApprovedUserFromCookieHeader(req.headers.cookie);
  if (!user) return res.status(401).json({ error: "Not authorized" });
  res.json({ mixer: mixer.getMixer(user.twitchId) });
});

module.exports = router;
