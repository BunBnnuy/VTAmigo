// !so <username>: mod/streamer-only shoutouts. These tests cover the three
// pieces that are easy to break in isolation — the pure clip picker, the
// per-account config sanitizer, and the permission/error handling around the
// command — without touching the network (twitchClips.lookupClips is stubbed,
// the CJS way, before sessions.js is required).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const twitchClips = require("../twitchClips");

const CLIPS = [
  { id: "newest", slug: "newest", title: "Newest", duration: 20, views: 10, createdAt: 3000, url: "u1" },
  { id: "middle", slug: "middle", title: "Middle", duration: 25, views: 100, createdAt: 2000, url: "u2" },
  { id: "oldest", slug: "oldest", title: "Oldest", duration: 30, views: 50, createdAt: 1000, url: "u3" },
];

// Clips that only exist outside the 30-day window, used to exercise the
// "nothing recent -> all-time top-random" fallback.
const OLD_CLIPS = [
  { id: "old_top", slug: "old_top", title: "Old Top", duration: 15, views: 999, createdAt: 1, url: "o1" },
  { id: "old_low", slug: "old_low", title: "Old Low", duration: 15, views: 1, createdAt: 2, url: "o2" },
];

// Records the options each lookup/fetch was called with, so tests can assert
// that the recent modes actually window the Helix query by date and that the
// fallback re-fetches without a window.
const lookupCalls = [];
const fetchCalls = [];

twitchClips.lookupClips = async (login, token, options = {}) => {
  lookupCalls.push({ login, options });
  if (login === "ghost") throw new twitchClips.ShoutoutError("SHOUTOUT_USER_NOT_FOUND");
  if (login === "noclips") return { user: { id: "2", login, displayName: "NoClips" }, clips: [] };
  if (login === "oldonly") {
    return { user: { id: "3", login, displayName: "OldOnly" }, clips: options.startedAt ? [] : OLD_CLIPS };
  }
  return {
    user: { id: "1", login, displayName: "Target", profileImageUrl: "https://cdn.example/pic.png" },
    clips: CLIPS,
  };
};

// Only reached by the "nothing recent" fallback, which re-fetches unwindowed.
twitchClips.fetchClips = async (broadcasterId, token, options = {}) => {
  fetchCalls.push({ broadcasterId, options });
  return broadcasterId === "2" ? [] : OLD_CLIPS;
};

function lastLookup(login) {
  return [...lookupCalls].reverse().find((c) => c.login === login);
}
// Keep the suite off Twitch's GraphQL: the real function is best-effort and
// returns null on failure, which is exactly the fallback path.
twitchClips.fetchPlaybackUrl = async (slug) => `https://cdn.example/${slug}.mp4?token=t&sig=s`;

const sessions = require("../sessions");
const shoutout = require("../shoutout");
const { readUsers, writeUsers, encryptToken } = require("../auth");
const { db } = require("../db");

const TWITCH_ID = "shoutout-test";
const said = [];

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

beforeAll(() => {
  const users = readUsers().filter((u) => u.twitchId !== TWITCH_ID);
  users.push({
    twitchId: TWITCH_ID,
    login: "shoutstreamer",
    displayName: "ShoutStreamer",
    approved: true,
    createdAt: new Date().toISOString(),
    // A locally-valid token so getValidTwitchToken returns without a network
    // round-trip (it only refreshes once we're within 5 min of expiry).
    twitchAccessTokenEnc: encryptToken("fake-token"),
    twitchRefreshTokenEnc: encryptToken("fake-refresh"),
    twitchTokenExpiresAt: Date.now() + 60 * 60 * 1000,
  });
  writeUsers(users);

  sessions.twitchSessions.set(TWITCH_ID, {
    login: "shoutstreamer",
    twitchClient: { say: () => true },
    botClient: { say: (t) => (said.push(t), true) },
    botUsername: null,
  });
});

afterAll(() => {
  sessions.twitchSessions.delete(TWITCH_ID);
  writeUsers(readUsers().filter((u) => u.twitchId !== TWITCH_ID));
  db.prepare(`DELETE FROM shoutout_config WHERE twitchId = ?`).run(TWITCH_ID);
  shoutout.clearActive(TWITCH_ID);
});

function chat(text, badgeTag, username = "a_mod") {
  sessions.handleChat(TWITCH_ID, {
    id: `t-${Math.random()}`,
    username,
    login: username,
    text,
    color: "#9147ff",
    timestamp: Date.now(),
    badgeTag,
    emoteTag: "",
    roomId: TWITCH_ID,
    isHype: false,
    isRedeem: false,
  });
}

describe("shoutout config", () => {
  it("defaults to a random recent clip with the banner on", () => {
    const config = shoutout.getConfig(TWITCH_ID);
    expect(config.mode).toBe("recent-random");
    expect(config.showBanner).toBe(true);
    expect(config.bannerText).toContain("{username}");
  });

  it("rejects an unknown mode instead of persisting it", () => {
    shoutout.setConfig(TWITCH_ID, { mode: "wat" });
    expect(shoutout.getConfig(TWITCH_ID).mode).toBe("recent-random");
  });

  it("persists a valid mode and a custom banner", () => {
    shoutout.setConfig(TWITCH_ID, { mode: "top-random", showBanner: false, bannerText: "Go {username}" });
    const config = shoutout.getConfig(TWITCH_ID);
    expect(config.mode).toBe("top-random");
    expect(config.showBanner).toBe(false);
    expect(shoutout.bannerFor(config, "Someone")).toBe("Go Someone");
  });

  it("accepts valid styling but rejects an invalid color/font/shape", () => {
    shoutout.setConfig(TWITCH_ID, {
      messageBg: "#ff0000",
      messageColor: "#00ff00",
      messageFont: "Bangers",
      avatarShape: "square",
      showAvatar: false,
    });
    let config = shoutout.getConfig(TWITCH_ID);
    expect(config.messageBg).toBe("#ff0000");
    expect(config.messageColor).toBe("#00ff00");
    expect(config.messageFont).toBe("Bangers");
    expect(config.avatarShape).toBe("square");
    expect(config.showAvatar).toBe(false);

    shoutout.setConfig(TWITCH_ID, {
      messageBg: "red; } .x {",
      messageFont: "Comic Sans",
      avatarShape: "triangle",
    });
    config = shoutout.getConfig(TWITCH_ID);
    expect(config.messageBg).toBe("#ff0000"); // unchanged
    expect(config.messageFont).toBe("Bangers"); // unchanged
    expect(config.avatarShape).toBe("square"); // unchanged
  });
});

describe("clipVideoUrl", () => {
  it("derives the public mp4 from a Helix clip thumbnail", () => {
    expect(
      twitchClips.clipVideoUrl("https://clips-media-assets2.twitch.tv/AT-cm%7Cabc-preview-480x272.jpg")
    ).toBe("https://clips-media-assets2.twitch.tv/AT-cm%7Cabc.mp4");
  });

  it("returns null for anything that isn't a clip preview frame", () => {
    expect(twitchClips.clipVideoUrl("https://example.com/thumb.jpg")).toBeNull();
    expect(twitchClips.clipVideoUrl(undefined)).toBeNull();
  });

  it("normalizeClip attaches the mp4Url alongside the metadata", () => {
    const clip = twitchClips.normalizeClip({
      id: "Slug123",
      thumbnail_url: "https://clips-media-assets2.twitch.tv/abc-preview-480x272.jpg",
      duration: "12.5",
      view_count: 3,
      created_at: "2024-01-01T00:00:00Z",
    });
    expect(clip.mp4Url).toBe("https://clips-media-assets2.twitch.tv/abc.mp4");
    expect(clip.slug).toBe("Slug123");
    expect(clip.duration).toBe(12.5);
  });
});

describe("clip playback url", () => {
  it("picks the highest numeric quality", () => {
    expect(
      twitchClips.bestQualityUrl([
        { quality: "360", sourceURL: "u360" },
        { quality: "720", sourceURL: "u720" },
        { quality: "480", sourceURL: "u480" },
      ])
    ).toBe("u720");
  });

  it("ignores audio-only and empty entries", () => {
    expect(twitchClips.bestQualityUrl([{ quality: "audio_only", sourceURL: "a" }, { quality: "480", sourceURL: "u" }])).toBe("u");
    expect(twitchClips.bestQualityUrl([])).toBeNull();
    expect(twitchClips.bestQualityUrl(null)).toBeNull();
  });

  it("builds the signed URL Twitch's own player uses", () => {
    expect(twitchClips.buildPlaybackUrl("https://cdn/x.mp4", '{"a":1}', "sig")).toBe(
      `https://cdn/x.mp4?token=${encodeURIComponent('{"a":1}')}&sig=sig`
    );
    expect(twitchClips.buildPlaybackUrl("https://cdn/x.mp4", null, "sig")).toBeNull();
  });
});

describe("recent window", () => {
  it("covers exactly the last 30 days, end = now", () => {
    const now = Date.parse("2026-09-24T00:00:00Z");
    const w = shoutout.recentWindow(now);
    expect(w.endedAt).toBe(new Date(now).toISOString());
    expect((now - Date.parse(w.startedAt)) / (24 * 60 * 60 * 1000)).toBeCloseTo(30, 5);
  });

  it("applies to the recent modes only", () => {
    expect(shoutout.usesRecentWindow("recent-random")).toBe(true);
    expect(shoutout.usesRecentWindow("most-recent")).toBe(true);
    expect(shoutout.usesRecentWindow("top-random")).toBe(false);
  });
});

describe("pickClip", () => {
  it("returns null for an empty channel", () => {
    expect(shoutout.pickClip([], "recent-random")).toBeNull();
  });

  it("most-recent returns the newest clip regardless of views", () => {
    expect(shoutout.pickClip(CLIPS, "most-recent").id).toBe("newest");
  });

  it("recent-random always returns a clip from the list", () => {
    for (let i = 0; i < 50; i++) {
      expect(CLIPS.map((c) => c.id)).toContain(shoutout.pickClip(CLIPS, "recent-random").id);
    }
  });

  it("top-random never picks from outside the most-viewed sample", () => {
    // 30 clips, only the top 25 by views are eligible (pickClip's sample cap).
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: `c${i}`, views: i, createdAt: i,
    }));
    const floor = many.map((c) => c.views).sort((a, b) => b - a)[24];
    for (let i = 0; i < 200; i++) {
      expect(shoutout.pickClip(many, "top-random").views).toBeGreaterThanOrEqual(floor);
    }
  });
});

describe("isModOrBroadcaster", () => {
  it("accepts the raw IRC badge tag", () => {
    expect(sessions.isModOrBroadcaster("broadcaster/1")).toBe(true);
    expect(sessions.isModOrBroadcaster("subscriber/12,moderator/1")).toBe(true);
  });

  it("rejects everyone else, including missing tags", () => {
    expect(sessions.isModOrBroadcaster("subscriber/12")).toBe(false);
    expect(sessions.isModOrBroadcaster("")).toBe(false);
    expect(sessions.isModOrBroadcaster(undefined)).toBe(false);
  });

  it("also accepts an already-enriched badges array", () => {
    expect(sessions.isModOrBroadcaster([{ type: "moderator", version: "1" }])).toBe(true);
    expect(sessions.isModOrBroadcaster([{ type: "subscriber", version: "12" }])).toBe(false);
  });
});

describe("!so handling", () => {
  // The config describe above mutates this account's config; reset it so the
  // payload/windowing assertions below always start from the defaults.
  beforeEach(() => shoutout.setConfig(TWITCH_ID, { ...shoutout.DEFAULTS }));

  it("broadcasts a shoutout for a moderator", async () => {
    said.length = 0;
    shoutout.clearActive(TWITCH_ID);
    chat("!so target", "moderator/1");

    const ran = await waitFor(() => shoutout.getActive(TWITCH_ID) !== null);
    expect(ran).toBe(true);
    const active = shoutout.getActive(TWITCH_ID);
    expect(active.username).toBe("Target");
    expect(active.clip.id).toBeDefined();
    // The GraphQL playback URL is attached so the overlay can avoid the embed.
    expect(active.clip.mp4Url).toContain("cdn.example");
    // Styling + channel icon travel with the payload for the overlay layout.
    expect(active.avatarUrl).toContain("cdn.example");
    expect(active.showAvatar).toBe(true);
    expect(active.avatarShape).toBe("circle");
    expect(active.messageBg).toBe("#9147ff");
    expect(active.messageColor).toBe("#ffffff");
    expect(active.messageFont).toBe("Quicksand");
    expect(active.endsAt).toBeGreaterThan(Date.now());
    expect(said.some((s) => s.includes("Shoutout to Target"))).toBe(true);
  });

  it("windows the Helix query to the last 30 days for recent modes, but not top-random", async () => {
    lookupCalls.length = 0;
    await sessions.handleShoutout(TWITCH_ID, "shoutstreamer", "target", { announce: false });
    const recent = lastLookup("target").options;
    expect(recent.startedAt).toBeTruthy();
    expect(recent.endedAt).toBeTruthy();

    shoutout.setConfig(TWITCH_ID, { mode: "top-random" });
    lookupCalls.length = 0;
    await sessions.handleShoutout(TWITCH_ID, "shoutstreamer", "target", { announce: false });
    expect(lastLookup("target").options.startedAt).toBeUndefined();
  });

  it("ignores !so from a regular viewer, silently", async () => {
    said.length = 0;
    shoutout.clearActive(TWITCH_ID);
    chat("!so target", "subscriber/12", "viewer");

    await new Promise((r) => setTimeout(r, 150));
    expect(shoutout.getActive(TWITCH_ID)).toBeNull();
    expect(said).toHaveLength(0);
  });

  it("tells the mod when the channel doesn't exist", async () => {
    said.length = 0;
    shoutout.clearActive(TWITCH_ID);
    chat("!so ghost", "broadcaster/1");

    await waitFor(() => said.some((s) => s.includes("couldn't find")));
    expect(shoutout.getActive(TWITCH_ID)).toBeNull();
  });

  it("reports no clips when the channel has none at all", async () => {
    said.length = 0;
    shoutout.clearActive(TWITCH_ID);
    chat("!so noclips", "moderator/1");

    await waitFor(() => said.some((s) => s.includes("has no clips to shout out yet")));
    expect(shoutout.getActive(TWITCH_ID)).toBeNull();
  });

  it("falls back to top-random when nothing was clipped in the last 30 days", async () => {
    said.length = 0;
    shoutout.clearActive(TWITCH_ID);
    lookupCalls.length = 0;
    fetchCalls.length = 0;

    chat("!so oldonly", "moderator/1");

    const ran = await waitFor(() => shoutout.getActive(TWITCH_ID) !== null);
    expect(ran).toBe(true);
    // Windowed attempt first, then an unwindowed re-fetch for the fallback.
    expect(lastLookup("oldonly").options.startedAt).toBeTruthy();
    expect(fetchCalls.some((c) => c.broadcasterId === "3" && c.options.startedAt === undefined)).toBe(true);
    expect(OLD_CLIPS.map((c) => c.id)).toContain(shoutout.getActive(TWITCH_ID).clip.id);
  });

  it("treats a malformed username as a usage error", async () => {
    said.length = 0;
    shoutout.clearActive(TWITCH_ID);
    chat("!so @@@", "moderator/1");
    await waitFor(() => said.some((s) => s.includes("usage")));
    expect(shoutout.getActive(TWITCH_ID)).toBeNull();
  });
});

describe("handleShoutout (panel test path)", () => {
  it("triggers without posting to chat when announce is false", async () => {
    said.length = 0;
    shoutout.clearActive(TWITCH_ID);
    const result = await sessions.handleShoutout(TWITCH_ID, "shoutstreamer", "target", { announce: false });
    expect(result.ok).toBe(true);
    expect(shoutout.getActive(TWITCH_ID)).not.toBeNull();
    expect(said).toHaveLength(0);
  });

  it("reports a bad username without touching Twitch", async () => {
    const result = await sessions.handleShoutout(TWITCH_ID, "shoutstreamer", "not valid!", { announce: false });
    expect(result).toEqual({ ok: false, error: "BAD_USERNAME" });
  });
});
