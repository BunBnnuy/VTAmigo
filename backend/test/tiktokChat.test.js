// POST /connect-tiktok wired its message callback with the wrong arity, so
// every TikTok message threw before reaching the chat feed. These pin the
// wiring rather than the TikTok client itself, which is mocked away.
import request from "supertest";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Captures the options the route hands to the TikTok client, so the test can
// invoke onMessage exactly as the real client would.
const constructed = [];
class FakeTikTokChatClient {
  constructor(opts) {
    this.opts = opts;
    constructed.push(opts);
  }
  connect() {}
  disconnect() {}
}

// The backend is CommonJS, and routes/chat.js destructures the client at load
// time (`const { TikTokChatClient } = require("../tiktok")`). vi.mock does not
// hook a require() graph, so the substitution has to happen the CJS way:
// swap the export on the real module object *before* anything requires app.js,
// so the destructuring picks up the fake. Otherwise this suite would open a
// live TikTok connection.
const tiktok = require("../tiktok");
tiktok.TikTokChatClient = FakeTikTokChatClient;

const { app } = require("../app");
const sessions = require("../sessions");
const { readUsers, writeUsers, deriveKey } = require("../auth");
const xp = require("../xp");

const TWITCH_ID = "tiktok-wiring-test";
let sessionCookie;

beforeAll(() => {
  const users = readUsers().filter((u) => u.twitchId !== TWITCH_ID);
  users.push({
    twitchId: TWITCH_ID,
    login: "tiktoktester",
    displayName: "TikTokTester",
    approved: true,
    createdAt: new Date().toISOString(),
  });
  writeUsers(users);
  sessionCookie = `session=${jwt.sign({ twitchId: TWITCH_ID }, deriveKey("session-jwt"), { expiresIn: "1h" })}`;
});

afterAll(() => {
  const existing = sessions.getTikTokClient();
  if (existing) sessions.setTikTokClient(null);
  writeUsers(readUsers().filter((u) => u.twitchId !== TWITCH_ID));
});

describe("POST /connect-tiktok", () => {
  it("rejects an unauthenticated caller", async () => {
    const res = await request(app).post("/connect-tiktok").send({ username: "someone" });
    expect(res.status).toBe(401);
  });

  it("requires a username", async () => {
    const res = await request(app)
      .post("/connect-tiktok")
      .set("Cookie", sessionCookie)
      .send({});
    expect(res.status).toBe(400);
  });

  it("routes incoming messages to the account that opened the connection", async () => {
    constructed.length = 0;

    const res = await request(app)
      .post("/connect-tiktok")
      .set("Cookie", sessionCookie)
      .send({ username: "somestreamer" });

    expect(res.status).toBe(200);
    expect(constructed).toHaveLength(1);

    // Asserted through a persistent side effect rather than a spy: chat.js
    // destructures handleChat at load time, so spying on the sessions export
    // afterwards would not intercept the captured reference. handleChat awards
    // XP against the twitchId it is handed, so the ranking is the honest
    // witness for which account the message was attributed to.
    xp.reset(TWITCH_ID);
    constructed[0].onMessage({ username: "tiktokviewer", login: "tiktokviewer", text: "hola desde tiktok" });

    const ranked = xp.getRanking(TWITCH_ID).map((r) => r.username);
    expect(ranked).toContain("tiktokviewer");
  });

  it("does not throw when a message arrives, the way the old wiring did", () => {
    // handleChat reads msg.login; with the arguments swapped that was a
    // TypeError on the very first TikTok message of a stream.
    expect(() => {
      constructed[0].onMessage({ username: "viewer", login: "viewer", text: "otra vez" });
    }).not.toThrow();
  });
});
