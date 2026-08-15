// POST /avatar/speaking/start|stop — the *only* driver of the avatar overlay.
//
// These were POST /lipsync/start|stop before the desktop-legacy purge, and
// they did two unrelated things: move a VTube Studio model (mouth phonemes,
// head bob) and broadcast { type: "tts_state", playing } over the /chat
// WebSocket. Only the VTS half was desktop-only. The broadcast is what
// backend/overlay/avatar.html listens on to swap between the streamer's
// uploaded speaking/silent images — every account with the avatar overlay in
// OBS depends on it, and there is no other source for that signal.
//
// So this suite drives the routes with a real WebSocket client attached to
// the real server and asserts the message actually arrives. If someone ever
// "simplifies" these handlers away with the VTS code, the avatar goes mute
// site-wide and these tests are what catch it.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import WebSocket from "ws";

const { app, server } = require("../app");
const { readUsers, writeUsers, getOverlayToken } = require("../auth");

const TWITCH_ID = "test-avatar-speaking-1";
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-insecure-session-secret";

let port;
let sessionCookie;

// Waits for the next parsed WS message matching `type`, so unrelated traffic
// on the shared /chat socket can't make the assertion flaky.
function nextMessage(ws, type, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error(`timed out waiting for a "${type}" message`));
    }, timeoutMs);
    function onMessage(raw) {
      let data;
      try { data = JSON.parse(raw.toString()); } catch { return; }
      if (data.type !== type) return;
      clearTimeout(timer);
      ws.off("message", onMessage);
      resolve(data);
    }
    ws.on("message", onMessage);
  });
}

// Connects the way the OBS overlay does — with ?token=, not a cookie, since
// OBS's Browser Source is a separate CEF instance with no access to the
// streamer's session.
function connectOverlay() {
  const token = getOverlayToken(TWITCH_ID);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/chat?token=${token}`);
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

beforeAll(async () => {
  const users = readUsers().filter((u) => u.twitchId !== TWITCH_ID);
  users.push({
    twitchId: TWITCH_ID,
    login: "avatartester",
    displayName: "AvatarTester",
    approved: true,
    createdAt: new Date().toISOString(),
  });
  writeUsers(users);
  sessionCookie = `session=${jwt.sign({ twitchId: TWITCH_ID }, SESSION_SECRET, { expiresIn: "1h" })}`;

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

afterAll(async () => {
  writeUsers(readUsers().filter((u) => u.twitchId !== TWITCH_ID));
  await new Promise((resolve) => server.close(resolve));
});

describe("avatar speaking state", () => {
  it("POST /avatar/speaking/start answers 200 and broadcasts tts_state playing:true", async () => {
    const ws = await connectOverlay();
    const message = nextMessage(ws, "tts_state");

    const res = await request(app)
      .post("/avatar/speaking/start")
      .set("Cookie", sessionCookie)
      .send({ text: "hola chat", durationMs: 1200 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    await expect(message).resolves.toEqual({ type: "tts_state", playing: true });
    ws.close();
  });

  it("POST /avatar/speaking/stop broadcasts tts_state playing:false", async () => {
    const ws = await connectOverlay();
    const message = nextMessage(ws, "tts_state");

    const res = await request(app)
      .post("/avatar/speaking/stop")
      .set("Cookie", sessionCookie)
      .send({});

    expect(res.status).toBe(200);
    await expect(message).resolves.toEqual({ type: "tts_state", playing: false });
    ws.close();
  });

  it("still broadcasts with no VTube Studio anywhere in the process", async () => {
    // The point of the rename: the old handler bailed out to the VTS context
    // for everything past the broadcast. Nothing VTS-shaped exists now, and
    // the avatar signal still lands.
    expect(() => require("../vtubeManager")).toThrow();

    const ws = await connectOverlay();
    const message = nextMessage(ws, "tts_state");
    await request(app)
      .post("/avatar/speaking/start")
      .set("Cookie", sessionCookie)
      .send({ text: "sigue funcionando", durationMs: 800 });
    await expect(message).resolves.toMatchObject({ playing: true });
    ws.close();
  });

  it("rejects a start without text/durationMs", async () => {
    const res = await request(app)
      .post("/avatar/speaking/start")
      .set("Cookie", sessionCookie)
      .send({});
    expect(res.status).toBe(400);
  });

  // Auth regression guard for the rename: "/lipsync" used to be the entry in
  // PROTECTED_PREFIXES that put requireApprovedUser in front of these
  // handlers, and they read req.user.twitchId. Renaming the routes without
  // adding "/avatar" to that list would leave them wide open (and crashing on
  // an undefined req.user).
  it("requires an approved session — 401 without a cookie", async () => {
    for (const path of ["/avatar/speaking/start", "/avatar/speaking/stop"]) {
      const res = await request(app).post(path).send({ text: "x", durationMs: 100 });
      expect(res.status).toBe(401);
    }
  });

  // The flip side: the overlay page itself must stay public, because OBS
  // can't send the session cookie. "/avatar" as a protected prefix must not
  // accidentally swallow "/overlay/avatar".
  it("leaves the OBS overlay page and image route reachable without a cookie", async () => {
    const page = await request(app).get("/overlay/avatar");
    expect(page.status).toBe(200);
    expect(page.text).toContain("tts_state");

    // No token, no cookie -> the route's own inline auth answers, which is
    // 401 rather than the blanket gate. It's reachable, which is the point.
    const image = await request(app).get("/overlay/avatar/image?slot=speaking");
    expect(image.status).toBe(401);
  });
});
