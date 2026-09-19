// The server-side copy of a user's client-side Settings.jsx localStorage blob.
//
// "/settings" is NOT a PROTECTED_PREFIXES entry, so both routes carry an
// explicit requireApprovedUser each. Keep it that way: dropping the
// middleware here would leave them open, since nothing else gates them.
const express = require("express");
const { requireApprovedUser } = require("../auth");
const userSettings = require("../userSettings");

const router = express.Router();

// GET /settings — the copy of this account's client-side Settings.jsx
// localStorage blob last synced to the server (see userSettings.js).
// Credential keys (botToken, botUsername, ...) are stripped before serving:
// stale rows written before the manual-token purge are scrubbed on read.
router.get("/settings", requireApprovedUser, (req, res) => {
  res.json({ settings: userSettings.getSettings(req.user.twitchId) });
});

// POST /settings — temporary sync shim: the frontend calls this once right
// after login with its current localStorage settings so the SQLite copy
// exists too. See userSettings.js for why this is meant to be removed later.
// Credential keys in the body are silently dropped, never stored — old
// clients still send their whole blob, token included.
router.post("/settings", requireApprovedUser, (req, res) => {
  try {
    userSettings.setSettings(req.user.twitchId, req.body || {});
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
