// Non-regression guard for the desktop-legacy purge (batch B1).
//
// VTAmigo started life as a single-streamer Electron app running on the
// streamer's own Windows PC, so the backend could reach things that only
// exist on that machine: VTube Studio over a local WebSocket, the screen
// (OCR + synthetic clicks via PowerShell), the Chrome window title of a
// YouTube tab. As a hosted multi-account site none of that is reachable any
// more, and the Settings toggles for those features were switched off long
// before this refactor — but the routes stayed exposed.
//
// This suite exists so nobody resurrects them by accident (a bad merge, a
// revert, a copy-pasted block): every endpoint below must stay gone.
import request from "supertest";
import { describe, expect, it } from "vitest";

const { app } = require("../app");

// Every route removed in this batch. `guarded` marks the ones that still sit
// under a surviving PROTECTED_PREFIXES entry ("/tts", kept alive by Piper),
// where the blanket requireApprovedUser gate answers 401 before Express ever
// gets to decide the path doesn't exist. See the assertions below for how
// those are pinned instead.
const REMOVED_ENDPOINTS = [
  { method: "post", path: "/screenwatch/config" },
  { method: "post", path: "/screenwatch/scan" },
  { method: "post", path: "/screenwatch/click" },
  { method: "post", path: "/screenwatch/test" },
  { method: "post", path: "/screen-answer" },
  { method: "post", path: "/youtube-narrate" },
  { method: "post", path: "/reddit-story" },
  { method: "post", path: "/reddit-thoughts" },
  { method: "post", path: "/tts/elevenlabs", guarded: true },
  { method: "post", path: "/tts/elevenlabs/voices", guarded: true },
  { method: "get", path: "/vtube/status" },
  { method: "post", path: "/vtube/config" },
  { method: "post", path: "/vtube/reconnect" },
  { method: "post", path: "/vtube/thinking" },
  { method: "post", path: "/lipsync/start" },
  { method: "post", path: "/lipsync/stop" },
  // The device-code enrollment router (backend/devices.js), mounted whole
  // via app.use(devicesRouter) — it granted the downloadable tunnel client
  // an SSH port-forward so the hosted backend could reach a streamer's local
  // VTube Studio. No VTS, no tunnel.
  { method: "post", path: "/device/register" },
  { method: "post", path: "/device/lookup" },
  { method: "post", path: "/device/approve" },
  { method: "get", path: "/device/status" },
  // NOTE: /downloads/tunnel-client.exe is deliberately NOT in this list any
  // more. It has an explicit 410 tombstone route in app.js (see the
  // "tombstone" block below), so it IS a registered route by design.
];

// Walks the Express router stack for paths that are actually registered.
// A plain HTTP status can be ambiguous (an auth guard or the SPA catch-all
// can answer first); this asks the router directly.
function registeredPaths() {
  const paths = [];
  const walk = (stack) => {
    for (const layer of stack) {
      if (layer.route) paths.push(layer.route.path);
      else if (layer.handle?.stack) walk(layer.handle.stack);
    }
  };
  walk(app._router.stack);
  return paths;
}

describe("desktop-legacy purge", () => {
  const paths = registeredPaths();

  it.each(REMOVED_ENDPOINTS)("$method $path is no longer a registered route", ({ path }) => {
    expect(paths).not.toContain(path);
  });

  it.each(REMOVED_ENDPOINTS.filter((e) => !e.guarded))(
    "$method $path responds 404",
    async ({ method, path }) => {
      const res = await request(app)[method](path);
      expect(res.status).toBe(404);
    }
  );

  // Documented, deliberate exception: /tts survives as a protected prefix
  // because Piper TTS still lives under it, so the blanket
  // requireApprovedUser check in app.js runs before route matching and
  // answers 401 for anything under /tts — existing or not. The route-stack
  // assertion above is what proves these two are really gone; this one pins
  // the observable behaviour so a future reader isn't confused by the 401.
  it.each(REMOVED_ENDPOINTS.filter((e) => e.guarded))(
    "$method $path answers 401 (auth gate fires before the 404, /tts prefix is still protected)",
    async ({ method, path }) => {
      const res = await request(app)[method](path);
      expect(res.status).toBe(401);
    }
  );

  // Tombstone for the retired tunnel-client binary: the unsigned .exe is
  // deleted from frontend/public/downloads, but the path stays registered on
  // purpose as an explicit 410 Gone (registered BEFORE the static middleware
  // in app.js, so even a stale dist/ copy or CDN edge can't 200 it again).
  // If this route ever disappears, the path falls through to a 404 — which
  // is safe, but the 410 is the deliberate signal, so keep it.
  describe("tunnel-client.exe tombstone", () => {
    it("is a registered route (the 410 is intentional, not a missing handler)", () => {
      expect(registeredPaths()).toContain("/downloads/tunnel-client.exe");
    });

    it("GET /downloads/tunnel-client.exe responds 410 Gone", async () => {
      const res = await request(app).get("/downloads/tunnel-client.exe");
      expect(res.status).toBe(410);
    });
  });

  it("no longer requires any of the deleted modules", () => {
    for (const mod of [
      "../screenwatch",
      "../reddit",
      "../elevenlabs",
      "../vtube",
      "../vtubeManager",
      "../phonemes",
      "../animations",
      "../devices",
      "../migrate-to-sqlite",
    ]) {
      expect(() => require(mod)).toThrow();
    }
  });

  it("dropped the devices table", () => {
    const { db } = require("../db");
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'devices'`)
      .get();
    expect(row).toBeUndefined();
  });

  // youtube.js survives the purge: it serves the !sr song-request queue
  // (videoQueue.js), which stays. Only the "YouTube peek" narration endpoint
  // died. cheerio likewise stays a dependency because youtube.js uses it.
  it("keeps youtube.js, which the !sr queue depends on", () => {
    const youtube = require("../youtube");
    expect(typeof youtube.resolveInput).toBe("function");
    expect(typeof youtube.fetchPlaylistItems).toBe("function");
  });
});
