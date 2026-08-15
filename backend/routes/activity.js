// Activity Panel history: the last N Twitch events (follows, subs, raids,
// cheers, redeems) recorded for the logged-in account.
//
// Live events arrive over the /chat WebSocket (see ../sessions.js); this is
// only the initial snapshot a page load/reconnect needs so the panel isn't
// blank until the next event happens.
//
// "/activity" is a PROTECTED_PREFIXES entry, so req.user is already populated
// by the blanket gate in app.js, which is registered before this router is
// mounted.
const express = require("express");
const activity = require("../activity");

const router = express.Router();

// GET /activity/recent — last 30 Twitch activity events (follows, subs,
// raids, cheers, redeems) for the logged-in account, so the Activity Panel
// has something to show right after a page load/reconnect instead of
// waiting for new live events.
router.get("/activity/recent", (req, res) => {
  res.json({ events: activity.getRecent(req.user.twitchId, 30) });
});

module.exports = router;
