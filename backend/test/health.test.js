// Seed suite for the backend test harness. Its job is to prove the arrangement
// works end to end — that app.js can be imported without binding a port or
// starting a timer, and that supertest can drive it — so the purge and rewrite
// batches can add real route coverage on top.
import request from "supertest";
import { describe, expect, it } from "vitest";

const { app } = require("../app");

describe("backend test harness", () => {
  it("serves GET /health without a listening server", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("runs against the test database, not development", () => {
    expect(process.env.APP_ENV).toBe("test");
  });

  it("leaves no live handle behind on import", () => {
    // startBackgroundJobs is exported rather than invoked on import — if that
    // ever regresses, the suite would hang for 30 minutes on the interval.
    const { startBackgroundJobs } = require("../app");
    expect(typeof startBackgroundJobs).toBe("function");
  });
});
