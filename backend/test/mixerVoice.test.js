// Audio mixer + bot-voice overlay: route auth and the mixer's clamping.
//
// The streamer-facing routes are gated (explicit requireApprovedUser, since
// "/mixer" is not a PROTECTED_PREFIXES entry) and the OBS-facing state route
// authenticates with ?token=. The mixer channels are always clamped into 0..1
// and a partial blob can never drop a channel.
import request from "supertest";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { app } = require("../app");
const { readUsers, writeUsers, deriveKey, getOverlayToken } = require("../auth");
const { DEFAULT_MIXER, CHANNELS } = require("../mixer");

const TWITCH_ID = "mixer-voice-test";
const cookie = `session=${jwt.sign({ twitchId: TWITCH_ID }, deriveKey("session-jwt"), { expiresIn: "1h" })}`;

let overlayToken;

beforeAll(() => {
  writeUsers([
    ...readUsers().filter((user) => user.twitchId !== TWITCH_ID),
    { twitchId: TWITCH_ID, login: "mixertester", displayName: "Mixer Tester", approved: true, tier: "free", createdAt: new Date().toISOString() },
  ]);
  overlayToken = getOverlayToken(TWITCH_ID);
});

afterAll(() => {
  writeUsers(readUsers().filter((user) => user.twitchId !== TWITCH_ID));
});

describe("mixer routes", () => {
  it("rejects the streamer route without a session cookie", async () => {
    const res = await request(app).post("/mixer").send({ master: 0.5 });
    expect(res.status).toBe(401);
  });

  it("saves a full, clamped channel set", async () => {
    const res = await request(app)
      .post("/mixer")
      .set("Cookie", cookie)
      .send({ mixer: { master: 2, botVoice: -1, videoQueue: 0.5 } });
    expect(res.status).toBe(200);
    expect(res.body.mixer).toEqual({ ...DEFAULT_MIXER, master: 1, botVoice: 0, videoQueue: 0.5 });
  });

  it("serves the current mixer to an overlay by token", async () => {
    const res = await request(app).get(`/mixer/state?token=${encodeURIComponent(overlayToken)}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.mixer).sort()).toEqual([...CHANNELS].sort());
    expect(res.body.mixer.videoQueue).toBe(0.5);
  });

  it("rejects the overlay state route with no token and no cookie", async () => {
    expect((await request(app).get("/mixer/state")).status).toBe(401);
  });
});

describe("bot voice overlay routes", () => {
  it("serves the transparent voice page without auth", async () => {
    const res = await request(app).get("/overlay/voice");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/html/);
  });

  it("gates /tts/speak behind an approved session", async () => {
    expect((await request(app).post("/tts/speak").send({ text: "hi" })).status).toBe(401);
    const res = await request(app).post("/tts/speak").set("Cookie", cookie).send({ text: "hi" });
    expect(res.status).toBe(200);
  });

  it("gates /tts/chat-speak behind an approved session", async () => {
    expect((await request(app).post("/tts/chat-speak").send({ text: "hi" })).status).toBe(401);
    const res = await request(app).post("/tts/chat-speak").set("Cookie", cookie).send({ text: "hi" });
    expect(res.status).toBe(200);
  });

  it("gates the overlay speaking routes behind an overlay token", async () => {
    expect((await request(app).post("/overlay/tts/speaking/start")).status).toBe(401);
    const res = await request(app).post(`/overlay/tts/speaking/start?token=${encodeURIComponent(overlayToken)}`);
    expect(res.status).toBe(200);
  });
});
