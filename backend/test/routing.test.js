// Mount-order guard for the router split (batch C).
//
// app.js used to define all ~80 routes inline; they now live in ten domain
// routers under backend/routes/. The split is only safe because of one
// ordering rule in app.js: the blanket PROTECTED_PREFIXES gate is registered
// *before* every domain router, and the SPA catch-all *after*.
//
// That gate is the only thing authenticating most of those routes, and it is
// what populates req.user. Mount a router above it — trivially easy to do by
// moving an app.use() a few lines up, or by adding an eleventh router in the
// wrong place — and its handlers start serving unauthenticated requests with
// req.user === undefined. Nothing else in the suite would notice: the
// handlers keep returning 200 with someone else's (or nobody's) data.
//
// So this file pins the observable consequence rather than the source order:
// one representative protected route per router must answer 401 with no
// cookie, and the four deliberate OBS-facing exclusions must still be
// reachable without one.
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { app } = require("../app");
const { readUsers, writeUsers, getOverlayToken } = require("../auth");

const TWITCH_ID = "test-routing-1";

// One route per domain router, chosen so a failure names the router that
// slipped above the gate. Some of these are gated by PROTECTED_PREFIXES and
// some by an explicit requireApprovedUser inside the router (see each file's
// header) — both must answer 401, and this suite deliberately doesn't care
// which mechanism did it.
const PROTECTED_SAMPLES = [
  { router: "routes/ai.js", method: "post", path: "/respond" },
  { router: "routes/chat.js", method: "post", path: "/connect-bot" },
  { router: "routes/xp.js", method: "get", path: "/xp/overlay-url" },
  { router: "routes/achievements.js", method: "get", path: "/achievements/state" },
  { router: "routes/activity.js", method: "get", path: "/activity/recent" },
  { router: "routes/overlays.js", method: "get", path: "/overlay/avatar/overlay-url" },
  { router: "routes/stream.js", method: "get", path: "/stream/info" },
  { router: "routes/settings.js", method: "get", path: "/settings" },
  { router: "routes/video.js", method: "get", path: "/video/overlay-url" },
  { router: "routes/overlayBuilder.js", method: "get", path: "/overlay-builder/layouts" },
  { router: "routes/tts.js", method: "post", path: "/avatar/speaking/stop" },
];

let overlayToken;

beforeAll(() => {
  const users = readUsers().filter((u) => u.twitchId !== TWITCH_ID);
  users.push({
    twitchId: TWITCH_ID,
    login: "routingtester",
    displayName: "RoutingTester",
    approved: true,
    createdAt: new Date().toISOString(),
  });
  writeUsers(users);
  overlayToken = getOverlayToken(TWITCH_ID);
});

afterAll(() => {
  writeUsers(readUsers().filter((u) => u.twitchId !== TWITCH_ID));
});

describe("router mount order", () => {
  it.each(PROTECTED_SAMPLES)(
    "$method $path ($router) answers 401 without a session cookie",
    async ({ method, path }) => {
      const res = await request(app)[method](path).send({});
      expect(res.status).toBe(401);
    }
  );

  // Every router must actually be mounted — a 404 on all ten would satisfy
  // nothing above but would still mean the app is broken. The route table is
  // the direct evidence.
  it("registers every sampled route", () => {
    const paths = [];
    const walk = (stack) => {
      for (const layer of stack) {
        if (layer.route) paths.push(layer.route.path);
        else if (layer.handle?.stack) walk(layer.handle.stack);
      }
    };
    walk(app._router.stack);
    for (const { path } of PROTECTED_SAMPLES) expect(paths).toContain(path);
  });
});

describe("OBS-facing exclusions from the auth gate", () => {
  // These four are listed by name in the gate's early-return in app.js. OBS's
  // Browser Source is a separate CEF instance with no access to the
  // streamer's session cookie, so they authenticate with ?token= instead (or,
  // for the bare Overlay Studio page, client-side after the SPA loads).
  // If the gate ever stops excluding them, every streamer's overlays go dark.

  it("GET /xp/ranking is served with an overlay token and no cookie", async () => {
    const res = await request(app).get(`/xp/ranking?token=${overlayToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.ranking)).toBe(true);
  });

  it("GET /video/state is served with an overlay token and no cookie", async () => {
    const res = await request(app).get(`/video/state?token=${overlayToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.queue)).toBe(true);
  });

  it("POST /video/ended is served with an overlay token and no cookie", async () => {
    const res = await request(app)
      .post(`/video/ended?token=${overlayToken}`)
      .send({ videoId: "nothing-is-playing" });
    expect(res.status).toBe(200);
  });

  it("GET /overlay-builder falls through to the SPA shell, unauthenticated", async () => {
    const res = await request(app).get("/overlay-builder");

    // The invariant is that the bare page is not gated — it must reach the SPA
    // catch-all rather than be answered by requireApprovedUser. Asserting a
    // flat 200 tied this to `frontend/dist/index.html` existing, which is a
    // build artifact the backend suite never produces: it passed locally only
    // because a build had been run at some point, and failed in CI, where
    // tests run on a fresh checkout. Not-401 is the property actually under
    // test, and it holds either way.
    expect(res.status).not.toBe(401);

    // Where the frontend has been built, still hold the stronger line: the
    // catch-all really does serve the app shell.
    if (fs.existsSync(path.join(__dirname, "..", "..", "frontend", "dist", "index.html"))) {
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/html/);
    }
  });

  // The bare page is public, but the API under it is not — this is the line
  // the exclusion must not blur.
  it("GET /overlay-builder/layouts is still gated", async () => {
    const res = await request(app).get("/overlay-builder/layouts");
    expect(res.status).toBe(401);
  });

  // The three token-authenticated exclusions reject a request carrying
  // neither a token nor a cookie — proving their inline check is what
  // answered above, not a missing guard.
  it.each([
    { method: "get", path: "/xp/ranking" },
    { method: "get", path: "/video/state" },
    { method: "post", path: "/video/ended" },
  ])("$method $path still rejects a request with no token and no cookie", async ({ method, path }) => {
    const res = await request(app)[method](path).send({});
    expect(res.status).toBe(401);
  });
});

describe("health check", () => {
  it("GET /health answers 200 without any auth", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
