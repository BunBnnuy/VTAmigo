// Emote and badge enrichment for incoming Twitch chat messages.
//
// backend/twitch.js deliberately stays synchronous and network-free: it hands
// us the raw IRC `emotes` / `badges` tag strings and the room id, and this
// module turns them into resolved, renderable objects for the overlay.
//
// The output shape is deliberately StreamElements-compatible
// ({ name, type, id, gif, animated, urls: {1,2,4}, start, end } for emotes,
// { type, version, url, description } for badges) because the chat overlay's
// "bubbles" theme is a port of a StreamElements widget — keeping the contract
// identical means the renderer needs no translation layer.
//
// Resolution is SYNCHRONOUS against an in-memory cache, and cache warming is
// fire-and-forget. That's the important design choice: awaiting a fetch inside
// the message path would let a slow 7TV request reorder chat. Instead the
// first few messages after a connect render without third-party emotes and
// everything after them is complete. A dead upstream degrades to plain text
// and never breaks the feed.
const { getValidTwitchToken } = require("./auth");

const TTL_MS = 30 * 60 * 1000; // re-fetch emote/badge sets every 30 min
const FETCH_TIMEOUT_MS = 5000;

// Each cache entry: { at: epochMs, map: Map, inflight: Promise|null }
// `map` is kept from the previous successful fetch when a refresh fails, so a
// transient upstream outage doesn't blank out emotes that were already working.
const caches = {
  globalEmotes: null,
  channelEmotes: new Map(), // roomId -> entry
  globalBadges: null,
  channelBadges: new Map(), // roomId -> entry
};

const EMPTY = new Map();

async function getJson(url, headers) {
  const res = await fetch(url, {
    headers: headers || {},
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Run every provider independently: one dead API must not cost us the others.
// Tasks are merged in order, so later providers win a name collision — callers
// pass them in ASCENDING priority (ffz, bttv, 7tv), matching what most chat
// clients do when the same emote name exists in several services.
async function mergeSettled(tasks) {
  const merged = new Map();
  const results = await Promise.allSettled(tasks.map((fn) => fn()));
  for (const r of results) {
    if (r.status !== "fulfilled" || !r.value) continue;
    for (const [name, emote] of r.value) merged.set(name, emote);
  }
  return merged;
}

// ── Third-party emote providers ─────────────────────────────────────────────
// Each returns a Map<emoteName, { type, id, animated, urls }>. Emote names are
// case-sensitive on Twitch, and so is the lookup.

function sevenTvEmotes(list) {
  const out = new Map();
  for (const e of list || []) {
    const host = e.data?.host;
    if (!host?.url) continue;
    const base = host.url.startsWith("//") ? "https:" + host.url : host.url;
    const animated = !!e.data?.animated;
    out.set(e.name, {
      type: "7tv",
      id: e.id,
      animated,
      urls: { 1: `${base}/1x.webp`, 2: `${base}/2x.webp`, 4: `${base}/4x.webp` },
    });
  }
  return out;
}

async function fetch7tvGlobal() {
  const data = await getJson("https://7tv.io/v3/emote-sets/global");
  return sevenTvEmotes(data?.emotes);
}

async function fetch7tvChannel(roomId) {
  const data = await getJson(`https://7tv.io/v3/users/twitch/${encodeURIComponent(roomId)}`);
  return sevenTvEmotes(data?.emote_set?.emotes);
}

function bttvEmotes(list) {
  const out = new Map();
  for (const e of list || []) {
    if (!e?.id || !e?.code) continue;
    const base = `https://cdn.betterttv.net/emote/${e.id}`;
    out.set(e.code, {
      type: "bttv",
      id: e.id,
      animated: !!e.animated || e.imageType === "gif",
      urls: { 1: `${base}/1x`, 2: `${base}/2x`, 4: `${base}/3x` },
    });
  }
  return out;
}

async function fetchBttvGlobal() {
  return bttvEmotes(await getJson("https://api.betterttv.net/3/cached/emotes/global"));
}

async function fetchBttvChannel(roomId) {
  const data = await getJson(
    `https://api.betterttv.net/3/cached/users/twitch/${encodeURIComponent(roomId)}`
  );
  return bttvEmotes([...(data?.channelEmotes || []), ...(data?.sharedEmotes || [])]);
}

function ffzEmotes(sets) {
  const out = new Map();
  for (const set of Object.values(sets || {})) {
    for (const e of set?.emoticons || []) {
      // FFZ returns { urls: { "1": url, "2": url, "4": url } }, sometimes
      // protocol-relative, and sometimes only a subset of the three sizes.
      const src = e.animated || e.urls || {};
      const pick = (n) => {
        const u = src[n] || src[4] || src[2] || src[1];
        if (!u) return null;
        return u.startsWith("//") ? "https:" + u : u;
      };
      const u1 = pick(1);
      if (!u1) continue;
      out.set(e.name, {
        type: "ffz",
        id: String(e.id),
        animated: !!e.animated,
        urls: { 1: u1, 2: pick(2) || u1, 4: pick(4) || pick(2) || u1 },
      });
    }
  }
  return out;
}

async function fetchFfzGlobal() {
  return ffzEmotes((await getJson("https://api.frankerfacez.com/v1/set/global"))?.sets);
}

async function fetchFfzChannel(roomId) {
  const data = await getJson(
    `https://api.frankerfacez.com/v1/room/id/${encodeURIComponent(roomId)}`
  );
  return ffzEmotes(data?.sets);
}

// ── Twitch badge images (Helix) ─────────────────────────────────────────────
// Map<"set_id/version_id", { url, description }>.

function badgeMap(data) {
  const out = new Map();
  for (const set of data?.data || []) {
    for (const v of set.versions || []) {
      out.set(`${set.set_id}/${v.id}`, {
        url: v.image_url_4x || v.image_url_2x || v.image_url_1x || null,
        description: v.title || set.set_id,
      });
    }
  }
  return out;
}

async function fetchBadges(twitchId, roomId) {
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!clientId || !twitchId) return EMPTY;
  const token = await getValidTwitchToken(twitchId);
  if (!token) return EMPTY;
  const headers = { "Client-ID": clientId, Authorization: `Bearer ${token}` };
  const url = roomId
    ? `https://api.twitch.tv/helix/chat/badges?broadcaster_id=${encodeURIComponent(roomId)}`
    : "https://api.twitch.tv/helix/chat/badges/global";
  return badgeMap(await getJson(url, headers));
}

// ── Cache plumbing ──────────────────────────────────────────────────────────

// Refresh `entry` if it's missing or stale. Never throws, never awaited by the
// message path — callers only ever read entry.map, which is EMPTY until the
// first fetch resolves and keeps its last-good value if a refresh fails.
function refresh(entry, loader) {
  const now = Date.now();
  if (entry.inflight) return entry;
  // Keyed off `at`, not map size — a channel with genuinely zero BTTV emotes
  // still counts as a successful fetch and must not be re-requested per message.
  if (entry.at && now - entry.at < TTL_MS) return entry;
  entry.inflight = loader()
    .then((map) => {
      if (map && map.size) {
        entry.map = map;
        entry.at = Date.now();
      } else {
        // An empty-but-successful response is legitimate (a channel with no
        // BTTV emotes). Record the time so we don't hammer the API.
        entry.at = Date.now();
      }
    })
    .catch((err) => {
      // Back off for a fraction of the TTL rather than retrying every message.
      entry.at = Date.now() - TTL_MS + 60_000;
      console.warn("[emotes] refresh failed:", err.message);
    })
    .finally(() => {
      entry.inflight = null;
    });
  return entry;
}

function newEntry() {
  return { at: 0, map: EMPTY, inflight: null };
}

function entryFor(store, key) {
  if (store instanceof Map) {
    if (!store.has(key)) store.set(key, newEntry());
    return store.get(key);
  }
  return store;
}

// Warm the caches for a channel. Fire-and-forget: safe to call on every
// message, does nothing when the data is fresh.
function prime(roomId, twitchId) {
  if (!caches.globalEmotes) caches.globalEmotes = newEntry();
  refresh(caches.globalEmotes, () =>
    mergeSettled([fetchFfzGlobal, fetchBttvGlobal, fetch7tvGlobal])
  );

  if (!caches.globalBadges) caches.globalBadges = newEntry();
  refresh(caches.globalBadges, () => fetchBadges(twitchId, null));

  if (!roomId) return;
  refresh(entryFor(caches.channelEmotes, roomId), () =>
    mergeSettled([
      () => fetchFfzChannel(roomId),
      () => fetchBttvChannel(roomId),
      () => fetch7tvChannel(roomId),
    ])
  );
  refresh(entryFor(caches.channelBadges, roomId), () => fetchBadges(twitchId, roomId));
}

function lookupEmote(name, roomId) {
  const channel = roomId && caches.channelEmotes.get(roomId);
  if (channel && channel.map.has(name)) return channel.map.get(name);
  if (caches.globalEmotes && caches.globalEmotes.map.has(name)) {
    return caches.globalEmotes.map.get(name);
  }
  return null;
}

function lookupBadge(key, roomId) {
  const channel = roomId && caches.channelBadges.get(roomId);
  if (channel && channel.map.has(key)) return channel.map.get(key);
  if (caches.globalBadges && caches.globalBadges.map.has(key)) {
    return caches.globalBadges.map.get(key);
  }
  return null;
}

// ── Resolution ──────────────────────────────────────────────────────────────

function twitchEmoteUrls(id) {
  const base = `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark`;
  return { 1: `${base}/1.0`, 2: `${base}/2.0`, 4: `${base}/3.0` };
}

/**
 * Turn a message into a list of resolved emote occurrences.
 *
 * `start`/`end` are INCLUSIVE indices into `Array.from(text)` — i.e. code
 * points, not UTF-16 code units. That matches how Twitch numbers its own
 * `emotes` tag; using string indices directly would shift every emote that
 * follows an astral character (most emoji) by one.
 */
function resolveEmotes(text, emoteTag, roomId) {
  const chars = Array.from(text || "");
  const out = [];
  const taken = new Array(chars.length).fill(false);

  // 1. Twitch's own emotes — authoritative positions, straight from the tag.
  //    Format: "25:0-4,12-16/1902:6-10"
  for (const group of String(emoteTag || "").split("/")) {
    if (!group) continue;
    const sep = group.indexOf(":");
    if (sep < 0) continue;
    const id = group.slice(0, sep);
    for (const range of group.slice(sep + 1).split(",")) {
      const [s, e] = range.split("-").map((n) => parseInt(n, 10));
      if (!Number.isInteger(s) || !Number.isInteger(e)) continue;
      if (s < 0 || e >= chars.length || e < s) continue;
      for (let i = s; i <= e; i++) taken[i] = true;
      out.push({
        name: chars.slice(s, e + 1).join(""),
        type: "twitch",
        id,
        gif: false,
        animated: false,
        urls: twitchEmoteUrls(id),
        start: s,
        end: e,
      });
    }
  }

  // 2. Third-party emotes — matched as whole whitespace-delimited tokens,
  //    skipping anything a Twitch emote already claimed.
  let i = 0;
  while (i < chars.length) {
    if (/\s/.test(chars[i])) { i++; continue; }
    const start = i;
    while (i < chars.length && !/\s/.test(chars[i])) i++;
    const end = i - 1;
    let overlaps = false;
    for (let k = start; k <= end; k++) if (taken[k]) { overlaps = true; break; }
    if (overlaps) continue;
    const name = chars.slice(start, end + 1).join("");
    const hit = lookupEmote(name, roomId);
    if (!hit) continue;
    out.push({
      name,
      type: hit.type,
      id: hit.id,
      gif: !!hit.animated,
      animated: !!hit.animated,
      urls: hit.urls,
      start,
      end,
    });
  }

  out.sort((a, b) => a.start - b.start);
  return out;
}

/**
 * Parse the IRC `badges` tag ("broadcaster/1,subscriber/12") into renderable
 * badge objects. `url` is null when Helix hasn't been reached (or the badge is
 * unknown) — the overlay themes draw their own icon keyed off `type` anyway,
 * so a missing image degrades gracefully rather than disappearing.
 */
function resolveBadges(badgeTag, roomId) {
  const out = [];
  for (const part of String(badgeTag || "").split(",")) {
    if (!part) continue;
    const slash = part.lastIndexOf("/");
    if (slash < 0) continue;
    const type = part.slice(0, slash);
    const version = part.slice(slash + 1);
    const meta = lookupBadge(`${type}/${version}`, roomId);
    out.push({
      type,
      version,
      url: meta?.url || null,
      description: meta?.description || type,
    });
  }
  return out;
}

/**
 * Attach `emotes` and `badges` to a parsed chat message and warm the caches
 * for next time. The single entry point used by the chat pipeline.
 */
function enrich(msg, twitchId) {
  if (!msg) return msg;
  try {
    prime(msg.roomId, twitchId);
    return {
      ...msg,
      emotes: resolveEmotes(msg.text, msg.emoteTag, msg.roomId),
      badges: resolveBadges(msg.badgeTag, msg.roomId),
    };
  } catch (err) {
    console.warn("[emotes] enrich failed:", err.message);
    return { ...msg, emotes: [], badges: [] };
  }
}

module.exports = { prime, resolveEmotes, resolveBadges, enrich };
