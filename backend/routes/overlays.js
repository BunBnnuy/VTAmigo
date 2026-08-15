// The two "simple" OBS overlays and their config APIs:
//
//   • the avatar-swap overlay (/overlay/avatar*) — two uploaded images
//     swapped by the tts_state broadcast from routes/tts.js
//   • the chat overlay (/overlay/chat + /chat-overlay/*) — appearance config,
//     nine-slice background upload, and the fake test messages/events used to
//     preview it without waiting for real chat activity
//
// Note the auth shape here, which is NOT the blanket PROTECTED_PREFIXES gate:
// "/overlay" and "/chat-overlay" are deliberately absent from that list
// because OBS's Browser Source has no session cookie. The OBS-facing routes
// do their own inline check (overlay ?token= OR session cookie) and the
// streamer-facing ones carry an explicit requireApprovedUser. Keep both as
// they are — dropping the explicit middleware would leave those routes open.
const express = require("express");
const path = require("path");
const { requireApprovedUser, getApprovedUserFromCookieHeader, getOverlayToken, findUserByOverlayToken } = require("../auth");
const emotes = require("../emotes");
const avatarOverlay = require("../avatarOverlay");
const chatOverlayConfig = require("../chatOverlayConfig");
const chatOverlayBg = require("../chatOverlayBg");
const { broadcastToAccount } = require("../sessions");

const router = express.Router();

// ── Avatar-swap overlay ──────────────────────────────────────────────────────
// Shows one of two user-uploaded images (speaking/silent) depending on
// whether TTS audio is currently playing, driven over the same /chat WS the
// XP overlay uses ({ type: "tts_state", playing }), broadcast from the
// /avatar/speaking/start and /avatar/speaking/stop handlers (routes/tts.js).

// GET /overlay/avatar?token=... — transparent overlay page (OBS browser
// source), public like /overlay/xp since OBS can't send the session cookie.
router.get("/overlay/avatar", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "overlay", "avatar.html"));
});

// GET /overlay/avatar/image?slot=speaking|silent&token=... — serves the
// uploaded image binary. Reachable via overlay token (OBS) or session
// cookie (Settings preview), same pattern as /xp/ranking.
router.get("/overlay/avatar/image", (req, res) => {
  const user = (req.query.token && findUserByOverlayToken(req.query.token)) || getApprovedUserFromCookieHeader(req.headers.cookie);
  if (!user) return res.status(401).json({ error: "Not authorized" });
  const image = avatarOverlay.getImage(user.twitchId, req.query.slot);
  if (!image) return res.status(404).end();
  res.set("Content-Type", image.mime);
  res.set("Cache-Control", "no-store"); // always reflect the latest upload
  res.sendFile(image.filePath);
});

// GET /overlay/avatar/overlay-url — the logged-in user's own avatar overlay
// URL + upload status, for Settings to display (copy button + previews).
router.get("/overlay/avatar/overlay-url", requireApprovedUser, (req, res) => {
  const token = getOverlayToken(req.user.twitchId);
  res.json({
    url: `${req.protocol}://${req.get("host")}/overlay/avatar?token=${token}`,
    token,
    ...avatarOverlay.getStatus(req.user.twitchId),
  });
});

// POST /overlay/avatar/upload — { slot: "speaking"|"silent", dataUrl } —
// dataUrl is a base64 data: URL as produced by FileReader.readAsDataURL,
// mirroring how Settings already reads the settings-export .json file.
router.post("/overlay/avatar/upload", requireApprovedUser, (req, res) => {
  const { slot, dataUrl } = req.body || {};
  try {
    avatarOverlay.saveImage(req.user.twitchId, slot, dataUrl);
    res.json({ ok: true, ...avatarOverlay.getStatus(req.user.twitchId) });
  } catch (err) {
    if (err.message === "BAD_SLOT") return res.status(400).json({ error: "slot must be 'speaking' or 'silent'" });
    if (err.message === "BAD_DATA_URL") return res.status(400).json({ error: "dataUrl is required" });
    if (err.message === "UNSUPPORTED_TYPE") return res.status(400).json({ error: "Image must be JPEG, PNG, GIF, or WebP" });
    if (err.message === "TOO_LARGE") return res.status(413).json({ error: `Image must be under ${avatarOverlay.MAX_BYTES / (1024 * 1024)}MB` });
    console.error("[overlay/avatar/upload]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Chat overlay (messages + Twitch events: follows, subs, raids, cheers) ────
// Purely a display layer over the same /chat WS other overlays use — no new
// data/config storage, all appearance/behavior knobs (colors, size, which
// events to show, banner vs inline, etc.) are read from its own URL query
// string client-side (see backend/overlay/chat.html).

// GET /overlay/chat?token=... — transparent overlay page (OBS browser
// source), public like /overlay/xp and /overlay/video since OBS can't send
// the session cookie.
router.get("/overlay/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "overlay", "chat.html"));
});

// GET /chat-overlay/overlay-url — the logged-in user's own chat overlay URL,
// for Settings to display with a copy button.
router.get("/chat-overlay/overlay-url", requireApprovedUser, (req, res) => {
  const token = getOverlayToken(req.user.twitchId);
  res.json({ url: `${req.protocol}://${req.get("host")}/overlay/chat?token=${token}` });
});

// GET /chat-overlay/config?token=... — current appearance/behavior config.
// Reachable either as a logged-in browser (session cookie, used by the
// ChatOverlayPanel side panel) or as the OBS overlay itself (?token=...),
// same dual-auth pattern as /xp/ranking.
router.get("/chat-overlay/config", (req, res) => {
  const user = (req.query.token && findUserByOverlayToken(req.query.token)) || getApprovedUserFromCookieHeader(req.headers.cookie);
  if (!user) return res.status(401).json({ error: "Not authorized" });
  const config = chatOverlayConfig.getConfig(user.twitchId);
  res.json({ config: { ...config, hasBgImage: chatOverlayBg.hasImage(user.twitchId) } });
});

// POST /chat-overlay/config — logged-in only (the streamer editing their own
// panel). Persists the change and immediately pushes it to any connected
// overlay over the /chat WS, so OBS updates live without a browser-source
// reload.
router.post("/chat-overlay/config", requireApprovedUser, (req, res) => {
  const config = chatOverlayConfig.setConfig(req.user.twitchId, req.body || {});
  const fullConfig = { ...config, hasBgImage: chatOverlayBg.hasImage(req.user.twitchId) };
  broadcastToAccount(req.user.twitchId, { type: "chat_overlay_config", config: fullConfig });
  res.json({ config: fullConfig });
});

// GET /chat-overlay/bg-image?token=... — serves the uploaded nine-slice
// background texture. Same dual-auth pattern as /overlay/avatar/image.
router.get("/chat-overlay/bg-image", (req, res) => {
  const user = (req.query.token && findUserByOverlayToken(req.query.token)) || getApprovedUserFromCookieHeader(req.headers.cookie);
  if (!user) return res.status(401).json({ error: "Not authorized" });
  const image = chatOverlayBg.getImage(user.twitchId);
  if (!image) return res.status(404).end();
  res.set("Content-Type", image.mime);
  res.set("Cache-Control", "no-store"); // always reflect the latest upload
  res.sendFile(image.filePath);
});

// POST /chat-overlay/bg-image — { dataUrl } — uploads/replaces the
// background texture, then tells any open overlay to reload it live.
router.post("/chat-overlay/bg-image", requireApprovedUser, (req, res) => {
  const { dataUrl } = req.body || {};
  try {
    chatOverlayBg.saveImage(req.user.twitchId, dataUrl);
    broadcastToAccount(req.user.twitchId, { type: "chat_overlay_bg_updated", hasBgImage: true });
    res.json({ ok: true, hasBgImage: true });
  } catch (err) {
    if (err.message === "BAD_DATA_URL") return res.status(400).json({ error: "dataUrl is required" });
    if (err.message === "UNSUPPORTED_TYPE") return res.status(400).json({ error: "Image must be JPEG, PNG, GIF, or WebP" });
    if (err.message === "TOO_LARGE") return res.status(413).json({ error: `Image must be under ${chatOverlayBg.MAX_BYTES / (1024 * 1024)}MB` });
    console.error("[chat-overlay/bg-image]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /chat-overlay/bg-image — removes the background texture, falling
// back to the plain per-row background.
router.delete("/chat-overlay/bg-image", requireApprovedUser, (req, res) => {
  chatOverlayBg.deleteImage(req.user.twitchId);
  broadcastToAccount(req.user.twitchId, { type: "chat_overlay_bg_updated", hasBgImage: false });
  res.json({ ok: true, hasBgImage: false });
});

// ── Chat overlay test data ────────────────────────────────────────────────
// Lets the streamer preview their overlay settings (fonts, colors, banner,
// nine-slice, etc.) without waiting for real chat activity. Broadcast under
// dedicated WS types (chat_overlay_test_chat / chat_overlay_test_event)
// rather than the real "chat"/"twitch_event" types so this never touches XP,
// !sr parsing, or the AI's event-response trigger — the overlay is the only
// listener that recognizes these types (backend/overlay/chat.html); the main
// app's own WS handler silently ignores unknown types.
const TEST_USERNAMES = ["PixelPanda", "NightOwl99", "CoffeeCat", "ChatGremlin", "StreamSquid", "LurkMaster", "ClipQueen", "ByteBunny", "GG_Wizard", "MoonlitFox"];
const TEST_MESSAGES = [
  "PogChamp this is amazing!", "Can we get a hello?", "LUL that was great", "First time here, loving the stream!",
  "o7", "What game is this?", "Chat is going wild right now", "GGs", "This overlay looks awesome", "Kappa",
];
const TEST_REWARDS = ["Highlight My Message", "Hydrate!", "Sing a Song", "Play a Sound", "Pet the Cat"];
const TEST_COLORS = ["#ff4f4f", "#4fa8ff", "#4fff8f", "#ffd24f", "#c04fff", "#ff4fc0", "#4ffff0"];
// Badge tags in real IRC format so the test path exercises the same
// resolveBadges() code the live feed uses, including the per-theme icons.
const TEST_BADGE_TAGS = ["", "", "subscriber/12", "moderator/1", "vip/1", "broadcaster/1", "founder/0,subscriber/24"];

function randomOf(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Build a test message the same way a real one is built: enrich() resolves it
// against the live emote/badge caches, so a channel's own 7TV/BTTV emotes and
// real badge art show up in previews. The streamer's own twitchId doubles as
// the room id — a Twitch channel's room id IS the broadcaster's user id.
function buildTestMessage(twitchId, extra) {
  return emotes.enrich(
    {
      id: `test-${Date.now()}-${Math.random()}`,
      username: randomOf(TEST_USERNAMES),
      color: randomOf(TEST_COLORS),
      text: "",
      timestamp: Date.now(),
      isRedeem: false,
      isBot: false,
      isAction: false,
      roomId: twitchId,
      badgeTag: randomOf(TEST_BADGE_TAGS),
      emoteTag: "",
      emoteOnly: false,
      ...extra,
    },
    twitchId
  );
}

// POST /chat-overlay/test-message — broadcasts a fake plain chat message.
router.post("/chat-overlay/test-message", requireApprovedUser, (req, res) => {
  const msg = buildTestMessage(req.user.twitchId, { text: randomOf(TEST_MESSAGES) });
  broadcastToAccount(req.user.twitchId, { type: "chat_overlay_test_chat", msg });
  res.json({ ok: true });
});

// POST /chat-overlay/test-redeem — broadcasts a fake channel-point redemption.
router.post("/chat-overlay/test-redeem", requireApprovedUser, (req, res) => {
  const withMessage = Math.random() < 0.5;
  const msg = buildTestMessage(req.user.twitchId, {
    text: withMessage ? randomOf(TEST_MESSAGES) : "",
    isRedeem: true,
    rewardTitle: randomOf(TEST_REWARDS),
  });
  broadcastToAccount(req.user.twitchId, { type: "chat_overlay_test_chat", msg });
  res.json({ ok: true });
});

// POST /chat-overlay/test-event — broadcasts a fake follow/sub/raid/cheer/etc.
router.post("/chat-overlay/test-event", requireApprovedUser, (req, res) => {
  const kind = randomOf(["follow", "sub", "resub", "giftsub", "raid", "cheer"]);
  const username = randomOf(TEST_USERNAMES);
  let event = { kind, username };
  if (kind === "sub") {
    event = { ...event, tier: randomOf(["1000", "2000", "3000"]), isGift: Math.random() < 0.3 };
  } else if (kind === "resub") {
    event = {
      ...event,
      tier: randomOf(["1000", "2000", "3000"]),
      months: 1 + Math.floor(Math.random() * 24),
      streak: Math.random() < 0.5 ? 1 + Math.floor(Math.random() * 12) : null,
      message: Math.random() < 0.5 ? randomOf(TEST_MESSAGES) : "",
    };
  } else if (kind === "giftsub") {
    event = {
      ...event,
      tier: randomOf(["1000", "2000", "3000"]),
      count: 1 + Math.floor(Math.random() * 10),
      isAnonymous: Math.random() < 0.2,
    };
  } else if (kind === "raid") {
    event = { ...event, viewers: 1 + Math.floor(Math.random() * 500) };
  } else if (kind === "cheer") {
    event = {
      ...event,
      bits: randomOf([1, 100, 500, 1000, 5000]),
      message: Math.random() < 0.5 ? randomOf(TEST_MESSAGES) : "",
      isAnonymous: Math.random() < 0.1,
    };
  }
  broadcastToAccount(req.user.twitchId, { type: "chat_overlay_test_event", event });
  res.json({ ok: true, event });
});

module.exports = router;
