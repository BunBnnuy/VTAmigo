// The YouTube song-request queue (!sr) and the OBS overlay that plays it.
//
// The !sr chat-command half lives in ../sessions.js next to the IRC client
// that receives it; this router is the site-side control surface (add,
// remove, skip, default playlist, play/pause) plus the two OBS-facing routes.
//
// Auth is mixed, matching what was in app.js:
//
//   • /video/state and /video/ended are EXCLUDED from the blanket
//     PROTECTED_PREFIXES gate — the overlay polls/reports on them and OBS's
//     Browser Source has no session cookie — so they do their own inline
//     check (overlay ?token= OR session cookie). Keep those exclusions in
//     sync with the list in app.js if these routes ever move.
//   • /overlay/video is a static page under "/overlay", not a protected
//     prefix at all; it carries no account data on its own.
//   • every other "/video/..." route sits under the protected "/video"
//     prefix, so req.user is populated by the gate in app.js — the explicit
//     requireApprovedUser on them is belt-and-braces that was already there.
const express = require("express");
const path = require("path");
const { requireApprovedUser, getApprovedUserFromCookieHeader, getOverlayToken, findUserByOverlayToken } = require("../auth");
const videoQueue = require("../videoQueue");
const youtube = require("../youtube");
const { broadcastVideoState } = require("../sessions");

const router = express.Router();

// GET /overlay/video?token=... — transparent overlay page (OBS browser
// source), public like /overlay/xp and /overlay/avatar since OBS can't send
// the session cookie.
router.get("/overlay/video", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "overlay", "video.html"));
});

// GET /video/overlay-url — the logged-in user's own video overlay URL, for
// the site's VideoQueue panel to display with a copy button.
router.get("/video/overlay-url", requireApprovedUser, (req, res) => {
  const token = getOverlayToken(req.user.twitchId);
  res.json({ url: `${req.protocol}://${req.get("host")}/overlay/video?token=${token}` });
});

// POST /video/settings — { viewerRequestsEnabled?, skipDefaultOnRequest? } —
// the two site toggles gating !sr chat requests (never the streamer's own
// site controls, which always work regardless of these).
router.post("/video/settings", requireApprovedUser, (req, res) => {
  const { viewerRequestsEnabled, skipDefaultOnRequest } = req.body || {};
  videoQueue.setSettings(req.user.twitchId, { viewerRequestsEnabled, skipDefaultOnRequest });
  broadcastVideoState(req.user.twitchId);
  res.json({ ok: true });
});

// GET /video/state?token=... — current queue/nowPlaying. Reachable via
// overlay token (OBS) or session cookie (site), same pattern as /xp/ranking.
// If everything is idle (no queue, nothing playing) but a default playlist is
// configured, this kicks off playback immediately — so loading the overlay
// or the site never just sits blank when a default playlist is set.
router.get("/video/state", async (req, res) => {
  const user = (req.query.token && findUserByOverlayToken(req.query.token)) || getApprovedUserFromCookieHeader(req.headers.cookie);
  if (!user) return res.status(401).json({ error: "Not authorized" });
  let state = videoQueue.getState(user.twitchId);
  if (!state.nowPlaying && state.queue.length === 0 && state.defaultPlaylistId) {
    state = await videoQueue.advance(user.twitchId, { refreshDefaultPlaylist: youtube.fetchPlaylistItems });
    broadcastVideoState(user.twitchId);
  }
  res.json(state);
});

// POST /video/queue — { input: url | video id | free-text title } — resolves
// via youtube.resolveInput and enqueues; auto-starts playback if idle.
router.post("/video/queue", requireApprovedUser, async (req, res) => {
  const { input } = req.body || {};
  if (!input) return res.status(400).json({ error: "input is required" });
  try {
    const resolved = await youtube.resolveInput(input);
    const wasIdle = !videoQueue.getState(req.user.twitchId).nowPlaying;
    videoQueue.enqueue(req.user.twitchId, { ...resolved, requestedBy: req.user.login });
    if (wasIdle) await videoQueue.advance(req.user.twitchId, { refreshDefaultPlaylist: youtube.fetchPlaylistItems });
    broadcastVideoState(req.user.twitchId);
    res.json({ ok: true, item: resolved });
  } catch (err) {
    if (err.message === "YOUTUBE_API_KEY_MISSING") {
      return res.status(503).json({ error: "Song search requires YOUTUBE_API_KEY in the backend environment — paste a link instead" });
    }
    console.error("[video/queue]", err.message);
    res.status(400).json({ error: "Couldn't resolve that song" });
  }
});

// DELETE /video/queue/:id — remove one queued item
router.delete("/video/queue/:id", requireApprovedUser, (req, res) => {
  videoQueue.removeFromQueue(req.user.twitchId, req.params.id);
  broadcastVideoState(req.user.twitchId);
  res.json({ ok: true });
});

// POST /video/default-playlist — { input: playlist url | id } — resolves and
// caches the playlist that plays on loop whenever the request queue is empty.
router.post("/video/default-playlist", requireApprovedUser, async (req, res) => {
  const { input } = req.body || {};
  const playlistId = youtube.extractPlaylistId(input || "");
  if (!playlistId) return res.status(400).json({ error: "Couldn't find a playlist ID in that input" });
  try {
    const [items, title] = await Promise.all([
      youtube.fetchPlaylistItems(playlistId),
      youtube.fetchPlaylistTitle(playlistId).catch(() => null), // cosmetic only — don't fail the save over it
    ]);
    videoQueue.setDefaultPlaylist(req.user.twitchId, playlistId, items, title);
    broadcastVideoState(req.user.twitchId);
    res.json({ ok: true, count: items.length });
  } catch (err) {
    if (err.message === "YOUTUBE_API_KEY_MISSING") {
      return res.status(503).json({ error: "Default playlist requires YOUTUBE_API_KEY in the backend environment" });
    }
    console.error("[video/default-playlist]", err.message);
    res.status(400).json({ error: "Couldn't load that playlist" });
  }
});

// POST /video/skip — force-advance to the next queued/default-playlist item
router.post("/video/skip", requireApprovedUser, async (req, res) => {
  await videoQueue.advance(req.user.twitchId, { refreshDefaultPlaylist: youtube.fetchPlaylistItems });
  broadcastVideoState(req.user.twitchId);
  res.json({ ok: true });
});

// POST /video/previous — go back to the last history entry, putting whatever
// is currently playing back at the front of the queue
router.post("/video/previous", requireApprovedUser, (req, res) => {
  videoQueue.previous(req.user.twitchId);
  broadcastVideoState(req.user.twitchId);
  res.json({ ok: true });
});

// POST /video/control — { action: "play" | "pause" } — the overlay applies
// this to the current video without reloading it (see backend/overlay/video.html)
router.post("/video/control", requireApprovedUser, (req, res) => {
  const { action } = req.body || {};
  if (action !== "play" && action !== "pause") return res.status(400).json({ error: "action must be 'play' or 'pause'" });
  videoQueue.setPaused(req.user.twitchId, action === "pause");
  broadcastVideoState(req.user.twitchId);
  res.json({ ok: true });
});

// POST /video/ended?token=... — { videoId } — the overlay reports playback
// finished. videoId is checked against the current nowPlaying so a stale or
// duplicate report (e.g. a slow network retry) can't double-advance the queue.
router.post("/video/ended", async (req, res) => {
  const user = (req.query.token && findUserByOverlayToken(req.query.token)) || getApprovedUserFromCookieHeader(req.headers.cookie);
  if (!user) return res.status(401).json({ error: "Not authorized" });
  const { videoId } = req.body || {};
  const current = videoQueue.getState(user.twitchId).nowPlaying;
  if (current && current.videoId === videoId) {
    await videoQueue.advance(user.twitchId, { refreshDefaultPlaylist: youtube.fetchPlaylistItems });
    broadcastVideoState(user.twitchId);
  }
  res.json({ ok: true });
});

module.exports = router;
