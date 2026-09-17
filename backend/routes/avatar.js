// Routes for avatar state that is not tied to the bot TTS player.
const express = require("express");
const { broadcastToAccount } = require("../sessions");

const router = express.Router();

router.post("/avatar/reactive/start", (req, res) => {
  broadcastToAccount(req.user.twitchId, { type: "reactive_avatar_state", speaking: true });
  res.json({ ok: true });
});

router.post("/avatar/reactive/stop", (req, res) => {
  broadcastToAccount(req.user.twitchId, { type: "reactive_avatar_state", speaking: false });
  res.json({ ok: true });
});

module.exports = router;
