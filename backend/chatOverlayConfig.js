// Per-account appearance/behavior settings for the chat overlay
// (backend/overlay/chat.html), stored in the chat_overlay_config SQLite
// table (see db.js), keyed by twitchId — previously a flat JSON file in the
// same style as users.json. Edited live from the frontend's
// ChatOverlayPanel side panel; changes are pushed to any open overlay over
// the /chat WS ({ type: "chat_overlay_config" }) so OBS never needs a reload.
const { db } = require("./db");

const DEFAULTS = {
  // "default" = the original flat-row renderer (nine-slice background image,
  // canvas-backed). "bubbles" = the decorated speech-bubble renderer. The two
  // share the feed/WS plumbing and the behavior knobs below, but nothing else:
  // each has its own CSS and its own row builder in overlay/chat.html.
  theme: "default",
  max: 25,
  fade: 0, // seconds; 0 = messages never auto-remove (only capped by `max`)
  showEvents: true,
  showBanner: true,
  bannerDuration: 6000, // ms
  showRedeems: true,
  direction: "up", // "up" = newest at bottom, "down" = newest at top
  align: "left",
  timestamps: false,
  userColor: true,
  animate: true,
  lang: "en",
  width: 420,
  maxHeight: 600, // px cap on the whole feed's height (still clamped to 96vh in CSS)
  fontsize: 16,
  bg: 0.35, // per-message row background opacity, 0-1
  textcolor: "ffffff", // hex, no leading #
  fontFamily: "", // CSS font-family string; "" = built-in default stack
  showBotMessages: true, // include messages sent by the account's own chat bot

  // ── Background image (nine-slice, applied per message row) ─────────────
  bgImageOpacity: 1, // opacity of the uploaded texture, 0-1
  // Insets in px of the SOURCE image itself (native/unscaled corner size —
  // classic nine-slice). If a row is too small to fit both corners on an
  // axis at full size, the overlay shrinks that axis's corners together
  // proportionally rather than distorting one independently of the other.
  sliceLeft: 24,
  sliceRight: 24,
  sliceTop: 24,
  sliceBottom: 24,
  mirrorH: false, // right column = horizontally-flipped copy of the left column
  mirrorV: false, // bottom row = vertically-flipped copy of the top row

  // ── "bubbles" theme ────────────────────────────────────────────────────
  // Only read when theme === "bubbles". Several of the generic knobs above
  // are reused rather than duplicated: `max` is the message limit, `fade` the
  // auto-hide delay, `showEvents` toggles alerts, `userColor` overrides the
  // configured username color with the chatter's own Twitch color, and
  // `fontFamily` names the Google Font to load.
  allCaps: false, // uppercase non-emote words
  showBadges: true, // draw the role badge tag under the bubble
  // Flower/bud/leaf ornaments around the bubble. Off leaves a plain rounded
  // bubble; the role badge tag is separate and stays under showBadges.
  showDecorations: true,
  ignoreCommands: "", // comma-separated command prefixes to hide, e.g. "!bot,!sr"

  fontSizeUsername: 24,
  fontWeightUsername: 400,
  fontSizeMessage: 20,
  fontWeightMessage: 400,
  fontSizeAlertUsername: 19,
  fontWeightAlertUsername: 400,

  usernameColor: "#F7FBFF",
  messageBackground: "#F7FBFF",
  messageBorder: "#EEB09E",
  messageColor: "#DB867A",
  alertColor: "#F7FBFF",
  flowerBorder: "#EEB09E",
  flowerFill: "#FCFEFF",
  flowerCenter: "#FBD5B5",
  flowerLeaf: "#92AF3E",
  flower2Leaf: "#92AF3E",
  flower2Fill: "#EEB09E",

  // Alert copy. "[amount]" is substituted with the event's count/bits/viewers.
  followAlertMessage: "just followed!",
  subAlertMessage: "just subscribed!",
  resubAlertMessage: "resubscribed for [amount] months!",
  giftedSubAlertMessage: "just gifted x[amount]!",
  cheerAlertMessage: "just cheered [amount] bits!",
  raidAlertMessage: "just raided with [amount]!",
  redeemAlertMessage: "redeemed [amount]!",
};

const FONT_FAMILY_RE = /^[\w\s,'"\-]{0,120}$/;

// Keys whose value is a "#rrggbb" CSS color (the bubbles theme writes them
// straight into custom properties, so the "#" is kept — unlike `textcolor`,
// which predates this and is stored bare).
const COLOR_KEYS = new Set([
  "usernameColor", "messageBackground", "messageBorder", "messageColor", "alertColor",
  "flowerBorder", "flowerFill", "flowerCenter", "flowerLeaf", "flower2Leaf", "flower2Fill",
]);
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

// Free-text keys, length-capped. Alert copy is rendered with textContent in
// the overlay, so no markup can escape from here.
const TEXT_MAX = { ignoreCommands: 300 };
const ALERT_MESSAGE_KEYS = new Set(
  Object.keys(DEFAULTS).filter((k) => k.endsWith("AlertMessage"))
);

const getConfigStmt = db.prepare(`SELECT config FROM chat_overlay_config WHERE twitchId = ?`);
const upsertConfigStmt = db.prepare(`
  INSERT INTO chat_overlay_config (twitchId, config) VALUES (?, ?)
  ON CONFLICT(twitchId) DO UPDATE SET config = excluded.config
`);

function readOne(twitchId) {
  const row = getConfigStmt.get(twitchId);
  if (!row) return null;
  try {
    return JSON.parse(row.config);
  } catch {
    return null;
  }
}

function writeOne(twitchId, config) {
  upsertConfigStmt.run(twitchId, JSON.stringify(config));
}

function sanitize(partial) {
  const out = {};
  if (!partial || typeof partial !== "object") return out;
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in partial)) continue;
    const def = DEFAULTS[key];
    const val = partial[key];
    if (typeof def === "boolean") {
      out[key] = !!val;
    } else if (typeof def === "number") {
      const n = Number(val);
      if (Number.isFinite(n)) out[key] = n;
    } else if (key === "theme") {
      if (val === "default" || val === "bubbles") out[key] = val;
    } else if (COLOR_KEYS.has(key)) {
      const hex = String(val).startsWith("#") ? String(val) : "#" + String(val);
      if (COLOR_RE.test(hex)) out[key] = hex;
    } else if (ALERT_MESSAGE_KEYS.has(key)) {
      out[key] = String(val).slice(0, 200);
    } else if (key in TEXT_MAX) {
      out[key] = String(val).slice(0, TEXT_MAX[key]);
    } else if (key === "direction") {
      if (val === "up" || val === "down") out[key] = val;
    } else if (key === "align") {
      if (val === "left" || val === "right") out[key] = val;
    } else if (key === "lang") {
      if (val === "en" || val === "es") out[key] = val;
    } else if (key === "textcolor") {
      const hex = String(val).replace(/^#/, "");
      if (/^[0-9a-fA-F]{3,6}$/.test(hex)) out[key] = hex;
    } else if (key === "fontFamily") {
      const str = String(val).slice(0, 120);
      if (FONT_FAMILY_RE.test(str)) out[key] = str;
    }
  }
  // Clamp numeric ranges so a bad payload can't wedge the overlay.
  if ("max" in out) out.max = Math.min(200, Math.max(1, Math.round(out.max)));
  if ("fade" in out) out.fade = Math.min(600, Math.max(0, out.fade));
  if ("bannerDuration" in out) out.bannerDuration = Math.min(30000, Math.max(1000, Math.round(out.bannerDuration)));
  if ("width" in out) out.width = Math.min(1200, Math.max(200, Math.round(out.width)));
  if ("maxHeight" in out) out.maxHeight = Math.min(3000, Math.max(100, Math.round(out.maxHeight)));
  if ("fontsize" in out) out.fontsize = Math.min(64, Math.max(8, Math.round(out.fontsize)));
  if ("bg" in out) out.bg = Math.min(1, Math.max(0, out.bg));
  if ("bgImageOpacity" in out) out.bgImageOpacity = Math.min(1, Math.max(0, out.bgImageOpacity));
  if ("sliceLeft" in out) out.sliceLeft = Math.min(1000, Math.max(0, Math.round(out.sliceLeft)));
  if ("sliceRight" in out) out.sliceRight = Math.min(1000, Math.max(0, Math.round(out.sliceRight)));
  if ("sliceTop" in out) out.sliceTop = Math.min(1000, Math.max(0, Math.round(out.sliceTop)));
  if ("sliceBottom" in out) out.sliceBottom = Math.min(1000, Math.max(0, Math.round(out.sliceBottom)));
  for (const key of ["fontSizeUsername", "fontSizeMessage", "fontSizeAlertUsername"]) {
    if (key in out) out[key] = Math.min(96, Math.max(8, Math.round(out[key])));
  }
  for (const key of ["fontWeightUsername", "fontWeightMessage", "fontWeightAlertUsername"]) {
    if (key in out) out[key] = Math.min(1000, Math.max(100, Math.round(out[key] / 100) * 100));
  }
  return out;
}

function getConfig(twitchId) {
  return { ...DEFAULTS, ...(readOne(twitchId) || {}) };
}

function setConfig(twitchId, partial) {
  const merged = { ...DEFAULTS, ...(readOne(twitchId) || {}), ...sanitize(partial) };
  writeOne(twitchId, merged);
  return merged;
}

module.exports = { DEFAULTS, getConfig, setConfig };
