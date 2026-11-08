// Watch-streak alert: a small OBS overlay showing a viewer's profile picture,
// name and consecutive-stream count, plus its alert sound and the panel's test
// hook.
//
//   • GET    /overlay/streak       — the transparent OBS page (public, like
//                                    every other /overlay page: no cookie).
//   • GET    /streak/overlay-url   — the logged-in user's own OBS URL, for the
//                                    Streak panel's copy button.
//   • POST   /streak/test          — fires the alert without waiting for a real
//                                    milestone. Broadcast under "streak_test" so
//                                    the test never lands in the activity feed,
//                                    the chat feed, or the AI's event trigger.
//   • GET    /streak/audio/status  — { hasAudio, name, sizeBytes, mime,
//                                    updatedAt } for the panel and the overlay.
//   • GET    /streak/audio         — the uploaded clip. Token (OBS) or session
//                                    cookie (panel preview).
//   • POST   /streak/audio         — multipart upload (field "audio"), replaces
//                                    the account's previous clip.
//   • DELETE /streak/audio         — removes it.
//
// Real events are not produced here: they arrive as IRC USERNOTICEs and are
// normalized in sessions.js (handleUserNotice, see ../streaks.js).
//
// Auth shape mirrors routes/shoutout.js and is NOT the blanket
// PROTECTED_PREFIXES gate: "/streak" is deliberately absent from that list.
// The streamer mutations carry an explicit requireApprovedUser; the two
// OBS-facing reads (status, binary) accept an overlay token OR a session
// cookie, since OBS's Browser Source has no cookie.
const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const {
  requireApprovedUser,
  getOverlayToken,
  getValidTwitchToken,
  getApprovedUserFromCookieHeader,
  findUserByOverlayToken,
} = require("../auth");
const viewerAvatars = require("../viewerAvatars");
const streakAudio = require("../streakAudio");
const { broadcastToAccount } = require("../sessions");

const router = express.Router();

// A test number beyond this is nonsense on screen and would just widen the
// card; the real events are capped the same way in streaks.js.
const MAX_TEST_STREAK = 999;
const TEST_USERNAME_RE = /^[a-zA-Z0-9_]{1,25}$/;

const streakAudioUpload = multer({
  dest: streakAudio.TMP_DIR,
  limits: { fileSize: streakAudio.MAX_BYTES },
});

function resolveOverlayUser(req) {
  return (req.query.token && findUserByOverlayToken(req.query.token)) || getApprovedUserFromCookieHeader(req.headers.cookie);
}

// GET /overlay/streak?token=... — transparent overlay page (OBS browser
// source).
router.get("/overlay/streak", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "overlay", "streak.html"));
});

// GET /streak/overlay-url — the logged-in user's own watch-streak overlay URL.
// The token is returned separately too: the panel needs it to preview the
// alert sound without relying on cross-origin cookies in `vite dev`.
router.get("/streak/overlay-url", requireApprovedUser, (req, res) => {
  const token = getOverlayToken(req.user.twitchId);
  res.json({ url: `${req.protocol}://${req.get("host")}/overlay/streak?token=${token}`, token });
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

// ── Alert sound ────────────────────────────────────────────────────────────

// GET /streak/audio/status?token=... — metadata only, so the overlay can avoid
// requesting a 404 on every load and the panel can show the current filename.
router.get("/streak/audio/status", (req, res) => {
  const user = resolveOverlayUser(req);
  if (!user) return res.status(401).json({ error: "Not authorized" });
  res.json(streakAudio.getStatus(user.twitchId));
});

// GET /streak/audio?token=... — the clip itself. res.sendFile() keeps Range
// support, so <audio> can seek/restart without re-downloading the whole file.
router.get("/streak/audio", (req, res) => {
  const user = resolveOverlayUser(req);
  if (!user) return res.status(401).json({ error: "Not authorized" });
  const audio = streakAudio.getAudio(user.twitchId);
  if (!audio) return res.status(404).end();
  res.set("Content-Type", audio.mime);
  res.set("Cache-Control", "no-store");
  res.sendFile(audio.filePath);
});

// POST /streak/audio — multipart upload (field name "audio"). The new clip
// replaces the previous one and every open overlay is told to reload it.
router.post("/streak/audio", requireApprovedUser, (req, res) => {
  streakAudioUpload.single("audio")(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: `Audio must be under ${streakAudio.MAX_BYTES / (1024 * 1024)}MB` });
      }
      console.error("[streak/audio]", err.message);
      return res.status(400).json({ error: "Upload failed" });
    }
    if (!req.file) return res.status(400).json({ error: "audio file is required" });

    try {
      const status = streakAudio.saveAudio(
        req.user.twitchId,
        req.file.path,
        req.file.mimetype,
        req.file.size,
        req.file.originalname
      );
      broadcastToAccount(req.user.twitchId, { type: "streak_audio_updated", ...status });
      res.json({ ok: true, ...status });
    } catch (saveErr) {
      // saveAudio unlinks the temp file for the expected failures; a failed
      // rename would leave it behind otherwise.
      try { fs.unlinkSync(req.file.path); } catch {}
      if (saveErr.message === "UNSUPPORTED_TYPE") {
        return res.status(400).json({ error: "Audio must be MP3, M4A/AAC, WAV, OGG, or WebM" });
      }
      if (saveErr.message === "TOO_LARGE") {
        return res.status(413).json({ error: `Audio must be under ${streakAudio.MAX_BYTES / (1024 * 1024)}MB` });
      }
      console.error("[streak/audio]", saveErr.message);
      res.status(500).json({ error: saveErr.message });
    }
  });
});

// DELETE /streak/audio — remove the account's clip.
router.delete("/streak/audio", requireApprovedUser, (req, res) => {
  const status = streakAudio.deleteAudio(req.user.twitchId);
  broadcastToAccount(req.user.twitchId, { type: "streak_audio_updated", ...status });
  res.json({ ok: true, ...status });
});

module.exports = router;
