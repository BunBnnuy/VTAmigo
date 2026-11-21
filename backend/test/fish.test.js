// Fish Audio provider — network behaviour only. The module talks to
// FISH_API_BASE, so the suite points it at a local mock instead of api.fish.audio
// and never needs an API key.
import http from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const FISH_PATH = require.resolve("../fish");
let server;
let base;
let requests = [];
let routes = {};

function loadFish(env = {}) {
  vi.resetModules();
  delete require.cache[FISH_PATH];
  process.env.FISH_API_BASE = base;
  process.env.FISH_AUDIO_API_KEY = "test-key";
  delete process.env.FISH_DEFAULT_VOICE;
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return require("../fish");
}

function wav(seconds = 0.2, sampleRate = 24000) {
  const frames = Math.floor(seconds * sampleRate);
  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) data.writeInt16LE(Math.round(Math.sin(i / 4) * 8000), i * 2);
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
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      const route = routes[req.url?.split("?")[0]] || {};
      const status = route.status || 200;
      if (status !== 200) {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: route.message || `upstream ${status}` }));
        return;
      }
      if (route.json) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(route.json));
        return;
      }
      const audio = route.audio || wav();
      res.writeHead(200, { "Content-Type": "audio/wav" });
      res.end(audio);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  requests = [];
  routes = {};
});

describe("fish provider", () => {
  it("posts the free model, wav format and reference id", async () => {
    const fish = loadFish();
    expect(fish.isConfigured()).toBe(true);
    expect(fish.status()).toMatchObject({ configured: true, model: "s2.1-pro-free", freeTier: true });

    const audio = await fish.generateSpeech({ text: "Hola", voice: "voice-123", speed: 1.1 });
    expect(audio.toString("ascii", 0, 4)).toBe("RIFF");

    expect(requests).toHaveLength(1);
    const [call] = requests;
    expect(call.url).toBe("/v1/tts");
    expect(call.headers.authorization).toBe("Bearer test-key");
    expect(call.headers.model).toBe("s2.1-pro-free");
    const body = JSON.parse(call.body);
    expect(body).toMatchObject({
      text: "Hola",
      format: "wav",
      reference_id: "voice-123",
      sample_rate: 24000,
      prosody: { speed: 1.1 },
    });
  });

  it("refuses to call the API without a key", async () => {
    const fish = loadFish({ FISH_AUDIO_API_KEY: undefined, FISH_API_KEY: undefined });
    expect(fish.isConfigured()).toBe(false);
    await expect(fish.generateSpeech({ text: "Hola" })).rejects.toThrow("FISH_NOT_CONFIGURED");
    expect(requests).toHaveLength(0);
  });

  it("rejects text over the cap before spending a request", async () => {
    const fish = loadFish();
    await expect(fish.generateSpeech({ text: "x".repeat(1001) })).rejects.toThrow("FISH_TEXT_TOO_LONG");
    expect(requests).toHaveLength(0);
  });

  it("surfaces upstream auth, balance and rate-limit failures with their code", async () => {
    const fish = loadFish();
    routes["/v1/tts"] = { status: 401, message: "bad key" };
    await expect(fish.generateSpeech({ text: "Hola" })).rejects.toThrow(/FISH_HTTP_401/);

    routes["/v1/tts"] = { status: 402, message: "no balance" };
    await expect(fish.generateSpeech({ text: "Hola" })).rejects.toThrow(/FISH_HTTP_402: no balance/);

    routes["/v1/tts"] = { status: 429, message: "slow down" };
    await expect(fish.generateSpeech({ text: "Hola" })).rejects.toThrow(/FISH_HTTP_429/);
  });

  it("rejects a 200 response that is not a WAV", async () => {
    const fish = loadFish();
    routes["/v1/tts"] = { audio: Buffer.from('{"error":"nope"}') };
    await expect(fish.generateSpeech({ text: "Hola" })).rejects.toThrow("FISH_BAD_AUDIO");
  });

  it("lists account voices and caches them", async () => {
    const fish = loadFish();
    routes["/model"] = {
      json: {
        items: [
          { _id: "voice-a", title: "Alicia", languages: ["es"], state: "trained" },
          { _id: "voice-b", title: "Bruno", languages: ["es"], state: "trained" },
        ],
      },
    };
    const first = await fish.listVoices();
    expect(first).toEqual([
      { id: "voice-a", name: "Alicia", languages: ["es"], state: "trained", source: "account" },
      { id: "voice-b", name: "Bruno", languages: ["es"], state: "trained", source: "account" },
    ]);
    // Two upstream calls: account clones + licensed library voices. The mock
    // returns the same ids for both, so the de-dupe keeps two entries.
    expect(requests).toHaveLength(2);
    expect(requests[0].url).toContain("self=true");
    expect(requests[1].url).toContain("licensed=true");
    expect(first.map((v) => v.id)).toEqual(["voice-a", "voice-b"]);

    const second = await fish.listVoices();
    expect(second).toEqual(first);
    expect(requests).toHaveLength(2); // served from the cache
  });

  it("returns no voices when unconfigured", async () => {
    const fish = loadFish({ FISH_AUDIO_API_KEY: undefined, FISH_API_KEY: undefined });
    expect(await fish.listVoices()).toEqual([]);
    expect(requests).toHaveLength(0);
  });
});
