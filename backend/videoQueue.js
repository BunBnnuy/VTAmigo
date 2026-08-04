// Per-account YouTube song-request queue for the site + OBS overlay
// (backend/overlay/video.html) — same flat-JSON-manifest style as
// backend/avatarOverlay.js and backend/xp-data.json.
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const STATE_PATH = path.join(DATA_DIR, "videoQueue.json");
const DEFAULT_PLAYLIST_MAX_AGE_MS = 6 * 60 * 60 * 1000; // refresh cache every 6h

fs.mkdirSync(DATA_DIR, { recursive: true });

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeAll(all) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(all, null, 2));
}

const MAX_HISTORY = 20;

function emptyAccount() {
  return {
    queue: [],
    defaultPlaylistId: null,
    defaultPlaylistTitle: null,
    defaultPlaylistCache: null, // { items: [{videoId,title,thumbnail}], fetchedAt, index }
    nowPlaying: null, // { videoId, title, thumbnail, source, startedAt, paused }
    history: [], // previously-played nowPlaying entries, oldest first
    viewerRequestsEnabled: true, // !sr chat requests — the streamer's own site controls are never gated by this
    skipDefaultOnRequest: false, // a viewer !sr request skips a currently-playing default-playlist song
  };
}

function getState(twitchId) {
  const all = readAll();
  const account = all[twitchId] || emptyAccount();
  // back-compat with state saved before these fields existed
  if (!account.history) account.history = [];
  if (account.viewerRequestsEnabled === undefined) account.viewerRequestsEnabled = true;
  if (account.skipDefaultOnRequest === undefined) account.skipDefaultOnRequest = false;
  if (account.defaultPlaylistTitle === undefined) account.defaultPlaylistTitle = null;
  return account;
}

function setSettings(twitchId, { viewerRequestsEnabled, skipDefaultOnRequest } = {}) {
  const account = getState(twitchId);
  if (viewerRequestsEnabled !== undefined) account.viewerRequestsEnabled = !!viewerRequestsEnabled;
  if (skipDefaultOnRequest !== undefined) account.skipDefaultOnRequest = !!skipDefaultOnRequest;
  return saveAccount(twitchId, account);
}

function saveAccount(twitchId, account) {
  const all = readAll();
  all[twitchId] = account;
  writeAll(all);
  return account;
}

function enqueue(twitchId, { videoId, title, thumbnail, requestedBy }) {
  const account = getState(twitchId);
  account.queue.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    videoId,
    title,
    thumbnail,
    requestedBy: requestedBy || null,
    addedAt: Date.now(),
  });
  return saveAccount(twitchId, account);
}

function removeFromQueue(twitchId, itemId) {
  const account = getState(twitchId);
  account.queue = account.queue.filter((item) => item.id !== itemId);
  return saveAccount(twitchId, account);
}

function setDefaultPlaylist(twitchId, playlistId, items, title) {
  const account = getState(twitchId);
  account.defaultPlaylistId = playlistId;
  account.defaultPlaylistTitle = title || null;
  account.defaultPlaylistCache = { items, fetchedAt: Date.now(), index: 0 };
  return saveAccount(twitchId, account);
}

function isDefaultPlaylistStale(account) {
  return !account.defaultPlaylistCache || Date.now() - account.defaultPlaylistCache.fetchedAt > DEFAULT_PLAYLIST_MAX_AGE_MS;
}

// Pops the next queue item, or (if the queue is empty) rotates through the
// cached default playlist, or clears nowPlaying if neither is available.
// refreshDefaultPlaylist(playlistId) is called lazily when the cache is
// stale/missing but a defaultPlaylistId is configured.
function pushHistory(account, entry) {
  if (!entry) return;
  account.history.push(entry);
  if (account.history.length > MAX_HISTORY) account.history.shift();
}

async function advance(twitchId, { refreshDefaultPlaylist } = {}) {
  const account = getState(twitchId);
  pushHistory(account, account.nowPlaying);

  if (account.queue.length > 0) {
    const next = account.queue.shift();
    account.nowPlaying = { videoId: next.videoId, title: next.title, thumbnail: next.thumbnail, source: "queue", startedAt: Date.now(), paused: false };
    return saveAccount(twitchId, account);
  }

  if (account.defaultPlaylistId) {
    if (isDefaultPlaylistStale(account) && refreshDefaultPlaylist) {
      try {
        const items = await refreshDefaultPlaylist(account.defaultPlaylistId);
        account.defaultPlaylistCache = { items, fetchedAt: Date.now(), index: account.defaultPlaylistCache?.index || 0 };
      } catch {
        // keep using the stale cache (if any) rather than failing playback
      }
    }
    const cache = account.defaultPlaylistCache;
    if (cache && cache.items.length > 0) {
      const item = cache.items[cache.index % cache.items.length];
      cache.index = (cache.index + 1) % cache.items.length;
      account.nowPlaying = { videoId: item.videoId, title: item.title, thumbnail: item.thumbnail, source: "default", startedAt: Date.now(), paused: false };
      return saveAccount(twitchId, account);
    }
  }

  account.nowPlaying = null;
  return saveAccount(twitchId, account);
}

// Goes back to the last history entry. Whatever was currently playing (if
// anything) is put back at the front of the queue instead of being dropped.
function previous(twitchId) {
  const account = getState(twitchId);
  if (account.history.length === 0) return account;
  const prevItem = account.history.pop();
  if (account.nowPlaying) {
    account.queue.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      videoId: account.nowPlaying.videoId,
      title: account.nowPlaying.title,
      thumbnail: account.nowPlaying.thumbnail,
      requestedBy: null,
      addedAt: Date.now(),
    });
  }
  account.nowPlaying = { ...prevItem, startedAt: Date.now(), paused: false };
  return saveAccount(twitchId, account);
}

function setPaused(twitchId, paused) {
  const account = getState(twitchId);
  if (account.nowPlaying) account.nowPlaying.paused = !!paused;
  return saveAccount(twitchId, account);
}

module.exports = { getState, enqueue, removeFromQueue, setDefaultPlaylist, advance, previous, setPaused, setSettings };
