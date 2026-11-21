// Fish Audio end-to-end through the HTTP routes: the provider, the audio
// route and the viseme timeline. The upstream API is a local mock, so this
// runs without a key and without hitting api.fish.audio.
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

const MOCK_PORT = 41000 + Math.floor(Math.random() * 10000);
process.env.FISH_API_BASE = `http://127.0.0.1:${MOCK_PORT}`;
process.env.FISH_AUDIO_API_KEY = "route-test-key";

const { app, server } = require("../app");
const { readUsers, writeUsers, getOverlayToken } = require("../auth");

const TWITCH_ID = "test-fish-route-1";
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-insecure-session-secret";

let upstream;
let appPort;
let sessionCookie;
let lastUpstream = null;
let upstreamStatus = 200;

function wav(seconds = 0.6, sampleRate = 24000) {
  const frames = Math.floor(seconds * sampleRate);
  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate;
    const gain = t > 0.1 && t < 0.5 ? 0.5 : 0;
    data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * t) * 32767 * gain), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      lastUpstream = { url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") };
      if (upstreamStatus !== 200) {
        res.writeHead(upstreamStatus, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "upstream says no" }));
        return;
      }
      if (req.url.startsWith("/model")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ items: [{ _id: "mock-voice", title: "Mock Voice", state: "trained" }] }));
        return;
      }
      res.writeHead(200, { "Content-Type": "audio/wav" });
      res.end(wav());
    });
  });
  await new Promise((resolve) => upstream.listen(MOCK_PORT, "127.0.0.1", resolve));

  const users = readUsers().filter((u) => u.twitchId !== TWITCH_ID);
  users.push({
    twitchId: TWITCH_ID,
    login: "fishtester",
    displayName: "FishTester",
    approved: true,
    createdAt: new Date().toISOString(),
  });
  writeUsers(users);
  sessionCookie = `session=${jwt.sign({ twitchId: TWITCH_ID }, SESSION_SECRET, { expiresIn: "1h" })}`;

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  appPort = server.address().port;
});

afterAll(async () => {
  writeUsers(readUsers().filter((u) => u.twitchId !== TWITCH_ID));
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => upstream.close(resolve));
});

describe("Fish Audio routes", () => {
  it("reports the free model as configured", async () => {
    const res = await request(app).get("/tts/fish/status").set("Cookie", sessionCookie).expect(200);
    expect(res.body).toMatchObject({ configured: true, model: "s2.1-pro-free", freeTier: true });
  });

  it("lists account voices", async () => {
    const res = await request(app).get("/tts/fish/voices").set("Cookie", sessionCookie).expect(200);
    expect(res.body.voices).toEqual([expect.objectContaining({ id: "mock-voice", name: "Mock Voice" })]);
  });

  it("returns WAV audio from /tts/fish", async () => {
    const res = await request(app)
      .post("/tts/fish")
      .set("Cookie", sessionCookie)
      .send({ text: "Hola", voice: "mock-voice" })
      .expect(200);
    expect(res.headers["content-type"]).toMatch(/audio\/wav/);
    expect(res.body.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(lastUpstream.url).toBe("/v1/tts");
    expect(JSON.parse(lastUpstream.body)).toMatchObject({ text: "Hola", reference_id: "mock-voice", format: "wav" });
  });

  it("builds a viseme timeline from the Fish WAV", async () => {
    const res = await request(app)
      .post("/tts/visemes")
      .set("Cookie", sessionCookie)
      .send({ text: "Hola, ¿qué tal?", voice: "mock-voice", provider: "fish" })
      .expect(200);
    expect(res.body.provider).toBe("fish");
    expect(res.body.mime).toBe("audio/wav");
    expect(res.body.duration).toBeGreaterThan(0.5);
    expect(res.body.audio.length).toBeGreaterThan(1000);
    // The phonemizer may be absent in CI; the audio must survive either way.
    if (!res.body.warning) expect(res.body.visemes.length).toBeGreaterThan(0);
  });

  it("maps an upstream failure to 502 instead of leaking it", async () => {
    upstreamStatus = 401;
    try {
      const res = await request(app)
        .post("/tts/fish")
        .set("Cookie", sessionCookie)
        .send({ text: "Hola" })
        .expect(502);
      expect(res.body.error).toMatch(/rejected the API key/);
    } finally {
      upstreamStatus = 200;
    }
  });

  it("stays behind the auth gate", async () => {
    await request(app).post("/tts/fish").send({ text: "Hola" }).expect(401);
  });
});

describe("VRM overlay routes", () => {
  it("saves the model config by session and serves it by overlay token", async () => {
    const saved = await request(app)
      .post("/vrm-lab/config")
      .set("Cookie", sessionCookie)
      .send({
        modelUrl: "https://example.com/avatar.vrm",
        idleClip: "neutral_idle",
        autoClips: false,
        varyIdle: true,
      })
      .expect(200);
    expect(saved.body).toMatchObject({
      modelUrl: "https://example.com/avatar.vrm",
      idleClip: "neutral_idle",
      autoClips: false,
      varyIdle: true,
    });

    const bySession = await request(app).get("/vrm-lab/config").set("Cookie", sessionCookie).expect(200);
    expect(bySession.body).toMatchObject({ idleClip: "neutral_idle", autoClips: false });

    const token = getOverlayToken(TWITCH_ID);
    const byToken = await request(app)
      .get(`/overlay/vrm/config?token=${encodeURIComponent(token)}`)
      .expect(200);
    expect(byToken.body).toMatchObject({
      modelUrl: "https://example.com/avatar.vrm",
      varyIdle: true,
    });

    await request(app).get("/overlay/vrm/config").expect(401);
  });

  it("rejects a model URL that is not http(s) or a path", async () => {
    const res = await request(app)
      .post("/vrm-lab/config")
      .set("Cookie", sessionCookie)
      .send({ modelUrl: "javascript:alert(1)" })
      .expect(400);
    expect(res.body.error).toMatch(/http/);
  });

  it("builds the overlay timeline with the token instead of a session", async () => {
    const token = getOverlayToken(TWITCH_ID);
    const res = await request(app)
      .post(`/overlay/tts/visemes?token=${encodeURIComponent(token)}`)
      .send({ text: "Hola, ¿qué tal?", voice: "mock-voice", provider: "fish" })
      .expect(200);
    expect(res.body.provider).toBe("fish");
    expect(res.body.duration).toBeGreaterThan(0.5);
    if (!res.body.warning) expect(res.body.visemes.length).toBeGreaterThan(0);
  });

  it("refuses the overlay timeline without a token", async () => {
    await request(app).post("/overlay/tts/visemes").send({ text: "Hola" }).expect(401);
  });
});
