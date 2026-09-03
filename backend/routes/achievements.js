// Streamer achievements + points-driven tier upgrades.
//
// Auth: every path here sits under the "/achievements" PROTECTED_PREFIXES
// entry, so the blanket requireApprovedUser gate in app.js has already
// populated req.user by the time these handlers run.
//
// GET answers the AchievementsPanel's state; both verbs run a lazy
// check-and-unlock first so accounts that earned milestones before this
// feature shipped (or while the WS was disconnected) catch up without a
// dedicated migration. Newly-earned unlocks are broadcast over the /chat WS
// (achievement_unlocked / tier_upgraded) — the frontend toasts from those,
// not from the HTTP body, so concurrent tabs don't double-toast.
const express = require("express");
const achievements = require("../achievements");
const { broadcastToAccount } = require("../sessions");

const router = express.Router();

function settle(twitchId, ctx = {}) {
  const result = achievements.checkAndUnlock(twitchId, ctx);
  let upgradedTier = null;
  if (!result.throttled && result.newlyUnlocked.length > 0) {
    upgradedTier = achievements.maybeUpgradeTier(twitchId, result.earnedTier);
    broadcastToAccount(twitchId, {
      type: "achievement_unlocked",
      achievements: result.newlyUnlocked,
      totalPoints: result.totalPoints,
      earnedTier: result.earnedTier,
    });
    if (upgradedTier) {
      broadcastToAccount(twitchId, {
        type: "tier_upgraded",
        newTier: upgradedTier,
        totalPoints: result.totalPoints,
      });
    }
  }
  return { result, upgradedTier };
}

// GET /achievements/state — full panel payload.
router.get("/achievements/state", (req, res) => {
  settle(req.user.twitchId);
  res.json(achievements.getState(req.user.twitchId));
});

// POST /achievements/check — explicit re-check (e.g. after a setup action the
// backend can't hook without a require cycle, like bot-account linking in
// auth.js). Same settle-and-return-state semantics as the GET.
router.post("/achievements/check", (req, res) => {
  const { upgradedTier } = settle(req.user.twitchId);
  res.json({ ...achievements.getState(req.user.twitchId), tier: upgradedTier || undefined });
});

module.exports = router;
