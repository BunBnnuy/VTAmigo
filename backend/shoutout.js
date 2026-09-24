// The `!so <username>` shoutout feature:
//
//   • per-account config (which clip to pick, whether/how the banner reads),
//     stored in the shoutout_config SQLite table (see db.js),
//   • the small in-memory "currently showing" record the overlay reads when it
//     reloads mid-clip (getActive),
//   • the pure clip-selection helper shared by the !so handler and the
//     panel's Test button (pickClip).
//
// The actual Twitch API calls live in twitchClips.js and the IRC-side
// orchestration (permission check, bot reply, broadcast) in sessions.js — this
// module is deliberately free of both so it stays trivially testable.
const { db } = require("./db");

const MODES = ["recent-random", "top-random", "most-recent"];

// How many of the channel's most-viewed clips "top-random" samples from, and
// how many clips we ask Twitch for at all (Helix caps `first` at 100).
const TOP_SAMPLE = 25;
const FETCH_LIMIT = 100;

// Fonts offered for the message block. Kept to a small allowlist so the value
// is safe to drop straight into CSS and the overlay can preload them.
const FONTS = ["Quicksand", "Nunito", "Poppins", "Montserrat", "Inter", "Bangers", "Luckiest Guy"];
const AVATAR_SHAPES = ["circle", "square"];
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

const DEFAULTS = {
  mode: "recent-random", // one of MODES
  // Message block (the "< mensaje >" bar under the clip).
  showBanner: true,
  bannerText: "Shoutout to {username}!",
  messageBg: "#9147ff",
  messageColor: "#ffffff",
  messageFont: "Quicksand",
  // Channel icon shown left of the clip.
  showAvatar: true,
  avatarShape: "circle", // one of AVATAR_SHAPES
};

const getConfigStmt = db.prepare(`SELECT config FROM shoutout_config WHERE twitchId = ?`);
const upsertConfigStmt = db.prepare(`
  INSERT INTO shoutout_config (twitchId, config) VALUES (?, ?)
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
  if ("mode" in partial && MODES.includes(partial.mode)) out.mode = partial.mode;
  if ("showBanner" in partial) out.showBanner = !!partial.showBanner;
  if ("bannerText" in partial) out.bannerText = String(partial.bannerText).slice(0, 120);
  if ("showAvatar" in partial) out.showAvatar = !!partial.showAvatar;
  if ("avatarShape" in partial && AVATAR_SHAPES.includes(partial.avatarShape)) out.avatarShape = partial.avatarShape;
  if ("messageFont" in partial && FONTS.includes(partial.messageFont)) out.messageFont = partial.messageFont;
  for (const key of ["messageBg", "messageColor"]) {
    if (key in partial && COLOR_RE.test(String(partial[key]))) out[key] = String(partial[key]);
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

// The two "recent" modes only consider clips created in this window. Helix has
// no sort parameter — its default broadcaster page is view-count ordered, which
// is why an unfiltered pool surfaces years-old clips — so the only lever is the
// started_at/ended_at window at fetch time (see twitchClips.fetchClips).
const RECENT_WINDOW_DAYS = 30;

function usesRecentWindow(mode) {
  return mode === "recent-random" || mode === "most-recent";
}

// Twitch's Get Clips examples use second-precision RFC3339
// ("2019-10-21T00:00:00Z"); strip the milliseconds toISOString() adds so a
// stricter parser can't reject the window.
function rfc3339Seconds(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function recentWindow(now = Date.now()) {
  return {
    startedAt: rfc3339Seconds(now - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000),
    endedAt: rfc3339Seconds(now),
  };
}

// Pure selection over an already-fetched clip list. Never relies on the order
// Helix happens to return: created_at/view_count are sorted explicitly so a
// change in Twitch's default ordering can't silently turn "most recent" into
// "most viewed".
function pickClip(clips, mode) {
  if (!Array.isArray(clips) || clips.length === 0) return null;
  if (mode === "most-recent") {
    return [...clips].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
  }
  if (mode === "top-random") {
    const top = [...clips].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, TOP_SAMPLE);
    return top[Math.floor(Math.random() * top.length)];
  }
  // recent-random (default): uniform pick over everything we fetched.
  return clips[Math.floor(Math.random() * clips.length)];
}

function bannerFor(config, username) {
  return String(config.bannerText || DEFAULTS.bannerText).replace(/\{username\}/gi, username);
}

// ── Currently-showing record ──────────────────────────────────────────────
// In-memory only: a shoutout is a transient on-screen event, so there is
// nothing worth persisting across a restart. `endsAt` lets an OBS reload
// mid-clip resume (or skip) the rest of it via GET /shoutout/state.
const activeShoutouts = new Map(); // twitchId -> payload

function setActive(twitchId, payload) {
  activeShoutouts.set(twitchId, payload);
  return payload;
}

function getActive(twitchId) {
  const active = activeShoutouts.get(twitchId);
  if (!active) return null;
  if (active.endsAt && active.endsAt <= Date.now()) {
    activeShoutouts.delete(twitchId);
    return null;
  }
  return active;
}

function clearActive(twitchId) {
  activeShoutouts.delete(twitchId);
}

module.exports = {
  MODES,
  FONTS,
  AVATAR_SHAPES,
  FETCH_LIMIT,
  RECENT_WINDOW_DAYS,
  DEFAULTS,
  getConfig,
  setConfig,
  usesRecentWindow,
  recentWindow,
  pickClip,
  bannerFor,
  setActive,
  getActive,
  clearActive,
};
