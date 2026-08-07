// Per-account appearance/behavior settings for the chat overlay
// (backend/overlay/chat.html), stored in the chat_overlay_config SQLite
// table (see db.js), keyed by twitchId — previously a flat JSON file in the
// same style as users.json. Edited live from the frontend's
// ChatOverlayPanel side panel; changes are pushed to any open overlay over
// the /chat WS ({ type: "chat_overlay_config" }) so OBS never needs a reload.
const { db } = require("./db");

const DEFAULTS = {
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
};

const FONT_FAMILY_RE = /^[\w\s,'"\-]{0,120}$/;

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
