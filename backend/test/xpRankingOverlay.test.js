import request from "supertest";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { app } = require("../app");
const xp = require("../xp");
const { readUsers, writeUsers, deriveKey, getOverlayToken } = require("../auth");

const TWITCH_ID = "xp-ranking-overlay-test";
let sessionCookie;
let overlayToken;

function authCookie() {
  return `session=${jwt.sign({ twitchId: TWITCH_ID }, deriveKey("session-jwt"), { expiresIn: "1h" })}`;
}

beforeAll(() => {
  writeUsers([
    ...readUsers().filter((user) => user.twitchId !== TWITCH_ID),
    {
      twitchId: TWITCH_ID,
      login: "xprankingtester",
      displayName: "XP Ranking Tester",
      approved: true,
      tier: "free",
      createdAt: new Date().toISOString(),
    },
  ]);
  xp.reset(TWITCH_ID);
  sessionCookie = authCookie();
  overlayToken = getOverlayToken(TWITCH_ID);
});
afterAll(() => {
  xp.reset(TWITCH_ID);
  writeUsers(readUsers().filter((user) => user.twitchId !== TWITCH_ID));
});

describe("XP ranking overlay", () => {
  it("protects the streamer-only overlay URL endpoint", async () => {
    const unauthenticated = await request(app).get("/xp/ranking-overlay-url");
    expect(unauthenticated.status).toBe(401);

    const response = await request(app)
      .get("/xp/ranking-overlay-url")
      .set("Cookie", sessionCookie);
    expect(response.status).toBe(200);
    expect(response.body.url).toContain("/overlay/xp-ranking?token=");
  });

  it("serves the dedicated overlay and returns at most five users", async () => {
    for (let index = 0; index < 6; index += 1) {
      xp.addMessage(TWITCH_ID, `viewer${index}`, "mensaje para ganar experiencia", "#9147ff");
    }

    const page = await request(app).get("/overlay/xp-ranking");
    expect(page.status).toBe(200);
    expect(page.text).toContain("Top 5 del chat");

    const ranking = await request(app)
      .get(`/xp/ranking?limit=5&token=${overlayToken}`);
    expect(ranking.status).toBe(200);
    expect(ranking.body.ranking).toHaveLength(5);
    expect(ranking.body.ranking.every((user) => typeof user.level === "number")).toBe(true);
  });
});
