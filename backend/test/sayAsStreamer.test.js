// POST /say-as-streamer used to broadcast its synthetic message straight to
// the websocket, skipping handleChat. Everything handleChat does *around* the
// broadcast was therefore skipped for the streamer's own typed messages —
// most visibly !sr, which posted to Twitch and showed up in the feed but
// queued nothing, while the same text typed in Twitch's own chat worked
// (that one arrives over the read connection and does go through handleChat).
import request from "supertest";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Swapped on the real module object before app.js is required, the CJS way —
// sessions.js calls youtube.resolveInput through the namespace, so this keeps
// the suite off the network and off the YouTube API quota.
const youtube = require("../youtube");
youtube.resolveInput = async (input) => ({
  videoId: "fake123",
  title: `resolved:${input}`,
  thumbnail: null,
});
youtube.fetchPlaylistItems = async () => [];

const { app } = require("../app");
const sessions = require("../sessions");
const videoQueue = require("../videoQueue");
const xp = require("../xp");
const { readUsers, writeUsers, deriveKey } = require("../auth");
const { db } = require("../db");

const TWITCH_ID = "say-as-streamer-test";
let sessionCookie;
const said = [];

beforeAll(() => {
  const users = readUsers().filter((u) => u.twitchId !== TWITCH_ID);
  users.push({
    twitchId: TWITCH_ID,
    login: "saytester",
    displayName: "SayTester",
    approved: true,
    createdAt: new Date().toISOString(),
  });
  writeUsers(users);
  sessionCookie = `session=${jwt.sign({ twitchId: TWITCH_ID }, deriveKey("session-jwt"), { expiresIn: "1h" })}`;

  // The route needs a live-looking session to send through; the bot client is
  // where handleSongRequest posts its confirmation.
  sessions.twitchSessions.set(TWITCH_ID, {
    login: "saytester",
    twitchClient: { say: (t) => (said.push(t), true) },
    botClient: { say: () => true },
    botUsername: null,
  });
});

afterAll(() => {
  sessions.twitchSessions.delete(TWITCH_ID);
  writeUsers(readUsers().filter((u) => u.twitchId !== TWITCH_ID));
  db.prepare(`DELETE FROM video_queue WHERE twitchId = ?`).run(TWITCH_ID);
});

// handleSongRequest is async and deliberately not awaited by handleChat (a
// slow lookup must not stall the chat feed), so the queue lands shortly after
// the response.
async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

const post = (text) => request(app).post("/say-as-streamer").set("Cookie", sessionCookie).send({ text });

const titles = () => {
  const s = videoQueue.getState(TWITCH_ID);
  return [...s.queue.map((q) => q.title), ...(s.nowPlaying ? [s.nowPlaying.title] : [])];
};

describe("POST /say-as-streamer", () => {
  it("rejects an unauthenticated caller", async () => {
    const res = await request(app).post("/say-as-streamer").send({ text: "hola" });
    expect(res.status).toBe(401);
  });

  it("requires text", async () => {
    const res = await post("");
    expect(res.status).toBe(400);
  });

  it("still posts the message to Twitch chat", async () => {
    said.length = 0;
    const res = await post("hola chat");
    expect(res.status).toBe(200);
    expect(said).toContain("hola chat");
  });

  it("runs !sr typed in the Live Chat panel, like a viewer's would be", async () => {
    db.prepare(`DELETE FROM video_queue WHERE twitchId = ?`).run(TWITCH_ID);

    const res = await post("!sr una cancion");
    expect(res.status).toBe(200);

    const queued = await waitFor(() => titles().some((t) => t === "resolved:una cancion"));
    expect(queued).toBe(true);
  });

  it("leaves ordinary messages out of the queue", async () => {
    db.prepare(`DELETE FROM video_queue WHERE twitchId = ?`).run(TWITCH_ID);

    await post("no soy un comando");
    await new Promise((r) => setTimeout(r, 150));

    expect(titles()).toHaveLength(0);
  });

  it("awards the streamer XP for typing, the same as chatting from Twitch", async () => {
    xp.reset(TWITCH_ID);
    await post("contando para xp");

    await waitFor(() => xp.getRanking(TWITCH_ID).length > 0);
    expect(xp.getRanking(TWITCH_ID).map((r) => r.username)).toContain("saytester");
  });
});
