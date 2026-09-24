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

function normalizeClip(clip) {
  return {
    id: clip.id,
    slug: clip.id, // Helix's clip id IS the slug used in clips.twitch.tv URLs
    url: clip.url,
    title: clip.title,
    duration: Number(clip.duration) || 0, // seconds (float)
    thumbnailUrl: clip.thumbnail_url,
    views: clip.view_count || 0,
    creatorName: clip.creator_name || null,
    broadcasterName: clip.broadcaster_name || null,
    language: clip.language || null,
    gameId: clip.game_id || null,
    createdAt: clip.created_at ? Date.parse(clip.created_at) : 0,
  };
}

// GET /helix/clips?broadcaster_id=... — up to 100 of the channel's clips.
async function fetchClips(broadcasterId, token) {
  const res = await httpsGet(
    `${HELIX}/clips?broadcaster_id=${encodeURIComponent(broadcasterId)}&first=100`,
    authHeaders(token)
  );
  if (res.status === 401) throw new ShoutoutError("SHOUTOUT_TOKEN_INVALID", "Twitch rejected the access token");
  if (res.status !== 200) throw new ShoutoutError("SHOUTOUT_API_ERROR", `clips lookup HTTP ${res.status}`);
  return (res.data?.data || []).map(normalizeClip);
}

// Full lookup for one !so: resolve the channel, fetch its clips, return both.
// The "no such channel" / "no clips" cases are distinct so the bot can say
// something specific instead of a generic failure.
async function lookupClips(login, token) {
  const user = await resolveUser(login, token);
  if (!user) throw new ShoutoutError("SHOUTOUT_USER_NOT_FOUND", `no Twitch channel named "${login}"`);
  const clips = await fetchClips(user.id, token);
  return { user, clips };
}

module.exports = { ShoutoutError, resolveUser, fetchClips, lookupClips, normalizeClip };
