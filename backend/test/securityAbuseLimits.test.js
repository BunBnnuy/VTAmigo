// Issues 2, 3, 12: abuse limits, admin brute-force protection, CORS allowlist.
//
// Every rate-limit burst here uses its own fake client IP via X-Forwarded-For
// (trusted because supertest peers are loopback and app.js sets trust proxy:
// loopback), so the bursts can't consume each other's budgets and can't leak
// into other suites.
import request from "supertest";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { app, getAllowedOrigins } = require("../app");
const auth = require("../auth");
const piper = require("../piper");

const TTS_USER = "security-limits-tts-user";
let sessionCookie;

beforeAll(() => {
  const users = auth.readUsers().filter((u) => u.twitchId !== TTS_USER);
  users.push({
    twitchId: TTS_USER,
    login: "securitylimits",
    displayName: "SecurityLimits",
    approved: true,
    createdAt: new Date().toISOString(),
  });
  auth.writeUsers(users);
  const token = jwt.sign({ twitchId: TTS_USER }, auth.deriveKey("session-jwt"), { expiresIn: "1h" });
  sessionCookie = `session=${token}`;
});

afterAll(() => {
  auth.writeUsers(auth.readUsers().filter((u) => u.twitchId !== TTS_USER));
});

describe("CORS allowlist (Issue 12)", () => {
  it("exposes the canonical host and localhost dev origins by default", () => {
    const origins = getAllowedOrigins();
    expect(origins).toContain("https://vtamigo.top");
    expect(origins).toContain("http://localhost:5173");
  });

  it("reflects an allowlisted origin with credentials", async () => {
    const res = await request(app).get("/health").set("Origin", "https://vtamigo.top");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("https://vtamigo.top");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("reflects the Vite dev origin", async () => {
    const res = await request(app).get("/health").set("Origin", "http://localhost:5173");
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });

  it("sends no CORS headers for a non-allowlisted origin", async () => {
    const res = await request(app).get("/health").set("Origin", "https://evil.example");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("sends no ACAO on preflight from a non-allowlisted origin", async () => {
    const res = await request(app)
      .options("/api/collect")
      .set("Origin", "https://evil.example")
      .set("Access-Control-Request-Method", "POST");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("JSON body limits (Issue 2)", () => {
  const big = "x".repeat(200 * 1024); // ~200KB: over the 100kb default, under every route exception

  it("answers 413 JSON for an oversized anonymous relay body", async () => {
    const res = await request(app)
      .post("/api/collect")
      .set("X-Forwarded-For", "10.99.20.1")
      .send({ event: "probe", data: big });
    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/too large/i);
  });

  it("still parses the larger avatar upload body (401 from the auth gate, not 413)", async () => {
    const res = await request(app)
      .post("/avatar/reactive/upload")
      .set("X-Forwarded-For", "10.99.20.2")
      .send({ slot: "speaking", dataUrl: `data:image/png;base64,${Buffer.from(big).toString("base64")}` });
    expect(res.status).toBe(401);
  });

  it("still parses the larger memory import body (401 from the auth gate, not 413)", async () => {
    const res = await request(app)
      .post("/memory/import")
      .set("X-Forwarded-For", "10.99.20.3")
      .send({ markdown: big });
    expect(res.status).toBe(401);
  });
});

describe("anonymous relay rate limits (Issue 2)", () => {
  it("answers 429 after bursting POST /api/collect", async () => {
    const ip = "10.99.21.1";
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post("/api/collect")
        .set("X-Forwarded-For", ip)
        .send({ event: "probe" });
      expect(res.status).toBe(204);
    }
    const limited = await request(app)
      .post("/api/collect")
      .set("X-Forwarded-For", ip)
      .send({ event: "probe" });
    expect(limited.status).toBe(429);
    expect(limited.body.error).toBeTruthy();
  });
});

describe("AI rate limits + Piper concurrency (Issue 2)", () => {
  it("answers 429 after bursting POST /respond (limiter runs before validation)", async () => {
    const ip = "10.99.22.1";
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/respond")
        .set("X-Forwarded-For", ip)
        .set("Cookie", sessionCookie)
        .send({});
      expect(res.status).toBe(400); // through the limiter, rejected by validation — no CLI spawned
    }
    const limited = await request(app)
      .post("/respond")
      .set("X-Forwarded-For", ip)
      .set("Cookie", sessionCookie)
      .send({});
    expect(limited.status).toBe(429);
  });

  it("rejects over-long TTS text with 400 without needing a Piper binary", async () => {
    const res = await request(app)
      .post("/tts/piper")
      .set("X-Forwarded-For", "10.99.22.2")
      .set("Cookie", sessionCookie)
      .send({ text: "x".repeat(piper.MAX_TEXT_CHARS + 1) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too long/i);
  });

  it("answers 429 when Piper is saturated", async () => {
    const original = piper.generateSpeech;
    piper.generateSpeech = () => Promise.reject(new Error("PIPER_BUSY"));
    try {
      const res = await request(app)
        .post("/tts/piper")
        .set("X-Forwarded-For", "10.99.22.2")
        .set("Cookie", sessionCookie)
        .send({ text: "hola" });
      expect(res.status).toBe(429);
    } finally {
      piper.generateSpeech = original;
    }
  });

  it("piper refuses a third concurrent job while two slots are held", async () => {
    expect(piper.tryAcquireSlot()).toBe(true);
    expect(piper.tryAcquireSlot()).toBe(true);
    try {
      await expect(piper.generateSpeech({ text: "hola" })).rejects.toThrow("PIPER_BUSY");
    } finally {
      piper.releaseSlot();
      piper.releaseSlot();
    }
  });

  it("piper rejects over-long text before touching the binary", async () => {
    await expect(piper.generateSpeech({ text: "x".repeat(piper.MAX_TEXT_CHARS + 1) })).rejects.toThrow(
      "PIPER_TEXT_TOO_LONG"
    );
  });
});

describe("admin login brute-force protection (Issue 3)", () => {
  const savedPassword = process.env.ADMIN_PASSWORD;

  beforeAll(() => {
    process.env.ADMIN_PASSWORD = "test-admin-password";
  });

  afterAll(() => {
    if (savedPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = savedPassword;
  });

  it("uses one uniform message for missing and wrong passwords", async () => {
    const wrong = await request(app)
      .post("/admin/login")
      .set("X-Forwarded-For", "10.99.23.1")
      .send({ password: "nope" });
    const missing = await request(app)
      .post("/admin/login")
      .set("X-Forwarded-For", "10.99.23.2")
      .send({});
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(wrong.body).toEqual(missing.body);
    expect(wrong.body.error).toBe("Invalid credentials");
  });

  it("warn-logs failed attempts without leaking the password", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await request(app)
        .post("/admin/login")
        .set("X-Forwarded-For", "10.99.23.3")
        .send({ password: "wrong-secret-value" });
      const logged = spy.mock.calls.flat().join(" ");
      expect(logged).toMatch(/admin\/login.*failed/i);
      expect(logged).not.toContain("wrong-secret-value");
    } finally {
      spy.mockRestore();
    }
  });

  it("answers 429 after bursting POST /admin/login", async () => {
    const ip = "10.99.23.4";
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/admin/login")
        .set("X-Forwarded-For", ip)
        .send({ password: "nope" });
      expect(res.status).toBe(401);
    }
    const limited = await request(app)
      .post("/admin/login")
      .set("X-Forwarded-For", ip)
      .send({ password: "nope" });
    expect(limited.status).toBe(429);
  });
});
