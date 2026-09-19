// Security Issues 5 (session cookies + server-side revocation), 6 (log
// redaction) and 7 (overlay tokens + Referrer-Policy).
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { app } = require("../app");
const auth = require("../auth");
const adminAuth = require("../adminAuth");
const { db } = require("../db");

const TWITCH_ID = "sec-5-6-7-test-user";

function seedUser() {
  db.prepare(`DELETE FROM users WHERE twitchId = ?`).run(TWITCH_ID);
  const users = auth.readUsers();
  users.push({
    twitchId: TWITCH_ID,
    login: "sectester",
    displayName: "Sec Tester",
    approved: true,
    tier: "free",
    createdAt: new Date().toISOString(),
  });
  auth.writeUsers(users);
  return auth.readUsers().find((u) => u.twitchId === TWITCH_ID);
}

function sessionCookieFor(user) {
  return `session=${auth.signSession(user)}`;
}

function setCookieHeaders(res) {
  const raw = res.headers["set-cookie"];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

beforeAll(() => {
  seedUser();
});

afterAll(() => {
  auth.writeUsers(auth.readUsers().filter((u) => u.twitchId !== TWITCH_ID));
  // Restore the revocation counters so other suites sharing the test DB see
  // a clean row (logout/rotation tests bump versions on purpose).
  try {
    db.prepare(`UPDATE users SET sessionVersion = 1 WHERE twitchId = ?`).run(TWITCH_ID);
  } catch { /* user already deleted */ }
});

describe("Issue 5: cookie flags", () => {
  it("clears the session cookie with Secure, Path=/ and SameSite=Lax", async () => {
    const user = seedUser();
    const res = await request(app).post("/auth/logout").set("Cookie", sessionCookieFor(user));
    expect(res.status).toBe(200);
    const cleared = setCookieHeaders(res).find((h) => h.startsWith("session="));
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/Path=\//i);
    expect(cleared).toMatch(/SameSite=Lax/i);
    expect(cleared).toMatch(/Secure/i);
    expect(cleared).toMatch(/HttpOnly/i);
  });

  it("sets the admin cookie with Secure, Path=/ and SameSite=Lax", async () => {
    const prev = process.env.ADMIN_PASSWORD;
    process.env.ADMIN_PASSWORD = "test-admin-password-123";
    try {
      const login = await request(app).post("/admin/login").send({ password: "test-admin-password-123" });
      expect(login.status).toBe(200);
      const set = setCookieHeaders(login).find((h) => h.startsWith("admin_session="));
      expect(set).toBeDefined();
      expect(set).toMatch(/Path=\//i);
      expect(set).toMatch(/SameSite=Lax/i);
      expect(set).toMatch(/Secure/i);
      expect(set).toMatch(/HttpOnly/i);

      const logout = await request(app).post("/admin/logout").set("Cookie", set.split(";")[0]);
      const cleared = setCookieHeaders(logout).find((h) => h.startsWith("admin_session="));
      expect(cleared).toBeDefined();
      expect(cleared).toMatch(/Path=\//i);
      expect(cleared).toMatch(/Secure/i);
    } finally {
      if (prev === undefined) delete process.env.ADMIN_PASSWORD;
      else process.env.ADMIN_PASSWORD = prev;
    }
  });

  it("sets the OAuth state cookie with Secure, Path=/ and SameSite=Lax", async () => {
    const prevId = process.env.TWITCH_CLIENT_ID;
    const prevUri = process.env.TWITCH_REDIRECT_URI;
    process.env.TWITCH_CLIENT_ID = "test-client-id";
    process.env.TWITCH_REDIRECT_URI = "http://localhost:3001/auth/twitch/callback";
    try {
      const res = await request(app).get("/auth/twitch/login");
      expect(res.status).toBe(302);
      const set = setCookieHeaders(res).find((h) => h.startsWith("twitch_oauth_state="));
      expect(set).toBeDefined();
      expect(set).toMatch(/Path=\//i);
      expect(set).toMatch(/SameSite=Lax/i);
      expect(set).toMatch(/Secure/i);
      expect(set).toMatch(/HttpOnly/i);
    } finally {
      if (prevId === undefined) delete process.env.TWITCH_CLIENT_ID;
      else process.env.TWITCH_CLIENT_ID = prevId;
      if (prevUri === undefined) delete process.env.TWITCH_REDIRECT_URI;
      else process.env.TWITCH_REDIRECT_URI = prevUri;
    }
  });
});

describe("Issue 5: logout invalidates the old JWT server-side", () => {
  it("rejects the pre-logout session on /auth/me after POST /auth/logout", async () => {
    const user = seedUser();
    const cookie = sessionCookieFor(user);

    const before = await request(app).get("/auth/me").set("Cookie", cookie);
    expect(before.body.loggedIn).toBe(true);

    const logout = await request(app).post("/auth/logout").set("Cookie", cookie);
    expect(logout.status).toBe(200);

    const after = await request(app).get("/auth/me").set("Cookie", cookie);
    expect(after.body.loggedIn).toBe(false);
  });

  it("rejects the old token in requireApprovedUser after revocation", async () => {
    const user = seedUser();
    const stale = auth.signSession(user);
    auth.bumpSessionVersion(TWITCH_ID);
    let status = null;
    auth.requireApprovedUser(
      { cookies: { session: stale } },
      { status: (s) => ({ json: () => { status = s; } }) },
      () => { status = "next"; }
    );
    expect(status).toBe(401);
  });
});

describe("Issue 6: state-mismatch log contains no secrets", () => {
  it("logs only booleans + request id, never state values or cookies", async () => {
    const errors = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => { errors.push(args); });
    try {
      const res = await request(app)
        .get("/auth/twitch/callback?code=secret-code&state=secret-state")
        .set("Cookie", "twitch_oauth_state=expected-secret; session=abc123");
      expect(res.status).toBe(400);
    } finally {
      spy.mockRestore();
    }
    const mismatch = errors.find((args) => String(args[0]).includes("state mismatch"));
    expect(mismatch).toBeDefined();
    const logged = JSON.stringify(mismatch.slice(1));
    expect(logged).not.toContain("secret-code");
    expect(logged).not.toContain("secret-state");
    expect(logged).not.toContain("expected-secret");
    expect(logged).not.toContain("abc123");
    expect(logged).not.toMatch(/cookieHeader/i);
    expect(logged).not.toMatch(/allCookies/i);
    // The redacted shape: presence booleans, never values.
    expect(logged).toMatch(/hasState/);
    expect(logged).toMatch(/hasExpectedState/);
  });
});

describe("Issue 7: overlay tokens", () => {
  it("POST /overlay-token/rotate invalidates the old token and the new one works", async () => {
    const user = seedUser();
    const cookie = sessionCookieFor(user);
    const before = auth.getOverlayToken(TWITCH_ID);

    const okOld = await request(app).get(`/xp/ranking?token=${before}`);
    expect(okOld.status).toBe(200);

    const rotated = await request(app).post("/overlay-token/rotate").set("Cookie", cookie);
    expect(rotated.status).toBe(200);
    expect(typeof rotated.body.token).toBe("string");
    expect(rotated.body.token).not.toBe(before);

    const deadOld = await request(app).get(`/xp/ranking?token=${before}`);
    expect(deadOld.status).toBe(401);

    const liveNew = await request(app).get(`/xp/ranking?token=${rotated.body.token}`);
    expect(liveNew.status).toBe(200);
  });

  it("requires a session to rotate", async () => {
    const res = await request(app).post("/overlay-token/rotate");
    expect(res.status).toBe(401);
  });

  it("sends Referrer-Policy:no-referrer so ?token= URLs never leak via Referer", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
  });
});
