// Viewer XP / ranking: the leaderboard the OBS overlay renders, its config
// knobs, and the test-message hook that previews the level-up animation.
//
// Auth here is deliberately mixed, matching what was in app.js:
//
//   • /xp/ranking is EXCLUDED from the blanket PROTECTED_PREFIXES gate (OBS's
//     Browser Source has no session cookie) and does its own inline check —
//     overlay ?token= OR session cookie. Keep that exclusion in sync with the
//     list in app.js if this route ever moves.
//   • /overlay/xp is a static page under "/overlay", which is not a protected
//     prefix at all — it carries no account data on its own.
//   • /xp/overlay-url, /xp/config, /xp/reset and /xp/test all sit under the
//     "/xp" prefix, so req.user is already populated by the gate in app.js,
//     which is registered before this router is mounted.
const express = require("express");
const path = require("path");
const { getApprovedUserFromCookieHeader, getOverlayToken, findUserByOverlayToken } = require("../auth");
const xp = require("../xp");
const { broadcastToAccount } = require("../sessions");

const router = express.Router();

// GET /xp/ranking?limit=10 — top users by XP for one account. Reachable
// either as a logged-in browser (session cookie) or as the OBS overlay
// (?token=... — see getOverlayToken), since this is deliberately excluded
// from the blanket requireApprovedUser gate in app.js.
router.get("/xp/ranking", (req, res) => {
  const user = (req.query.token && findUserByOverlayToken(req.query.token)) || getApprovedUserFromCookieHeader(req.headers.cookie);
  if (!user) return res.status(401).json({ error: "Not authorized" });
  res.json({ ranking: xp.getRanking(user.twitchId, Number(req.query.limit) || 10) });
});

// GET /overlay/xp?token=... — transparent overlay page (add as OBS browser
// source). The page itself is static and carries no account data; the token
// in its query string is what scopes the ranking fetch + WS feed to one account.
router.get("/overlay/xp", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "overlay", "xp.html"));
});

// GET /xp/overlay-url — the logged-in user's own OBS overlay URL, for Settings
// to display with a copy button.
router.get("/xp/overlay-url", (req, res) => {
  const token = getOverlayToken(req.user.twitchId);
  res.json({ url: `${req.protocol}://${req.get("host")}/overlay/xp?token=${token}` });
});

// POST /xp/config — { ignoredUsers: "name1, name2" | [] } — users that earn no XP
router.post("/xp/config", (req, res) => {
  const { ignoredUsers } = req.body || {};
  if (ignoredUsers != null) xp.setIgnored(req.user.twitchId, ignoredUsers);
  res.json({ ok: true });
});

// POST /xp/reset — wipe this account's XP data
router.post("/xp/reset", (req, res) => {
  xp.reset(req.user.twitchId);
  res.json({ ok: true });
});

// POST /xp/test — simulate a chat message to preview the overlay animation
router.post("/xp/test", (req, res) => {
  const { username, text, color } = req.body || {};
  const ev = xp.addMessage(req.user.twitchId, username || "TestUser", text || "hola mundo, este es un mensaje de prueba!", color || "#9147ff");
  if (!ev) return res.json({ ok: true, ignored: true });
  broadcastToAccount(req.user.twitchId, { type: "xp", ...ev });
  res.json({ ok: true, ...ev });
});

module.exports = router;
