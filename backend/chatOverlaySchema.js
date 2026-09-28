// Single source of truth for the chat overlay's personalization options.
//
// This is a clean-room design: instead of hand-writing a validator and a
// settings form that inevitably drift apart, one FIELDS list describes every
// option (key, label, group, type, default, bounds). chatOverlayConfig.js
// derives DEFAULTS and sanitize() from it, and the frontend renders the
// ChatOverlayPanel form from it via GET /chat-overlay/schema. Adding an
// option is a one-line change here.
//
// Keys are flat (role_streamer_nameColor, event_follow_message, …) so a POST
// can merge them into the stored JSON object without a nested merge, and so
// the overlay can read cfg[key] directly.

// Roles get an identical block of controls each; ROLES just names the blocks.
const ROLES = [
  { id: "streamer", label: "Streamer" },
  { id: "mod", label: "Moderator" },
  { id: "vip", label: "VIP" },
  { id: "sub1", label: "Subscriber Tier 1" },
  { id: "sub2", label: "Subscriber Tier 2" },
  { id: "sub3", label: "Subscriber Tier 3" },
  { id: "normal", label: "Viewer" },
  { id: "custom1", label: "Custom Role 1" },
  { id: "custom2", label: "Custom Role 2" },
  { id: "custom3", label: "Custom Role 3" },
];

const EVENTS = [
  { id: "follow", label: "Follow" },
  { id: "sub", label: "New Sub" },
  { id: "giftsub", label: "Gift Sub" },
  { id: "raid", label: "Raid" },
  { id: "bits", label: "Bits" },
  { id: "tips", label: "Tips" },
];

const ANIMATIONS = [
  ["none", "None"],
  ["slide", "Slide in"],
  ["fade", "Fade in"],
  ["pop", "Pop"],
  ["bounce", "Bounce"],
  ["zoom", "Zoom"],
];

const FONT_SIZES = [
  [100, "100"], [200, "200"], [300, "300"], [400, "400"], [500, "500"],
  [600, "600"], [700, "700"], [800, "800"], [900, "900"],
];

// Reusable field factories — every role block is generated, not copy-pasted.
function roleFields(role) {
  const p = `role_${role.id}_`;
  const custom = role.id.startsWith("custom");
  const g = `Role: ${role.label}`;
  const fields = [
    { key: p + "enable", label: "Apply this role style", group: g, type: "toggle", default: !custom },
  ];
  if (custom) {
    fields.push({
      key: p + "match",
      label: "Match names/words (comma separated)",
      group: g, type: "text", default: "",
    });
  }
  fields.push(
    { key: p + "nameColor", label: "Name color", group: g, type: "color", default: "#ffffff" },
    { key: p + "msgColor", label: "Message color", group: g, type: "color", default: "#efeff1" },
    { key: p + "nameBg", label: "Name background", group: g, type: "color", default: "" },
    { key: p + "msgBg", label: "Message background", group: g, type: "color", default: "" },
    { key: p + "border", label: "Border color", group: g, type: "color", default: "" },
    { key: p + "tag", label: "Tag text (blank = none)", group: g, type: "text", default: "" },
    { key: p + "tagColor", label: "Tag text color", group: g, type: "color", default: "#ffffff" },
    { key: p + "tagBg", label: "Tag background", group: g, type: "color", default: "#9147ff" },
    { key: p + "icon", label: "Icon image URL", group: g, type: "text", default: "" },
    { key: p + "iconSize", label: "Icon size (px)", group: g, type: "number", default: 22, min: 8, max: 200, step: 1 },
    { key: p + "animation", label: "Arrival animation", group: g, type: "select", default: "slide", options: ANIMATIONS },
    { key: p + "sound", label: "Sound URL", group: g, type: "text", default: "" },
    { key: p + "soundVolume", label: "Sound volume (%)", group: g, type: "number", default: 100, min: 0, max: 100, step: 5 },
  );
  return fields;
}

function eventFields(ev) {
  const p = `event_${ev.id}_`;
  const g = `Event: ${ev.label}`;
  return [
    { key: p + "enable", label: "Show this event", group: g, type: "toggle", default: true },
    {
      key: p + "message",
      label: "Message ({name}, {sender}, {amount})",
      group: g, type: "text", default: defaultEventMessage(ev.id),
    },
    { key: p + "color", label: "Text color", group: g, type: "color", default: "#ffd75e" },
    { key: p + "bg", label: "Background", group: g, type: "color", default: "#9147ff" },
    { key: p + "icon", label: "Icon image URL", group: g, type: "text", default: "" },
    { key: p + "min", label: "Minimum amount", group: g, type: "number", default: 0, min: 0, max: 100000, step: 1 },
    { key: p + "animation", label: "Arrival animation", group: g, type: "select", default: "slide", options: ANIMATIONS },
    { key: p + "sound", label: "Sound URL", group: g, type: "text", default: "" },
    { key: p + "soundVolume", label: "Sound volume (%)", group: g, type: "number", default: 100, min: 0, max: 100, step: 5 },
  ];
}

function defaultEventMessage(id) {
  switch (id) {
    case "follow": return "{name} just followed!";
    case "sub": return "{name} just subscribed!";
    case "giftsub": return "{name} gifted {amount} sub(s)!";
    case "raid": return "{name} raided with {amount} viewer(s)!";
    case "bits": return "{name} cheered {amount} bits!";
    case "tips": return "{sender} tipped {amount}!";
    default: return "{name}";
  }
}

const BASE_FIELDS = [
  // ── Layout ────────────────────────────────────────────────────────────────
  { key: "layout", label: "Layout mode", group: "Layout", type: "select", default: "vertical",
    options: [["vertical", "Vertical"], ["horizontal", "Horizontal"], ["random", "Random positions"],
      ["specialH", "Special horizontal"], ["specialV", "Special vertical"]] },
  { key: "vAlign", label: "Vertical alignment", group: "Layout", type: "select", default: "bottom",
    options: [["top", "Top"], ["center", "Middle"], ["bottom", "Bottom"]] },
  { key: "hAlign", label: "Horizontal alignment", group: "Layout", type: "select", default: "left",
    options: [["left", "From the left"], ["right", "From the right"]] },
  { key: "width", label: "Feed width (px)", group: "Layout", type: "number", default: 420, min: 200, max: 1200, step: 10 },
  { key: "maxHeight", label: "Feed max height (px)", group: "Layout", type: "number", default: 600, min: 100, max: 3000, step: 10 },
  { key: "max", label: "Message limit", group: "Layout", type: "number", default: 25, min: 1, max: 250, step: 1 },
  { key: "gap", label: "Spacing between messages (px)", group: "Layout", type: "number", default: 8, min: 0, max: 80, step: 1 },
  { key: "showDelay", label: "Show message after (seconds)", group: "Layout", type: "number", default: 0, min: 0, max: 120, step: 1 },
  { key: "hideAfter", label: "Hide message after (seconds, 0 = never)", group: "Layout", type: "number", default: 0, min: 0, max: 1000, step: 1 },
  { key: "animate", label: "Animate new messages", group: "Layout", type: "toggle", default: true },
  { key: "font", label: "Font (Google Font name)", group: "Layout", type: "font", default: "" },

  // ── Messages / filters ────────────────────────────────────────────────────
  { key: "showEvents", label: "Show events", group: "Messages", type: "toggle", default: true },
  { key: "showRedeems", label: "Show channel point redemptions", group: "Messages", type: "toggle", default: true },
  { key: "showBotMessages", label: "Show bot messages", group: "Messages", type: "toggle", default: true },
  { key: "hideCommands", label: "Hide ! commands", group: "Messages", type: "toggle", default: false },
  { key: "mutedUsers", label: "Muted chatters (comma separated)", group: "Messages", type: "text", default: "StreamElements,Streamlabs" },
  { key: "userColor", label: "Use chatter's Twitch color", group: "Messages", type: "toggle", default: true },
  { key: "allCaps", label: "Uppercase message text", group: "Messages", type: "toggle", default: false },
  { key: "lang", label: "Timestamp language", group: "Messages", type: "select", default: "en",
    options: [["en", "English"], ["es", "Español"]] },

  // ── Name box ──────────────────────────────────────────────────────────────
  { key: "nameInside", label: "Name inside message box", group: "Name box", type: "toggle", default: false },
  { key: "nameColon", label: "Colon after name", group: "Name box", type: "toggle", default: true },
  { key: "nameColor", label: "Default name color", group: "Name box", type: "color", default: "#ffffff" },
  { key: "nameSize", label: "Font size (px)", group: "Name box", type: "number", default: 20, min: 8, max: 72, step: 1 },
  { key: "nameWeight", label: "Font weight", group: "Name box", type: "select", default: 700, options: FONT_SIZES },
  { key: "nameCaps", label: "Uppercase name", group: "Name box", type: "toggle", default: false },
  { key: "nameTilt", label: "Tilt (deg)", group: "Name box", type: "number", default: 0, min: -45, max: 45, step: 1 },
  { key: "nameBgColor", label: "Background color", group: "Name box", type: "color", default: "#1f1f23" },
  { key: "nameBgOpacity", label: "Background opacity", group: "Name box", type: "slider", default: 0.55, min: 0, max: 1, step: 0.05 },
  { key: "nameBorderColor", label: "Border color", group: "Name box", type: "color", default: "#9147ff" },
  { key: "nameBorderWidth", label: "Border width (px)", group: "Name box", type: "number", default: 2, min: 0, max: 20, step: 1 },
  { key: "nameRadius", label: "Corner radius (px)", group: "Name box", type: "number", default: 10, min: 0, max: 60, step: 1 },
  { key: "namePadX", label: "Horizontal padding (px)", group: "Name box", type: "number", default: 10, min: 0, max: 60, step: 1 },
  { key: "namePadY", label: "Vertical padding (px)", group: "Name box", type: "number", default: 4, min: 0, max: 60, step: 1 },
  { key: "nameShadow", label: "Text shadow", group: "Name box", type: "toggle", default: true },

  // ── Message box ───────────────────────────────────────────────────────────
  { key: "msgSize", label: "Font size (px)", group: "Message box", type: "number", default: 20, min: 8, max: 72, step: 1 },
  { key: "msgWeight", label: "Font weight", group: "Message box", type: "select", default: 400, options: FONT_SIZES },
  { key: "msgCaps", label: "Uppercase message", group: "Message box", type: "toggle", default: false },
  { key: "msgAlign", label: "Text alignment", group: "Message box", type: "select", default: "left",
    options: [["left", "Left"], ["center", "Center"], ["right", "Right"]] },
  { key: "msgMaxWidth", label: "Max width (px, 0 = unlimited)", group: "Message box", type: "number", default: 0, min: 0, max: 1200, step: 10 },
  { key: "msgTilt", label: "Tilt (deg)", group: "Message box", type: "number", default: 0, min: -45, max: 45, step: 1 },
  { key: "msgBgColor", label: "Background color", group: "Message box", type: "color", default: "#1f1f23" },
  { key: "msgBgOpacity", label: "Background opacity", group: "Message box", type: "slider", default: 0.55, min: 0, max: 1, step: 0.05 },
  { key: "msgBorderColor", label: "Border color", group: "Message box", type: "color", default: "#9147ff" },
  { key: "msgBorderWidth", label: "Border width (px)", group: "Message box", type: "number", default: 2, min: 0, max: 20, step: 1 },
  { key: "msgRadius", label: "Corner radius (px)", group: "Message box", type: "number", default: 16, min: 0, max: 60, step: 1 },
  { key: "msgPadX", label: "Horizontal padding (px)", group: "Message box", type: "number", default: 14, min: 0, max: 60, step: 1 },
  { key: "msgPadY", label: "Vertical padding (px)", group: "Message box", type: "number", default: 8, min: 0, max: 60, step: 1 },
  { key: "msgShadow", label: "Box shadow", group: "Message box", type: "toggle", default: true },
  { key: "msgColor", label: "Default message color", group: "Message box", type: "color", default: "#efeff1" },

  // ── Emotes & badges ───────────────────────────────────────────────────────
  { key: "showEmotes", label: "Show emotes", group: "Emotes & badges", type: "toggle", default: true },
  { key: "emoteSize", label: "Emote height (px)", group: "Emotes & badges", type: "number", default: 28, min: 12, max: 96, step: 1 },
  { key: "bigEmoteSize", label: "Emote-only height (px)", group: "Emotes & badges", type: "number", default: 52, min: 16, max: 160, step: 1 },
  { key: "emoteAlign", label: "Emote vertical align", group: "Emotes & badges", type: "select", default: "middle",
    options: [["top", "Top"], ["middle", "Middle"], ["bottom", "Bottom"]] },
  { key: "emoteOverlap", label: "Allow emote overlap", group: "Emotes & badges", type: "toggle", default: false },
  { key: "showBadges", label: "Show role badges", group: "Emotes & badges", type: "toggle", default: true },
  { key: "badgeSize", label: "Badge size (px)", group: "Emotes & badges", type: "number", default: 20, min: 10, max: 64, step: 1 },
  { key: "showTimestamps", label: "Show timestamps", group: "Emotes & badges", type: "toggle", default: false },
  { key: "timestampColor", label: "Timestamp color", group: "Emotes & badges", type: "color", default: "#adadb8" },
  { key: "timestamp24h", label: "24-hour clock", group: "Emotes & badges", type: "toggle", default: false },
  { key: "showPronouns", label: "Show pronouns", group: "Emotes & badges", type: "toggle", default: false },
  { key: "pronounColor", label: "Pronoun color", group: "Emotes & badges", type: "color", default: "#adadb8" },
];

const FIELDS = [
  ...BASE_FIELDS,
  ...ROLES.flatMap(roleFields),
  ...EVENTS.flatMap(eventFields),
];

// Groups in display order: the base sections first, then the generated ones.
const GROUPS = [
  "Layout", "Messages", "Name box", "Message box", "Emotes & badges",
  ...ROLES.map((r) => `Role: ${r.label}`),
  ...EVENTS.map((e) => `Event: ${e.label}`),
];

const DEFAULTS = Object.fromEntries(FIELDS.map((f) => [f.key, f.default]));

const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const FONT_RE = /^[\w\s,'"\-]{0,120}$/;

function coerce(field, value) {
  switch (field.type) {
    case "toggle":
      return !!value;
    case "number":
    case "slider": {
      const n = Number(value);
      if (!Number.isFinite(n)) return field.default;
      const min = field.min ?? -Infinity;
      const max = field.max ?? Infinity;
      return Math.min(max, Math.max(min, n));
    }
    case "select": {
      // Numeric selects (font weights) arrive as strings or numbers; compare
      // against the option values loosely so either round-trips.
      const opts = field.options || [];
      const match = opts.find(([v]) => String(v) === String(value));
      return match ? match[0] : field.default;
    }
    case "color": {
      const s = String(value ?? "").trim();
      if (s === "") return field.default; // "" is a meaningful "unset" for overrides
      const hex = s.startsWith("#") ? s : "#" + s;
      return COLOR_RE.test(hex) ? hex : field.default;
    }
    case "font": {
      const s = String(value ?? "").slice(0, 120);
      return FONT_RE.test(s) ? s : field.default;
    }
    default: {
      const max = field.maxLength || (field.key === "mutedUsers" ? 300 : 500);
      return String(value ?? "").slice(0, max);
    }
  }
}

// Returns a fresh object containing only recognized keys, each coerced and
// clamped. Unknown keys and wrong types are dropped rather than rejected, so
// a stale client can't wedge the overlay with a bad payload.
function sanitize(partial) {
  const out = {};
  if (!partial || typeof partial !== "object") return out;
  for (const field of FIELDS) {
    if (!(field.key in partial)) continue;
    out[field.key] = coerce(field, partial[field.key]);
  }
  return out;
}

module.exports = { FIELDS, DEFAULTS, GROUPS, ROLES, EVENTS, sanitize };
