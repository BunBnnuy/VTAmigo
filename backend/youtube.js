// YouTube resolution helpers for the song-request queue (backend/videoQueue.js).
// Direct URL/ID lookups use the free oEmbed endpoint (no quota); free-text
// title search and playlist expansion need the YouTube Data API v3, which
// requires YOUTUBE_API_KEY in the backend environment.
const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const PLAYLIST_ID_RE = /^[a-zA-Z0-9_-]{10,}$/;

function extractVideoId(input) {
  const text = (input || "").trim();
  if (VIDEO_ID_RE.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.hostname.includes("youtu.be")) {
      const id = url.pathname.slice(1);
      return VIDEO_ID_RE.test(id) ? id : null;
    }
    if (url.hostname.includes("youtube.com")) {
      const v = url.searchParams.get("v");
      if (v && VIDEO_ID_RE.test(v)) return v;
      const shortsMatch = url.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{11})/);
      if (shortsMatch) return shortsMatch[1];
    }
  } catch {
    // not a URL — fall through
  }
  return null;
}

function extractPlaylistId(input) {
  const text = (input || "").trim();
  try {
    const url = new URL(text);
    const list = url.searchParams.get("list");
    if (list) return list;
  } catch {
    // not a URL — treat as a bare ID below
  }
  return PLAYLIST_ID_RE.test(text) ? text : null;
}

async function oembedLookup(videoId) {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${videoId}`
  )}&format=json`;
  const response = await fetch(url);
  if (!response.ok) throw new Error("VIDEO_NOT_FOUND");
  const body = await response.json();
  return {
    videoId,
    title: body.title || videoId,
    thumbnail: body.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
}

async function searchVideo(query) {
  if (!process.env.YOUTUBE_API_KEY) throw new Error("YOUTUBE_API_KEY_MISSING");
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=${encodeURIComponent(
    query
  )}&key=${process.env.YOUTUBE_API_KEY}`;
  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `YouTube search failed (${response.status})`);
  const item = body.items?.[0];
  if (!item) throw new Error("NO_RESULTS");
  return {
    videoId: item.id.videoId,
    title: item.snippet.title,
    thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
  };
}

// Single entry point for both !sr chat requests and the site's add-to-queue box.
async function resolveInput(input) {
  const videoId = extractVideoId(input);
  if (videoId) return oembedLookup(videoId);
  return searchVideo(input);
}

async function fetchPlaylistItems(playlistId, maxItems = 200) {
  if (!process.env.YOUTUBE_API_KEY) throw new Error("YOUTUBE_API_KEY_MISSING");
  const items = [];
  let pageToken = "";
  do {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${encodeURIComponent(
      playlistId
    )}&key=${process.env.YOUTUBE_API_KEY}${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const response = await fetch(url);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message || `YouTube playlist lookup failed (${response.status})`);
    for (const item of body.items || []) {
      const videoId = item.snippet?.resourceId?.videoId;
      if (!videoId) continue;
      items.push({
        videoId,
        title: item.snippet.title,
        thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
      });
    }
    pageToken = body.nextPageToken || "";
  } while (pageToken && items.length < maxItems);
  if (items.length === 0) throw new Error("PLAYLIST_EMPTY_OR_NOT_FOUND");
  return items.slice(0, maxItems);
}

module.exports = { extractVideoId, extractPlaylistId, oembedLookup, searchVideo, resolveInput, fetchPlaylistItems };
