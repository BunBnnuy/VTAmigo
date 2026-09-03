// Streamer achievements: unlock-once persistence, points math, and the
// points -> tier upgrade rule.
import request from "supertest";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { app } = require("../app");
const achievements = require("../achievements");
const activity = require("../activity");
const usage = require("../usage");
const { readUsers, writeUsers, deriveKey } = require("../auth");
const { db } = require("../db");

const TWITCH_ID = "achievements-test-user";
let sessionCookie;

function authCookie() {
  return `session=${jwt.sign({ twitchId: TWITCH_ID }, deriveKey("session-jwt"), { expiresIn: "1h" })}`;
}

beforeAll(() => {
  const users = readUsers().filter((u) => u.twitchId !== TWITCH_ID);
  users.push({
    twitchId: TWITCH_ID,
    login: "achievementtester",
    displayName: "AchievementTester",
    approved: true,
    tier: "free",
    createdAt: new Date().toISOString(),
  });
  writeUsers(users);
  sessionCookie = authCookie();
});

afterAll(() => {
  achievements.reset(TWITCH_ID);
  writeUsers(readUsers().filter((u) => u.twitchId !== TWITCH_ID));
  db.prepare(`DELETE FROM usage_log WHERE twitchId = ?`).run(TWITCH_ID);
  db.prepare(`DELETE FROM activity_events WHERE twitchId = ?`).run(TWITCH_ID);
  db.prepare(`DELETE FROM xp_users WHERE twitchId = ?`).run(TWITCH_ID);
});

const get = (path) => request(app).get(path).set("Cookie", sessionCookie);

describe("GET /achievements/state", () => {
  it("rejects an unauthenticated caller", async () => {
    const res = await request(app).get("/achievements/state");
    expect(res.status).toBe(401);
  });

  it("lists every achievement locked with zero points for a fresh account", async () => {
    achievements.reset(TWITCH_ID);
    const res = await get("/achievements/state");
    expect(res.status).toBe(200);
    expect(res.body.achievements).toHaveLength(achievements.ACHIEVEMENTS.length);
    expect(res.body.totalPoints).toBe(0);
    expect(res.body.earnedTier).toBe("free");
    expect(res.body.tierThresholds).toEqual({ free: 0, basic: 50, advanced: 150, pro: 300 });
    // A fresh account with no history has nothing unlocked — the GET's lazy
    // settle must not invent a first_connect out of thin air.
    expect(res.body.achievements.every((a) => !a.unlocked)).toBe(true);
  });
});

describe("unlocking + tier upgrades", () => {
  it("unlocks ai_1 after one recorded response and reports progress", async () => {
    achievements.reset(TWITCH_ID);
    usage.recordGeneration({ twitchId: TWITCH_ID, login: "achievementtester", provider: "claude", inputText: "hi", outputText: "hello" });

    const res = await get("/achievements/state");
    const byId = Object.fromEntries(res.body.achievements.map((a) => [a.id, a]));
    expect(byId.ai_1.unlocked).toBe(true);
    expect(byId.ai_20.unlocked).toBe(false);
    expect(byId.ai_20.progress).toBe(1);
    expect(byId.ai_20.target).toBe(20);
    // ai_1 (10) + first_connect (10) — any recorded response implies the
    // account connected before, so the lazy settle awards it retroactively.
    expect(byId.first_connect.unlocked).toBe(true);
    expect(res.body.totalPoints).toBe(20);
  });

  it("is idempotent — a second settle unlocks nothing new", async () => {
    const first = achievements.checkAndUnlock(TWITCH_ID);
    expect(first.newlyUnlocked).toHaveLength(0);
  });

  it("unlocks event achievements from recorded activity", async () => {
    activity.record(TWITCH_ID, { id: "ach-follow-1", timestamp: Date.now(), kind: "follow", username: "fan1" });
    activity.record(TWITCH_ID, { id: "ach-raid-1", timestamp: Date.now(), kind: "raid", username: "raider", viewers: 5 });

    const res = await get("/achievements/state");
    const byId = Object.fromEntries(res.body.achievements.map((a) => [a.id, a]));
    expect(byId.first_follow.unlocked).toBe(true);
    expect(byId.first_raid.unlocked).toBe(true);
    expect(byId.first_sub.unlocked).toBe(false);
  });

  it("upgrades the stored tier once points cross a cutoff, never downward", async () => {
    // 10 (ai_1) + 10 (first_connect) + 15 + 15 (follow, raid) = 50 so far —
    // the earlier GETs already lifted the stored tier to basic via their lazy
    // settle. Drop it back to free to isolate this step's upgrade.
    const users = readUsers();
    users.find((u) => u.twitchId === TWITCH_ID).tier = "free";
    writeUsers(users);

    // A sub pushes the total to 65.
    activity.record(TWITCH_ID, { id: "ach-sub-1", timestamp: Date.now(), kind: "sub", username: "subber" });
    const result = achievements.checkAndUnlock(TWITCH_ID);
    expect(result.newlyUnlocked.map((a) => a.id)).toContain("first_sub");
    expect(result.totalPoints).toBeGreaterThanOrEqual(50);
    expect(result.earnedTier).toBe("basic");

    const upgraded = achievements.maybeUpgradeTier(TWITCH_ID, result.earnedTier);
    expect(upgraded).toBe("basic");
    expect(readUsers().find((u) => u.twitchId === TWITCH_ID).tier).toBe("basic");

    // Already there — no-op, and a lower earned tier never downgrades.
    expect(achievements.maybeUpgradeTier(TWITCH_ID, "basic")).toBeNull();
    expect(achievements.maybeUpgradeTier(TWITCH_ID, "free")).toBeNull();
    expect(readUsers().find((u) => u.twitchId === TWITCH_ID).tier).toBe("basic");
  });

  it("maps point totals to tiers at the agreed cutoffs", () => {
    expect(achievements.earnedTierForPoints(0)).toBe("free");
    expect(achievements.earnedTierForPoints(49)).toBe("free");
    expect(achievements.earnedTierForPoints(50)).toBe("basic");
    expect(achievements.earnedTierForPoints(149)).toBe("basic");
    expect(achievements.earnedTierForPoints(150)).toBe("advanced");
    expect(achievements.earnedTierForPoints(299)).toBe("advanced");
    expect(achievements.earnedTierForPoints(300)).toBe("pro");
  });
});
