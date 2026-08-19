// Twitch channel title/category — the Stream Settings panel's read and write
// path, proxied through Helix with the streamer's own OAuth token.
//
// "/stream" is NOT a PROTECTED_PREFIXES entry, so these routes carry an
// explicit requireApprovedUser each. Keep it that way: dropping the
// middleware here would leave them open, since nothing else gates them.
const express = require("express");
const { requireApprovedUser, getValidTwitchToken } = require("../auth");
const streamSettings = require("../streamSettings");

const router = express.Router();

// Shared error mapping for the /stream/* routes below — gives the frontend a
// stable string to switch on instead of parsing HTTP status alone (403 could
// mean other things elsewhere in this app).
function handleStreamSettingsError(err, res) {
  if (err.code === "MISSING_SCOPE") return res.status(403).json({ error: "MISSING_SCOPE" });
  if (err.message === "NO_TWITCH_TOKEN") return res.status(401).json({ error: "NO_TWITCH_TOKEN" });
  console.error("[stream-settings]", err.message);
  return res.status(502).json({ error: "TWITCH_API_ERROR" });
}

// GET /stream/categories?query=... — Twitch category search for the Stream
// Settings panel's autocomplete, including box art thumbnails.
router.get("/stream/categories", requireApprovedUser, async (req, res) => {
  const query = (req.query.query || "").trim();
  if (!query) return res.json({ categories: [] });
  try {
    const token = await getValidTwitchToken(req.user.twitchId);
    const categories = await streamSettings.searchCategories(token, query);
    res.json({ categories });
  } catch (err) {
    handleStreamSettingsError(err, res);
  }
});

// GET /stream/info — the logged-in streamer's current live title/category,
// fetched fresh each time rather than cached (it can change from outside
// this panel, e.g. directly on Twitch).
router.get("/stream/info", requireApprovedUser, async (req, res) => {
  try {
    const token = await getValidTwitchToken(req.user.twitchId);
    const info = await streamSettings.getChannelInfo(token, req.user.twitchId);
    res.json(info);
  } catch (err) {
    handleStreamSettingsError(err, res);
  }
});

// GET /stream/followers — { live, total }. Checks Helix /streams first and
// only hits /channels/followers when the broadcaster is currently live
// (the header counter polls this every 10 minutes).
router.get("/stream/followers", requireApprovedUser, async (req, res) => {
  try {
    const token = await getValidTwitchToken(req.user.twitchId);
    const info = await streamSettings.getFollowersIfLive(token, req.user.twitchId);
    res.json(info);
  } catch (err) {
    handleStreamSettingsError(err, res);
  }
});

// POST /stream/settings — { title?, gameId? }; updates whichever of
// title/category was provided, leaving the other unchanged on Twitch.
router.post("/stream/settings", requireApprovedUser, async (req, res) => {
  try {
    const token = await getValidTwitchToken(req.user.twitchId);
    await streamSettings.updateChannelInfo(token, req.user.twitchId, req.body || {});
    res.json({ ok: true });
  } catch (err) {
    handleStreamSettingsError(err, res);
  }
});

module.exports = router;
