// Profile pictures for viewer-facing overlays (currently the watch-streak
// alert). Twitch's IRC tags carry a user-id but never an image URL, so this
// resolves one through Helix's Get Users, which any valid user token can call
// and which needs no extra OAuth scope — no re-login for streamers.
//
// The cache is global (profile pictures are public) and keyed by user id, plus
// a "login:<name>" key for the panel's Test button, which only knows the name
// the streamer typed. A miss is cached briefly as well: a viewer with no
// picture would otherwise cost a Helix round-trip on every single milestone.
// Failures never throw — an avatar is decoration, and the overlay falls back
// to an initial letter.
const https = require("https");

const HELIX = "https://api.twitch.tv/helix";
const HIT_TTL_MS = 6 * 60 * 60 * 1000;
const MISS_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 500;

const cache = new Map(); // userId | "login:<name>" -> { url, expiresAt }

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on("error", reject);
  });
}

function authHeaders(token) {
  return {
    "Client-ID": process.env.TWITCH_CLIENT_ID,
    Authorization: `Bearer ${token}`,
  };
}

function remember(key, url) {
  const expiresAt = Date.now() + (url ? HIT_TTL_MS : MISS_TTL_MS);
  cache.set(key, { url, expiresAt });
  // Bounded: Map preserves insertion order, so the first key is the oldest.
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
}

function cached(key) {
  const entry = cache.get(key);
  return entry && entry.expiresAt > Date.now() ? entry : null;
}

// GET /helix/users?id=<id> — the real event path: the USERNOTICE carries the
// viewer's numeric id, so no name resolution is needed. `fresh` skips the
// cache read (the Test button uses it so a just-changed picture shows up).
async function getAvatar(userId, token, { fresh = false } = {}) {
  if (!userId || !token) return null;

  if (!fresh) {
    const entry = cached(userId);
    if (entry) return entry.url;
  }

  let url = null;
  try {
    const res = await httpsGet(`${HELIX}/users?id=${encodeURIComponent(userId)}`, authHeaders(token));
    if (res.status === 200) url = res.data?.data?.[0]?.profile_image_url || null;
  } catch (err) {
    console.warn("[avatar] lookup failed:", err.message);
  }

  remember(userId, url);
  return url;
}

// GET /helix/users?login=<name> — the Test button path. The panel knows the
// name the streamer typed, not the numeric id, so it resolves one through
// Helix. Returns null for an unknown login, which lets the overlay preview the
// initial-letter fallback instead of silently reusing someone else's picture.
async function getAvatarByLogin(login, token, { fresh = false } = {}) {
  if (!login || !token) return null;

  const key = `login:${String(login).toLowerCase()}`;
  if (!fresh) {
    const entry = cached(key);
    if (entry) return entry.url;
  }

  let url = null;
  try {
    const res = await httpsGet(`${HELIX}/users?login=${encodeURIComponent(login)}`, authHeaders(token));
    if (res.status === 200) {
      const user = res.data?.data?.[0];
      url = user?.profile_image_url || null;
      // Warm the id-keyed entry too, so a real streak from this viewer is a
      // cache hit later.
      if (user?.id) remember(user.id, url);
    }
  } catch (err) {
    console.warn("[avatar] login lookup failed:", err.message);
  }

  remember(key, url);
  return url;
}

module.exports = { getAvatar, getAvatarByLogin };
