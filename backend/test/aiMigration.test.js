// Admin bulk provider migration: candidates, ordering, done-skipping,
// error-retry and status counts. The CLI transfer is injected — no provider
// binary is ever spawned here.
import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";

const { db } = require("../db");
const aiMigration = require("../aiMigration");
const { app } = require("../app");

const FROM = "claude";
const TO = "opencode";
const DONE_USER = "migration-test-done";
const FAIL_USER = "migration-test-fail";
const IDLE_USER = "migration-test-idle";

function seed() {
  db.prepare(`DELETE FROM agent_sessions WHERE twitchId LIKE 'migration-test-%'`).run();
  db.prepare(`DELETE FROM agent_migrations WHERE twitchId LIKE 'migration-test-%'`).run();
  const insert = db.prepare(
    `INSERT INTO agent_sessions (provider, twitchId, sessionId, started) VALUES (?, ?, ?, ?)`
  );
  insert.run(FROM, DONE_USER, "src-done", 1);
  insert.run(FROM, FAIL_USER, "src-fail", 1);
  insert.run(FROM, IDLE_USER, "src-idle", 0); // never queried: not a candidate
}

async function waitForIdle() {
  await vi.waitFor(() => expect(aiMigration.getStatus(FROM, TO).running).toBe(false));
}

afterAll(() => {
  db.prepare(`DELETE FROM agent_sessions WHERE twitchId LIKE 'migration-test-%'`).run();
  db.prepare(`DELETE FROM agent_migrations WHERE twitchId LIKE 'migration-test-%'`).run();
});

describe("bulk provider migration", () => {
  it("transfers started sessions, marks failures, skips not-started accounts", async () => {
    seed();
    const calls = [];
    aiMigration.startMigration(FROM, TO, {
      transfer: async (from, to, twitchId) => {
        calls.push([from, to, twitchId]);
        if (twitchId === FAIL_USER) throw new Error("boom");
        return { mdPath: "x.md", targetSessionId: null };
      },
    });
    expect(aiMigration.getStatus(FROM, TO).running).toBe(true);
    await waitForIdle();

    // Sequential, ordered by twitchId; the never-queried account is absent.
    expect(calls).toEqual([
      [FROM, TO, DONE_USER],
      [FROM, TO, FAIL_USER],
    ]);
    expect(aiMigration.getStatus(FROM, TO)).toMatchObject({
      total: 2,
      done: 1,
      failed: 1,
      pending: 0,
      running: false,
    });

    const rows = db
      .prepare(
        `SELECT twitchId, status, error FROM agent_migrations
         WHERE fromProvider = ? AND toProvider = ? ORDER BY twitchId`
      )
      .all(FROM, TO);
    expect(rows).toEqual([
      { twitchId: DONE_USER, status: "done", error: null },
      { twitchId: FAIL_USER, status: "error", error: "boom" },
    ]);
  });

  it("retries only failed accounts and skips already-done ones", async () => {
    seed();
    aiMigration.startMigration(FROM, TO, {
      transfer: async (from, to, twitchId) => {
        if (twitchId === FAIL_USER) throw new Error("first attempt failed");
        return { mdPath: null, targetSessionId: null };
      },
    });
    await waitForIdle();

    const calls = [];
    aiMigration.startMigration(FROM, TO, {
      transfer: async (from, to, twitchId) => {
        calls.push(twitchId);
        return { mdPath: null, targetSessionId: null };
      },
    });
    await waitForIdle();

    expect(calls).toEqual([FAIL_USER]);
    expect(aiMigration.getStatus(FROM, TO)).toMatchObject({ total: 2, done: 2, failed: 0, pending: 0 });
  });

  it("refuses a second concurrent run and same/invalid provider pairs", async () => {
    seed();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    aiMigration.startMigration(FROM, TO, { transfer: () => gate });
    expect(() => aiMigration.startMigration(FROM, TO, { transfer: async () => {} })).toThrow("ALREADY_RUNNING");
    release({ mdPath: null, targetSessionId: null });
    await waitForIdle();

    expect(() => aiMigration.startMigration(FROM, FROM)).toThrow("distintos");
    expect(() => aiMigration.startMigration("chatgpt", TO)).toThrow("Invalid provider");
    expect(() => aiMigration.getStatus("chatgpt", TO)).toThrow("Invalid provider");
  });
});

describe("admin migration routes", () => {
  it("requires an admin session", async () => {
    const post = await request(app).post("/admin/ai/migrate").send({ to: TO });
    expect(post.status).toBe(401);

    const get = await request(app).get(`/admin/ai/migrate/status?from=${FROM}&to=${TO}`);
    expect(get.status).toBe(401);
  });

  it("validates an explicit from/to pair before starting anything", async () => {
    const prev = process.env.ADMIN_PASSWORD;
    process.env.ADMIN_PASSWORD = "ai-migration-test-admin";
    try {
      const login = await request(app).post("/admin/login").send({ password: "ai-migration-test-admin" });
      expect(login.status).toBe(200);
      const cookie = (login.headers["set-cookie"] || [])
        .find((h) => h.startsWith("admin_session="))
        .split(";")[0];

      const same = await request(app).post("/admin/ai/migrate").set("Cookie", cookie).send({ from: FROM, to: FROM });
      expect(same.status).toBe(400);

      const unknown = await request(app)
        .post("/admin/ai/migrate")
        .set("Cookie", cookie)
        .send({ from: FROM, to: "chatgpt" });
      expect(unknown.status).toBe(400);
    } finally {
      if (prev === undefined) delete process.env.ADMIN_PASSWORD;
      else process.env.ADMIN_PASSWORD = prev;
    }
  });
});
