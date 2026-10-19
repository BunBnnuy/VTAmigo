// KittenTTS provider: the /tts/kitten routes and the worker module's
// no-venv behaviour.
//
// Generation itself is not exercised here — it needs the Python venv and the
// ~80 MB ONNX model, neither of which exists in CI. What is pinned down is the
// contract the frontend and the OBS overlay depend on: auth on both route
// families, the voice list, input validation, and the KITTEN_NOT_INSTALLED
// code that the route turns into a 503 (so "not installed" never surfaces as
// a generic 502).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { app } = require("../app");
const { readUsers, writeUsers, deriveKey, getOverlayToken } = require("../auth");

const TWITCH_ID = "kitten-tts-test";
const cookie = `session=${jwt.sign({ twitchId: TWITCH_ID }, deriveKey("session-jwt"), { expiresIn: "1h" })}`;

let overlayToken;

beforeAll(() => {
  writeUsers([
    ...readUsers().filter((user) => user.twitchId !== TWITCH_ID),
    { twitchId: TWITCH_ID, login: "kittentester", displayName: "Kitten Tester", approved: true, tier: "free", createdAt: new Date().toISOString() },
  ]);
  overlayToken = getOverlayToken(TWITCH_ID);
});

afterAll(() => {
  writeUsers(readUsers().filter((user) => user.twitchId !== TWITCH_ID));
});

describe("kitten routes", () => {
  it("rejects the streamer voice list without a session cookie", async () => {
    expect((await request(app).get("/tts/kitten/voices")).status).toBe(401);
  });

  it("lists the eight ONNX voices without loading the model", async () => {
    const res = await request(app).get("/tts/kitten/voices").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.voices.map((voice) => voice.id)).toEqual([
      "Bella", "Jasper", "Luna", "Bruno", "Rosie", "Hugo", "Kiki", "Leo",
    ]);
    expect(typeof res.body.installed).toBe("boolean");
  });

  it("requires text on the streamer route", async () => {
    const res = await request(app).post("/tts/kitten").set("Cookie", cookie).send({ text: "  " });
    expect(res.status).toBe(400);
  });

  it("rejects the overlay route without a token", async () => {
    const res = await request(app).post("/overlay/tts/kitten").send({ text: "hola" });
    expect(res.status).toBe(401);
  });

  it("authenticates the overlay route by token", async () => {
    const res = await request(app)
      .post(`/overlay/tts/kitten?token=${encodeURIComponent(overlayToken)}`)
      .send({ text: "" });
    // Auth passed (401 would mean the token was ignored) and validation ran.
    expect(res.status).toBe(400);
  });
});

describe("kitten module without a venv", () => {
  it("reports not-installed and refuses to generate instead of spawning", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kitten-empty-"));
    const previousDir = process.env.KITTEN_DIR;
    const modulePath = require.resolve("../kitten");
    delete require.cache[modulePath];
    process.env.KITTEN_DIR = tmp;

    try {
      const kitten = require("../kitten");
      expect(kitten.isInstalled()).toBe(false);
      await expect(kitten.generateSpeech({ text: "hola" })).rejects.toThrow(/^KITTEN_NOT_INSTALLED/);
    } finally {
      delete require.cache[modulePath];
      if (previousDir === undefined) delete process.env.KITTEN_DIR;
      else process.env.KITTEN_DIR = previousDir;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
