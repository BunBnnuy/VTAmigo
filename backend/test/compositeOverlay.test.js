import request from "supertest";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { app } = require("../app");
const { readUsers, writeUsers, deriveKey, getOverlayToken } = require("../auth");
const { SOURCES } = require("../overlaySources");

const TWITCH_ID = "composite-overlay-test";
const cookie = `session=${jwt.sign({ twitchId: TWITCH_ID }, deriveKey("session-jwt"), { expiresIn: "1h" })}`;

beforeAll(() => {
  writeUsers([
    ...readUsers().filter((user) => user.twitchId !== TWITCH_ID),
    { twitchId: TWITCH_ID, login: "compositetester", displayName: "Composite Tester", approved: true, tier: "free", createdAt: new Date().toISOString() },
  ]);
});

afterAll(() => {
  writeUsers(readUsers().filter((user) => user.twitchId !== TWITCH_ID));
});

describe("composite OBS overlay", () => {
  it.each(SOURCES)("serves the $name page at its catalog path", async (source) => {
    const response = await request(app).get(source.path);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/html/);
  });

  it("lists only the supported app sources behind session auth", async () => {
    expect((await request(app).get("/overlay-builder/sources")).status).toBe(401);
    const response = await request(app).get("/overlay-builder/sources").set("Cookie", cookie);
    expect(response.status).toBe(200);
    expect(response.body.sources).toEqual(SOURCES);
  });

  it("saves every app source and resolves token URLs for the OBS page", async () => {
    const created = await request(app).post("/overlay-builder/layouts").set("Cookie", cookie).send({ name: "Composite test" });
    expect(created.status).toBe(200);
    const layoutId = created.body.layout.id;

    try {
      const layers = SOURCES.map((source, index) => ({ id: `app-${index}`, type: "overlay", sourceId: source.id, x: 10, y: 20, w: source.w, h: source.h }));
      layers.push({ id: "unsafe", type: "overlay", sourceId: "https://example.com", x: 0, y: 0, w: 100, h: 100 });
      const saved = await request(app).put(`/overlay-builder/layouts/${layoutId}`).set("Cookie", cookie).send({ layers });
      expect(saved.status).toBe(200);
      expect(saved.body.layout.layers).toHaveLength(SOURCES.length);

      const token = getOverlayToken(TWITCH_ID);
      expect((await request(app).get(`/overlay/custom/${layoutId}/data`)).status).toBe(401);
      const data = await request(app).get(`/overlay/custom/${layoutId}/data?token=${encodeURIComponent(token)}`);
      expect(data.status).toBe(200);
      expect(data.body.layers).toHaveLength(SOURCES.length);
      for (const [index, source] of SOURCES.entries()) {
        expect(data.body.layers[index]).toMatchObject({ id: `app-${index}`, type: "overlay", sourceId: source.id });
        expect(data.body.layers[index].overlayUrl).toBe(`${source.path}${source.path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`);
      }
    } finally {
      await request(app).delete(`/overlay-builder/layouts/${layoutId}`).set("Cookie", cookie);
    }
  });
});

describe("app overlay preview placeholders", () => {
  it("serves the shared placeholder script publicly", async () => {
    const response = await request(app).get("/overlay/preview-note.js");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/javascript/);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.text).toContain("OverlayPreviewNote");
    // Gated on the builder-only flag, so OBS never renders it.
    expect(response.text).toContain('get("preview") === "1"');
    // The helper API the pages call — a stale cached copy missing these is
    // what made every overlay render blank.
    for (const fn of ["badge", "avatarDataUrl", "posterDataUrl"]) {
      expect(response.text).toContain(fn);
    }
  });

  it.each(SOURCES)("$name opts into the shared placeholder", async (source) => {
    const response = await request(app).get(source.path);
    expect(response.status).toBe(200);
    // Cache-busted so an updated helper script can never be served stale.
    expect(response.text).toMatch(/\/overlay\/preview-note\.js\?v=\d+/);
    expect(response.text).toContain("OverlayPreviewNote");
  });
});
