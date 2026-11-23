// Owner role: a separate access axis from `tier`, gating surfaces that are
// hidden from normal accounts (VRM avatar, autonomous host). The session JWT
// deliberately does not carry the role — requireOwner reads it fresh from
// SQLite, so demoting an account takes effect on the next request.
import request from "supertest";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { app } = require("../app");
const sessions = require("../sessions");
const showScript = require("../showScript");
const { readUsers, writeUsers, signSession, getOverlayToken, deriveKey } = require("../auth");
const { db } = require("../db");

const OWNER_ID = "owner-role-test-owner";
const USER_ID = "owner-role-test-user";

const seedUser = (twitchId, role) => ({
  twitchId,
  login: twitchId.replace(/-/g, ""),
  displayName: twitchId,
  approved: true,
  tier: "pro",
  role,
  createdAt: new Date().toISOString(),
});

const authed = (twitchId, method, path) => {
  const user = readUsers().find((u) => u.twitchId === twitchId);
  return request(app)[method](path).set("Cookie", `session=${signSession(user)}`);
};

const adminCookie = () => {
  const sv = db.prepare(`SELECT sessionVersion FROM admin_state WHERE id = 1`).get()?.sessionVersion ?? 1;
  const token = jwt.sign({ sv }, deriveKey("admin-jwt"), { subject: "admin", expiresIn: "1h" });
  return `admin_session=${token}`;
};

beforeAll(() => {
  const users = readUsers().filter((u) => u.twitchId !== OWNER_ID && u.twitchId !== USER_ID);
  users.push(seedUser(OWNER_ID, "owner"), seedUser(USER_ID, "user"));
  writeUsers(users);
});

afterAll(() => {
  sessions.twitchSessions.delete(OWNER_ID);
  sessions.twitchSessions.delete(USER_ID);
  writeUsers(readUsers().filter((u) => u.twitchId !== OWNER_ID && u.twitchId !== USER_ID));
});

describe("owner role", () => {
  it("is reported by /auth/me and defaults unknown values to user", async () => {
    const owner = await authed(OWNER_ID, "get", "/auth/me");
    expect(owner.body.role).toBe("owner");

    const user = await authed(USER_ID, "get", "/auth/me");
    expect(user.body.role).toBe("user");
  });

  it("gates the VRM lab config and act routes to the owner", async () => {
    expect((await authed(USER_ID, "get", "/vrm-lab/config")).status).toBe(404);
    expect((await authed(OWNER_ID, "get", "/vrm-lab/config")).status).toBe(200);
    expect((await authed(USER_ID, "post", "/vrm-lab/act").send({ act: "greeting" })).status).toBe(404);
    expect((await authed(OWNER_ID, "post", "/vrm-lab/act").send({ act: "greeting" })).status).toBe(200);
    // Unknown acts are rejected even for the owner.
    expect((await authed(OWNER_ID, "post", "/vrm-lab/act").send({ act: "rm -rf" })).status).toBe(400);
  });

  it("gates the token-authenticated VRM overlay config too", async () => {
    const userToken = getOverlayToken(USER_ID);
    const ownerToken = getOverlayToken(OWNER_ID);
    expect((await request(app).get(`/overlay/vrm/config?token=${userToken}`)).status).toBe(404);
    expect((await request(app).get(`/overlay/vrm/config?token=${ownerToken}`)).status).toBe(200);
  });
});

describe("autonomous host script", () => {
  it("is owner-only", async () => {
    expect((await authed(USER_ID, "get", "/host/script")).status).toBe(404);
    expect((await authed(USER_ID, "post", "/host/script").send({})).status).toBe(404);
  });

  it("lists decks and starts a generation job for the owner", async () => {
    const startSpy = vi.spyOn(showScript, "startGeneration").mockReturnValue({
      jobId: "job-test-1",
      existing: false,
    });
    try {
      const generated = await authed(OWNER_ID, "post", "/host/script").send({ language: "es", count: 12 });
      expect(generated.status).toBe(202);
      expect(generated.body.jobId).toBe("job-test-1");
      expect(startSpy).toHaveBeenCalledWith(
        OWNER_ID,
        expect.objectContaining({ language: "es", count: 12, context: expect.any(Object) })
      );
    } finally {
      startSpy.mockRestore();
    }

    const list = await authed(OWNER_ID, "get", "/host/script");
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.decks)).toBe(true);
  });

  it("serves a job's status and the active job", async () => {
    const getSpy = vi.spyOn(showScript, "getJob").mockReturnValue({
      jobId: "job-test-1",
      status: "done",
      deck: { id: "deck-test-1", createdAt: Date.now(), beats: [], meta: {} },
    });
    const activeSpy = vi.spyOn(showScript, "getActiveJob").mockReturnValue({
      jobId: "job-test-2",
      status: "running",
    });
    try {
      const status = await authed(OWNER_ID, "get", "/host/script/status/job-test-1");
      expect(status.status).toBe(200);
      expect(status.body.status).toBe("done");
      expect(status.body.deck.id).toBe("deck-test-1");

      const active = await authed(OWNER_ID, "get", "/host/script/active");
      expect(active.status).toBe(200);
      expect(active.body.job.jobId).toBe("job-test-2");
    } finally {
      getSpy.mockRestore();
      activeSpy.mockRestore();
    }
  });
});

describe("admin role management", () => {
  it("requires the admin session", async () => {
    const res = await request(app)
      .post(`/admin/users/${USER_ID}/role`)
      .send({ role: "owner" });
    expect(res.status).toBe(401);
  });

  it("promotes and demotes a user, rejecting invalid roles", async () => {
    const cookie = adminCookie();
    const promote = await request(app)
      .post(`/admin/users/${USER_ID}/role`)
      .set("Cookie", cookie)
      .send({ role: "owner" });
    expect(promote.status).toBe(200);
    expect(readUsers().find((u) => u.twitchId === USER_ID).role).toBe("owner");

    const invalid = await request(app)
      .post(`/admin/users/${USER_ID}/role`)
      .set("Cookie", cookie)
      .send({ role: "superadmin" });
    expect(invalid.status).toBe(400);

    const demote = await request(app)
      .post(`/admin/users/${USER_ID}/role`)
      .set("Cookie", cookie)
      .send({ role: "user" });
    expect(demote.status).toBe(200);
    expect(readUsers().find((u) => u.twitchId === USER_ID).role).toBe("user");
  });
});
