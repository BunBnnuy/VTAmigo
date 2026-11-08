// Watch streaks arrive as IRC USERNOTICE (msg-id=viewermilestone,
// msg-param-category=watch-streak) — Twitch's documented IRC tag path, since
// EventSub has no dedicated watch-streak subscription. These tests pin the
// parse and the event normalization; the socket itself is exercised elsewhere.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Keep the alert-sound store out of backend/data. This must be set before
// anything requires routes/streak.js (through app.js), because streakAudio
// resolves its directory at require time.
const AUDIO_TEST_DIR = path.join(os.tmpdir(), `vtamigo-streak-audio-${process.pid}`);
process.env.STREAK_AUDIO_DIR = AUDIO_TEST_DIR;

const { parseUserNotice, parseTwitchMessage } = require("../twitch");
const streaks = require("../streaks");
const viewerAvatars = require("../viewerAvatars");
const { readUsers, writeUsers, deriveKey, encryptToken, getOverlayToken } = require("../auth");
const sessions = require("../sessions");
const activity = require("../activity");

// The panel's Test button resolves the streamer's (or a typed viewer's)
// avatar through Helix; keep the suite off the network.
const avatarLookups = [];
viewerAvatars.getAvatar = async (userId) => {
  avatarLookups.push({ userId });
  return "https://cdn.example/avatar.png";
};
viewerAvatars.getAvatarByLogin = async (login) => {
  avatarLookups.push({ login });
  return String(login).toLowerCase() === "ghost" ? null : `https://cdn.example/${String(login).toLowerCase()}.png`;
};

const { app } = require("../app");

afterAll(() => {
  fs.rmSync(AUDIO_TEST_DIR, { recursive: true, force: true });
});

// Example from dev.twitch.tv/docs/irc/tags (USERNOTICE Tags), including the
// tag escaping Twitch uses inside system-msg (\s = space).
const DOC_SAMPLE =
  "@badge-info=;badges=;color=#1E90FF;display-name=TwitchDev;emotes=;flags=;" +
  "id=97459ff9-8cd9-47d0-8a81-1fa5fe1d4367;login=twitchdev;mod=0;" +
  "msg-id=viewermilestone;msg-param-category=watch-streak;" +
  "msg-param-id=a872953b-606f-410a-9970-c95b744f116c;msg-param-value=3;" +
  "room-id=197886470;subscriber=0;" +
  "system-msg=TwitchDev\\swatched\\s3\\sconsecutive\\sstreams\\sthis\\smonth\\sand\\ssparked\\sa\\swatch\\sstreak!;" +
  "tmi-sent-ts=1681057151588;user-id=141981764;user-type= " +
  ":tmi.twitch.tv USERNOTICE #twitchrivals";

describe("parseUserNotice", () => {
  it("parses a documented watch-streak notice", () => {
    const notice = parseUserNotice(DOC_SAMPLE);
    expect(notice).toMatchObject({
      msgId: "viewermilestone",
      category: "watch-streak",
      milestoneId: "a872953b-606f-410a-9970-c95b744f116c",
      streak: 3,
      username: "TwitchDev",
      login: "twitchdev",
      userId: "141981764",
      color: "#1E90FF",
      timestamp: 1681057151588,
    });
    // \s escapes are decoded for display, not left raw.
    expect(notice.systemMessage).toBe(
      "TwitchDev watched 3 consecutive streams this month and sparked a watch streak!"
    );
    expect(notice.message).toBe("");
  });

  it("keeps a viewer's optional message after the channel", () => {
    const notice = parseUserNotice(`${DOC_SAMPLE} :Aware`);
    expect(notice.message).toBe("Aware");
  });

  it("returns null for lines that aren't USERNOTICEs", () => {
    expect(parseUserNotice(":tmi.twitch.tv USERSTATE #channel")).toBeNull();
    expect(parseUserNotice("")).toBeNull();
  });

  it("still parses ordinary PRIVMSG lines after the shared tag split", () => {
    const msg = parseTwitchMessage(
      "@color=#1E90FF;display-name=PixelPanda;id=abc;user-id=42 " +
        ":pixelpanda!pixelpanda@pixelpanda.tmi.twitch.tv PRIVMSG #channel :hello there"
    );
    expect(msg).toMatchObject({
      id: "abc",
      username: "PixelPanda",
      login: "pixelpanda",
      text: "hello there",
      color: "#1E90FF",
      userId: "42",
    });
  });
});

describe("streakEventFromNotice", () => {
  it("builds the shared event shape for a real milestone", () => {
    const event = streaks.streakEventFromNotice(parseUserNotice(`${DOC_SAMPLE} :Aware`));
    expect(event).toEqual({
      id: "a872953b-606f-410a-9970-c95b744f116c",
      timestamp: 1681057151588,
      kind: "streak",
      username: "TwitchDev",
      color: "#1E90FF",
      streak: 3,
      message: "Aware",
      userId: "141981764",
      avatarUrl: null,
    });
  });

  it("ignores USERNOTICEs that aren't watch streaks", () => {
    const resub = parseUserNotice(
      "@display-name=Someone;login=someone;msg-id=resub;msg-param-cumulative-months=6;" +
        "user-id=7 :tmi.twitch.tv USERNOTICE #channel :great stream"
    );
    expect(resub.msgId).toBe("resub");
    expect(streaks.streakEventFromNotice(resub)).toBeNull();
    expect(streaks.streakEventFromNotice(null)).toBeNull();
  });

  it("rejects a notice without a usable streak count", () => {
    const notice = {
      msgId: "viewermilestone",
      category: "watch-streak",
      username: "Someone",
      streak: null,
    };
    expect(streaks.streakEventFromNotice(notice)).toBeNull();
  });

  it("falls back to the login and default color, and floors decimals", () => {
    const event = streaks.streakEventFromNotice({
      msgId: "viewermilestone",
      category: "watch-streak",
      username: "",
      login: "someone",
      streak: 4.9,
    });
    expect(event.username).toBe("someone");
    expect(event.color).toBe(streaks.DEFAULT_COLOR);
    expect(event.streak).toBe(4);
    expect(event.id).toMatch(/^streak-/);
  });
});

describe("watch-streak overlay routes", () => {
  const TWITCH_ID = "streak-overlay-test";
  let sessionCookie;

  beforeAll(() => {
    writeUsers([
      ...readUsers().filter((u) => u.twitchId !== TWITCH_ID),
      {
        twitchId: TWITCH_ID,
        login: "streaktester",
        displayName: "StreakTester",
        approved: true,
        createdAt: new Date().toISOString(),
        // Locally-valid token so getValidTwitchToken returns without a
        // network round-trip (the avatar lookup is stubbed).
        twitchAccessTokenEnc: encryptToken("fake-token"),
        twitchRefreshTokenEnc: encryptToken("fake-refresh"),
        twitchTokenExpiresAt: Date.now() + 60 * 60 * 1000,
      },
    ]);
    sessionCookie = `session=${jwt.sign({ twitchId: TWITCH_ID }, deriveKey("session-jwt"), { expiresIn: "1h" })}`;
  });

  afterAll(() => {
    writeUsers(readUsers().filter((u) => u.twitchId !== TWITCH_ID));
  });

  it("protects the overlay URL endpoint", async () => {
    const unauthenticated = await request(app).get("/streak/overlay-url");
    expect(unauthenticated.status).toBe(401);

    const response = await request(app).get("/streak/overlay-url").set("Cookie", sessionCookie);
    expect(response.status).toBe(200);
    expect(response.body.url).toContain(`/overlay/streak?token=${getOverlayToken(TWITCH_ID)}`);
  });

  it("serves the transparent overlay page to OBS without a cookie", async () => {
    const page = await request(app).get("/overlay/streak");
    expect(page.status).toBe(200);
    expect(page.text).toContain("Watch Streak Overlay");
    expect(page.text).toContain("/chat?token=");
  });

  it("fires a test alert without recording it in the activity feed", async () => {
    const before = (await request(app).get("/activity/recent").set("Cookie", sessionCookie))
      .body.events.filter((event) => event.kind === "streak").length;

    const response = await request(app)
      .post("/streak/test")
      .set("Cookie", sessionCookie)
      .send({ username: "PixelPanda", streak: 7 });
    expect(response.status).toBe(200);
    expect(response.body.event).toMatchObject({
      kind: "streak",
      username: "PixelPanda",
      streak: 7,
      avatarUrl: "https://cdn.example/pixelpanda.png",
      isTest: true,
    });

    const after = (await request(app).get("/activity/recent").set("Cookie", sessionCookie))
      .body.events.filter((event) => event.kind === "streak").length;
    expect(after).toBe(before);
  });

  it("defaults to your own name and a 5-stream milestone", async () => {
    const response = await request(app).post("/streak/test").set("Cookie", sessionCookie).send({});
    expect(response.status).toBe(200);
    expect(response.body.event.username).toBe("StreakTester");
    expect(response.body.event.streak).toBe(5);
    // With no username typed, the preview uses the streamer's own picture.
    expect(response.body.event.avatarUrl).toBe("https://cdn.example/avatar.png");
  });

  it("shows the typed viewer's picture, or the initial fallback when unknown", async () => {
    const known = await request(app)
      .post("/streak/test")
      .set("Cookie", sessionCookie)
      .send({ username: "Luhnaz", streak: 5 });
    expect(known.body.event.avatarUrl).toBe("https://cdn.example/luhnaz.png");
    expect(avatarLookups.some((lookup) => lookup.login === "Luhnaz")).toBe(true);

    // Unknown login -> no picture, so the overlay draws the initial letter
    // instead of silently reusing the streamer's avatar.
    const unknown = await request(app)
      .post("/streak/test")
      .set("Cookie", sessionCookie)
      .send({ username: "ghost" });
    expect(unknown.body.event.avatarUrl).toBeNull();
  });

  it("clamps the streak and rejects malformed usernames", async () => {
    const big = await request(app)
      .post("/streak/test")
      .set("Cookie", sessionCookie)
      .send({ username: "PixelPanda", streak: 5000 });
    expect(big.body.event.streak).toBe(999);

    const bad = await request(app)
      .post("/streak/test")
      .set("Cookie", sessionCookie)
      .send({ username: "@@@" });
    expect(bad.status).toBe(400);
  });

  it("records a real milestone through handleUserNotice", async () => {
    await sessions.handleUserNotice(TWITCH_ID, parseUserNotice(DOC_SAMPLE));
    const recorded = activity.getRecent(TWITCH_ID, 10).find((event) => event.kind === "streak");
    expect(recorded).toMatchObject({
      kind: "streak",
      username: "TwitchDev",
      streak: 3,
      avatarUrl: "https://cdn.example/avatar.png",
    });
  });

  it("stores, serves, replaces and removes the alert sound", async () => {
    const empty = await request(app).get("/streak/audio/status").set("Cookie", sessionCookie);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ hasAudio: false });

    const clip = Buffer.from("ID3 fake mp3 bytes for the overlay");
    const upload = await request(app)
      .post("/streak/audio")
      .set("Cookie", sessionCookie)
      .attach("audio", clip, { filename: "spark.mp3", contentType: "audio/mpeg" });
    expect(upload.status).toBe(200);
    expect(upload.body).toMatchObject({
      hasAudio: true,
      name: "spark.mp3",
      mime: "audio/mpeg",
      sizeBytes: clip.length,
    });

    const status = await request(app).get("/streak/audio/status").set("Cookie", sessionCookie);
    expect(status.body).toMatchObject({ hasAudio: true, name: "spark.mp3", sizeBytes: clip.length });

    const binary = await request(app).get(`/streak/audio?token=${getOverlayToken(TWITCH_ID)}`);
    expect(binary.status).toBe(200);
    expect(binary.headers["content-type"]).toMatch(/audio\/mpeg/);
    expect(Number(binary.headers["content-length"])).toBe(clip.length);

    // A replacement with a different type must not leave the old file behind.
    const replace = await request(app)
      .post("/streak/audio")
      .set("Cookie", sessionCookie)
      .attach("audio", Buffer.from("RIFF fake wav"), { filename: "spark.wav", contentType: "audio/wav" });
    expect(replace.status).toBe(200);
    expect(replace.body).toMatchObject({ hasAudio: true, name: "spark.wav", mime: "audio/wav" });

    const removed = await request(app).delete("/streak/audio").set("Cookie", sessionCookie);
    expect(removed.body).toEqual({ ok: true, hasAudio: false });
    const gone = await request(app).get(`/streak/audio?token=${getOverlayToken(TWITCH_ID)}`);
    expect(gone.status).toBe(404);
  });

  it("rejects a non-audio upload", async () => {
    const res = await request(app)
      .post("/streak/audio")
      .set("Cookie", sessionCookie)
      .attach("audio", Buffer.from("not audio"), { filename: "note.txt", contentType: "text/plain" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/MP3/);
  });

  it("requires a token or cookie for the alert-sound reads", async () => {
    expect((await request(app).get("/streak/audio/status")).status).toBe(401);
    expect((await request(app).get("/streak/audio")).status).toBe(401);
  });
});
