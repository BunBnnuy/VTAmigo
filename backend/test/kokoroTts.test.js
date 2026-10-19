// Kokoro provider: the /tts/kokoro routes and the worker module's behaviour
// when the ONNX model is missing.
//
// Like the KittenTTS suite, generation itself needs the 338 MB model and is
// not exercised in CI. These tests pin the contract the UI and the OBS overlay
// rely on: auth on both route families, the Spanish voices, input validation,
// and the KOKORO_NOT_INSTALLED code that the route turns into a 503.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { app } = require("../app");
const { readUsers, writeUsers, deriveKey, getOverlayToken } = require("../auth");

const TWITCH_ID = "kokoro-tts-test";
const cookie = `session=${jwt.sign({ twitchId: TWITCH_ID }, deriveKey("session-jwt"), { expiresIn: "1h" })}`;

let overlayToken;

beforeAll(() => {
  writeUsers([
    ...readUsers().filter((user) => user.twitchId !== TWITCH_ID),
    { twitchId: TWITCH_ID, login: "kokorotester", displayName: "Kokoro Tester", approved: true, tier: "free", createdAt: new Date().toISOString() },
  ]);
  overlayToken = getOverlayToken(TWITCH_ID);
});

afterAll(() => {
  writeUsers(readUsers().filter((user) => user.twitchId !== TWITCH_ID));
});

describe("kokoro routes", () => {
  it("rejects the streamer voice list without a session cookie", async () => {
    expect((await request(app).get("/tts/kokoro/voices")).status).toBe(401);
  });

  it("lists the Spanish voices first, then the English ones", async () => {
    const res = await request(app).get("/tts/kokoro/voices").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.voices.slice(0, 3).map((voice) => voice.id)).toEqual(["ef_dora", "em_alex", "em_santa"]);
    expect(res.body.voices).toHaveLength(10);
    expect(typeof res.body.installed).toBe("boolean");
  });

  it("requires text on the streamer route", async () => {
    const res = await request(app).post("/tts/kokoro").set("Cookie", cookie).send({ text: "  " });
    expect(res.status).toBe(400);
  });

  it("rejects the overlay route without a token", async () => {
    const res = await request(app).post("/overlay/tts/kokoro").send({ text: "hola" });
    expect(res.status).toBe(401);
  });

  it("authenticates the overlay route by token", async () => {
    const res = await request(app)
      .post(`/overlay/tts/kokoro?token=${encodeURIComponent(overlayToken)}`)
      .send({ text: "" });
    // Auth passed (401 would mean the token was ignored) and validation ran.
    expect(res.status).toBe(400);
  });
});

describe("kokoro module without the model files", () => {
  it("reports not-installed and refuses to generate", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kokoro-empty-"));
    const previousDir = process.env.KOKORO_DIR;
    const modulePath = require.resolve("../kokoro");
    delete require.cache[modulePath];
    process.env.KOKORO_DIR = tmp;

    try {
      const kokoro = require("../kokoro");
      expect(kokoro.isInstalled()).toBe(false);
      await expect(kokoro.generateSpeech({ text: "hola" })).rejects.toThrow(/^KOKORO_NOT_INSTALLED/);
    } finally {
      delete require.cache[modulePath];
      if (previousDir === undefined) delete process.env.KOKORO_DIR;
      else process.env.KOKORO_DIR = previousDir;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
