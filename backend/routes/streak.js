// Watch-streak alert: a small OBS overlay showing a viewer's profile picture,
// name and consecutive-stream count, plus the panel's test hook.
//
//   • GET  /overlay/streak      — the transparent OBS page (public, like every
//                                 other /overlay page: no cookie).
//   • GET  /streak/overlay-url  — the logged-in user's own OBS URL, for the
//                                 Streak panel's copy button.
//   • POST /streak/test         — fires the alert without waiting for a real
//                                 milestone. Broadcast under "streak_test" so
//                                 the test never lands in the activity feed,
//                                 the chat feed, or the AI's event trigger.
//
// Real events are not produced here: they arrive as IRC USERNOTICEs and are
// normalized in sessions.js (handleUserNotice, see ../streaks.js).
//
// Auth shape mirrors routes/shoutout.js and is NOT the blanket
// PROTECTED_PREFIXES gate: "/streak" is deliberately absent from that list,
// and the streamer-facing routes carry an explicit requireApprovedUser.
const express = require("express");
const path = require("path");
const { requireApprovedUser, getOverlayToken, getValidTwitchToken } = require("../auth");
const viewerAvatars = require("../viewerAvatars");
const { broadcastToAccount } = require("../sessions");

const router = express.Router();

// A test number beyond this is nonsense on screen and would just widen the
// card; the real events are capped the same way in streaks.js.
const MAX_TEST_STREAK = 999;
const TEST_USERNAME_RE = /^[a-zA-Z0-9_]{1,25}$/;

// GET /overlay/streak?token=... — transparent overlay page (OBS browser
// source).
router.get("/overlay/streak", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "overlay", "streak.html"));
});

// GET /streak/overlay-url — the logged-in user's own watch-streak overlay URL.
router.get("/streak/overlay-url", requireApprovedUser, (req, res) => {
  const token = getOverlayToken(req.user.twitchId);
  res.json({ url: `${req.protocol}://${req.get("host")}/overlay/streak?token=${token}` });
});

// POST /streak/test — { username?, streak? } — previews the overlay on the
// streamer's own channel. Defaults to the streamer's display name and a
// streak of 5, the first "5+" milestone, so the button works with empty
// fields. A typed username previews that viewer: their own profile picture
// when Twitch knows them, the overlay's initial-letter fallback when it
// doesn't. Only an empty field falls back to the streamer's picture.
router.post("/streak/test", requireApprovedUser, async (req, res) => {
  const body = req.body || {};
  const requestedName = String(body.username || "").trim().replace(/^@/, "");
  const rawName = requestedName || req.user.displayName || req.user.login || "";
  if (!TEST_USERNAME_RE.test(rawName)) {
    return res.status(400).json({ ok: false, error: "BAD_USERNAME" });
  }

  const requested = Number(body.streak);
  const streak = Number.isFinite(requested) && requested >= 1
    ? Math.min(Math.floor(requested), MAX_TEST_STREAK)
    : 5;

  let avatarUrl = null;
  try {
    const token = await getValidTwitchToken(req.user.twitchId);
    avatarUrl = requestedName
      ? await viewerAvatars.getAvatarByLogin(requestedName, token, { fresh: true })
      : await viewerAvatars.getAvatar(req.user.twitchId, token, { fresh: true });
  } catch (err) {
    // The alert is still worth showing without a picture.
    console.warn("[streak/test] avatar lookup failed:", err.message);
  }

  const event = {
    id: `streak-test-${Date.now()}`,
    timestamp: Date.now(),
    kind: "streak",
    username: rawName,
    color: "#e11d76",
    streak,
    message: "",
    avatarUrl,
    isTest: true,
  };
  broadcastToAccount(req.user.twitchId, { type: "streak_test", event });
  res.json({ ok: true, event });
});

module.exports = router;
