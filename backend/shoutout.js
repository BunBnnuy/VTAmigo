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

const DEFAULTS = {
  mode: "recent-random", // one of MODES
  showBanner: true,
  bannerText: "Shoutout to {username}!",
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
  FETCH_LIMIT,
  DEFAULTS,
  getConfig,
  setConfig,
  pickClip,
  bannerFor,
  setActive,
  getActive,
  clearActive,
};
