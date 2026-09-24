// !so <username>: mod/streamer-only shoutouts. These tests cover the three
// pieces that are easy to break in isolation — the pure clip picker, the
// per-account config sanitizer, and the permission/error handling around the
// command — without touching the network (twitchClips.lookupClips is stubbed,
// the CJS way, before sessions.js is required).
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const twitchClips = require("../twitchClips");

const CLIPS = [
  { id: "newest", slug: "newest", title: "Newest", duration: 20, views: 10, createdAt: 3000, url: "u1" },
  { id: "middle", slug: "middle", title: "Middle", duration: 25, views: 100, createdAt: 2000, url: "u2" },
  { id: "oldest", slug: "oldest", title: "Oldest", duration: 30, views: 50, createdAt: 1000, url: "u3" },
];

twitchClips.lookupClips = async (login) => {
  if (login === "ghost") throw new twitchClips.ShoutoutError("SHOUTOUT_USER_NOT_FOUND");
  if (login === "noclips") return { user: { id: "2", login, displayName: "NoClips" }, clips: [] };
  return { user: { id: "1", login, displayName: "Target" }, clips: CLIPS };
};
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
    expect(active.endsAt).toBeGreaterThan(Date.now());
    expect(said.some((s) => s.includes("Shoutout to Target"))).toBe(true);
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

  it("tells the mod when the channel has no clips", async () => {
    said.length = 0;
    shoutout.clearActive(TWITCH_ID);
    chat("!so noclips", "moderator/1");

    await waitFor(() => said.some((s) => s.includes("no clips")));
    expect(shoutout.getActive(TWITCH_ID)).toBeNull();
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
