// Security Issue 4: the Twitch bot token must never be stored in plaintext —
// neither in the user_settings SQLite copy synced by POST /settings, nor
// served back by GET /settings. Real bot tokens live only in the encrypted
// users-table columns via the /bot-link OAuth flow (auth.js
// setBotTwitchTokens). The manual pasted-token endpoints are gone with it.
import request from "supertest";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { app } = require("../app");
const sessions = require("../sessions");
const { readUsers, writeUsers, deriveKey } = require("../auth");
const { db } = require("../db");
const userSettings = require("../userSettings");

const TWITCH_ID = "settings-credentials-test";
let sessionCookie;

const authed = (method, path) => request(app)[method](path).set("Cookie", sessionCookie);
const rawRow = () =>
  db.prepare(`SELECT settings FROM user_settings WHERE twitchId = ?`).get(TWITCH_ID)?.settings;
const seedLegacyRow = (settings) =>
  db
    .prepare(
      `INSERT INTO user_settings (twitchId, settings, updatedAt) VALUES (?, ?, ?)
       ON CONFLICT(twitchId) DO UPDATE SET settings = excluded.settings, updatedAt = excluded.updatedAt`
    )
    .run(TWITCH_ID, JSON.stringify(settings), new Date().toISOString());

beforeAll(() => {
  const users = readUsers().filter((u) => u.twitchId !== TWITCH_ID);
  users.push({
    twitchId: TWITCH_ID,
    login: "settingscredtester",
    displayName: "SettingsCredTester",
    approved: true,
    createdAt: new Date().toISOString(),
  });
  writeUsers(users);
  sessionCookie = `session=${jwt.sign({ twitchId: TWITCH_ID }, deriveKey("session-jwt"), { expiresIn: "1h" })}`;
  db.prepare(`DELETE FROM user_settings WHERE twitchId = ?`).run(TWITCH_ID);
});

afterAll(() => {
  sessions.twitchSessions.delete(TWITCH_ID);
  db.prepare(`DELETE FROM user_settings WHERE twitchId = ?`).run(TWITCH_ID);
  writeUsers(readUsers().filter((u) => u.twitchId !== TWITCH_ID));
});

describe("POST /settings strips credential keys", () => {
  it("does not persist botToken/botUsername sent by a stale client", async () => {
    const res = await authed("post", "/settings").send({
      language: "en",
      batchWindow: 20,
      botToken: "oauth:super-secret-token",
      botUsername: "somebot",
      accessToken: "attacker-value",
      refreshToken: "attacker-value",
    });
    expect(res.status).toBe(200);

    const stored = userSettings.getSettings(TWITCH_ID);
    expect(stored).toMatchObject({ language: "en", batchWindow: 20 });
    for (const key of ["botToken", "botUsername", "accessToken", "refreshToken"]) {
      expect(stored).not.toHaveProperty(key);
    }
    // The secret must not appear anywhere in the raw SQLite row either.
    expect(rawRow()).not.toContain("oauth:super-secret-token");
    expect(rawRow()).not.toContain("botToken");
  });

  it("GET /settings never serves credential keys", async () => {
    const res = await authed("get", "/settings");
    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({ language: "en" });
    for (const key of ["botToken", "botUsername", "accessToken", "refreshToken"]) {
      expect(res.body.settings).not.toHaveProperty(key);
    }
  });

  it("scrubs legacy rows that still carry a plaintext token, on read", async () => {
    seedLegacyRow({ language: "en", botToken: "oauth:legacy-token", botUsername: "oldbot" });

    const res = await authed("get", "/settings");
    expect(res.status).toBe(200);
    expect(res.body.settings).not.toHaveProperty("botToken");
    expect(res.body.settings).not.toHaveProperty("botUsername");
    // One-time cleanup: the row itself is rewritten without the secret.
    expect(rawRow()).not.toContain("oauth:legacy-token");
    expect(rawRow()).not.toContain("botToken");
  });

  it("still rejects a non-object body with 400", async () => {
    const res = await authed("post", "/settings").send(["not", "an", "object"]);
    expect(res.status).toBe(400);
  });
});

describe("sanitizeSettings unit", () => {
  it("drops every credential key but keeps real settings", () => {
    const clean = userSettings.sanitizeSettings({
      language: "es",
      botToken: "oauth:x",
      botUsername: "x",
      accessToken: "x",
      refreshToken: "x",
      oauthToken: "x",
      twitchAccessToken: "x",
      twitchRefreshToken: "x",
    });
    expect(clean).toEqual({ language: "es" });
  });
});

describe("manual-token bot endpoints are gone", () => {
  it("POST /connect-bot answers 410 for an authenticated caller", async () => {
    const res = await authed("post", "/connect-bot").send({
      botUsername: "somebot",
      botToken: "oauth:super-secret-token",
    });
    expect(res.status).toBe(410);
    expect(res.body.error).toMatch(/no longer supported/i);
  });

  it("POST /connect ignores a pasted token instead of connecting with it", async () => {
    // This account holds no Twitch OAuth token, so without the manual path
    // there is nothing to connect with — previously the pasted botToken
    // would have been used for the bot client regardless.
    const res = await authed("post", "/connect").send({
      botUsername: "somebot",
      botToken: "oauth:super-secret-token",
      manual: true,
    });
    expect(res.status).toBe(503);
    expect(sessions.twitchSessions.has(TWITCH_ID)).toBe(false);
  });
});
