// Read-only Twitch Helix helpers for the !so shoutout feature: resolve a
// channel login to its user record, then fetch that channel's clips and hand
// back a normalized, screenshot-friendly shape.
//
// Self-contained `httpsGet` on purpose, matching eventsub.js/streamSettings.js:
// there is no shared Twitch REST client in this codebase. Get Clips accepts any
// valid app or user token and needs no extra OAuth scope, so the streamer's own
// existing token (see getValidTwitchToken) is enough — no re-login required.
const https = require("https");

const HELIX = "https://api.twitch.tv/helix";

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

function httpsPostJson(url, headers, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), ...headers },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode, data: raw }); }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// Error codes the caller (sessions.js handleShoutout) turns into chat replies.
class ShoutoutError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

function authHeaders(token) {
  return { "Client-ID": process.env.TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` };
}

// GET /helix/users?login=... — resolves the shouted-out channel. Returns null
// when Twitch knows no such login.
async function resolveUser(login, token) {
  const res = await httpsGet(`${HELIX}/users?login=${encodeURIComponent(login)}`, authHeaders(token));
  if (res.status === 401) throw new ShoutoutError("SHOUTOUT_TOKEN_INVALID", "Twitch rejected the access token");
  if (res.status !== 200) throw new ShoutoutError("SHOUTOUT_API_ERROR", `users lookup HTTP ${res.status}`);
  const user = res.data?.data?.[0];
  if (!user) return null;
  return {
    id: user.id,
    login: user.login,
    displayName: user.display_name,
    profileImageUrl: user.profile_image_url,
  };
}

// Twitch's clip iframe embed is non-interactive: no JS API, no way to hide
// the player chrome, and its autoplay/mute state is out of our hands (see the
// Video & Clips embed docs). The underlying clip file, however, is a plain
// public MP4 on clips-media-assets2.twitch.tv, and Helix's thumbnail_url
// points at its preview frame — swapping the "-preview-<WxH>.jpg" suffix for
// ".mp4" yields the video itself. The overlay plays that in a native <video>
// (no chrome, real `ended` event, and we control volume), falling back to the
// iframe only if the derived URL won't load, so a Twitch-side change degrades
// to "works but with the player UI" instead of showing nothing.
function clipVideoUrl(thumbnailUrl) {
  if (typeof thumbnailUrl !== "string") return null;
  const match = thumbnailUrl.match(/^(.*)-preview-\d+x\d+\.jpg$/);
  return match ? `${match[1]}.mp4` : null;
}

function normalizeClip(clip) {
  return {
    id: clip.id,
    slug: clip.id, // Helix's clip id IS the slug used in clips.twitch.tv URLs
    url: clip.url,
    title: clip.title,
    duration: Number(clip.duration) || 0, // seconds (float)
    thumbnailUrl: clip.thumbnail_url,
    mp4Url: clipVideoUrl(clip.thumbnail_url),
    views: clip.view_count || 0,
    creatorName: clip.creator_name || null,
    broadcasterName: clip.broadcaster_name || null,
    language: clip.language || null,
    gameId: clip.game_id || null,
    createdAt: clip.created_at ? Date.parse(clip.created_at) : 0,
  };
}

// GET /helix/clips?broadcaster_id=... — up to 100 of the channel's clips.
// Helix has no sort parameter and its default page for a broadcaster is ordered
// by view count, so `startedAt`/`endedAt` (RFC3339) are the only way to bias the
// pool toward recent clips. `ended_at` is only honored alongside `started_at`.
async function fetchClips(broadcasterId, token, { startedAt, endedAt } = {}) {
  const params = new URLSearchParams({ broadcaster_id: broadcasterId, first: "100" });
  if (startedAt) params.set("started_at", startedAt);
  if (endedAt) params.set("ended_at", endedAt);
  const res = await httpsGet(`${HELIX}/clips?${params.toString()}`, authHeaders(token));
  if (res.status === 401) throw new ShoutoutError("SHOUTOUT_TOKEN_INVALID", "Twitch rejected the access token");
  if (res.status !== 200) throw new ShoutoutError("SHOUTOUT_API_ERROR", `clips lookup HTTP ${res.status}`);
  return (res.data?.data || []).map(normalizeClip);
}

// Full lookup for one !so: resolve the channel, fetch its clips, return both.
// The "no such channel" / "no clips" cases are distinct so the bot can say
// something specific instead of a generic failure.
async function lookupClips(login, token, options = {}) {
  const user = await resolveUser(login, token);
  if (!user) throw new ShoutoutError("SHOUTOUT_USER_NOT_FOUND", `no Twitch channel named "${login}"`);
  const clips = await fetchClips(user.id, token, options);
  return { user, clips };
}

// ── Directly playable clip file ──────────────────────────────────────────────
// The whole reason this module reaches past the official API: the clips embed
// iframe is non-interactive (Twitch's docs) so its player chrome can't be
// hidden or its volume/end behaviour controlled, and Get Clips returns no video
// URL at all. Twitch's own web player streams clips from a signed CloudFront
// MP4 whose `token`/`sig` come from the GraphQL `clip.playbackAccessToken`
// field — the only source of a file we can put in a native <video>.
//
// This uses Twitch's public web Client-Id and an undocumented query, so it is
// best-effort: callers treat a null return as "fall back to the embed". The
// token is a short-lived signed URL, cached only briefly.
const GQL_URL = "https://gql.twitch.tv/gql";
const TWITCH_WEB_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";
const CLIP_PLAYBACK_QUERY =
  'query($slug:ID!){clip(slug:$slug){videoQualities{quality sourceURL}' +
  'playbackAccessToken(params:{platform:"web",playerBackend:"mediaplayer",playerType:"site"}){value signature}}}';

const playbackCache = new Map(); // slug -> { url, expiresAt }

// Highest numeric quality wins ("720" over "480"/"360"/"audio_only").
function bestQualityUrl(qualities) {
  if (!Array.isArray(qualities) || qualities.length === 0) return null;
  let best = null;
  let bestScore = -1;
  for (const q of qualities) {
    if (!q || !q.sourceURL) continue;
    const score = parseInt(q.quality, 10);
    const numeric = Number.isFinite(score) ? score : 0;
    if (numeric > bestScore) {
      bestScore = numeric;
      best = q.sourceURL;
    }
  }
  return best;
}

function buildPlaybackUrl(sourceURL, value, signature) {
  if (!sourceURL || !value || !signature) return null;
  return `${sourceURL}?token=${encodeURIComponent(value)}&sig=${signature}`;
}

async function fetchPlaybackUrl(slug) {
  const cached = playbackCache.get(slug);
  if (cached && cached.expiresAt > Date.now() + 5000) return cached.url;
  try {
    const res = await httpsPostJson(
      GQL_URL,
      { "Client-ID": TWITCH_WEB_CLIENT_ID },
      { query: CLIP_PLAYBACK_QUERY, variables: { slug } }
    );
    if (res.status !== 200) return null;
    const clip = res.data && res.data.data && res.data.data.clip;
    if (!clip) return null;
    const token = clip.playbackAccessToken || {};
    const url = buildPlaybackUrl(bestQualityUrl(clip.videoQualities), token.value, token.signature);
    if (!url) return null;
    let expiresAt = Date.now() + 60000;
    try {
      const parsed = JSON.parse(token.value);
      if (parsed && parsed.expires) expiresAt = parsed.expires * 1000 - 10000;
    } catch {
      // token wasn't JSON — the short default TTL still keeps the cache honest
    }
    playbackCache.set(slug, { url, expiresAt });
    return url;
  } catch (err) {
    console.error("[shoutout] playback lookup failed:", err.message);
    return null;
  }
}

module.exports = {
  ShoutoutError,
  resolveUser,
  fetchClips,
  lookupClips,
  normalizeClip,
  clipVideoUrl,
  bestQualityUrl,
  buildPlaybackUrl,
  fetchPlaybackUrl,
};
