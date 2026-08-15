// Composition root for the backend: global middleware, the auth gate, and the
// mount order of every router. Route handlers themselves live in routes/* by
// domain, and the live Twitch/TikTok/WebSocket state they share lives in
// sessions.js — see its header for why the dependency arrows point that way.
//
// The order in this file is load-bearing, top to bottom:
//
//   1. global middleware (cors, cookies, JSON body)
//   2. the two public analytics/error relays
//   3. auth + admin routers (public or self-protected)
//   4. canonical-host / robots / static frontend
//   5. the PROTECTED_PREFIXES gate  ← authenticates most of what follows
//   6. the ten domain routers
//   7. /health
//   8. the SPA catch-all (must be last, it matches everything)
//
// Step 5 before step 6 is the critical one: the gate is the *only* thing
// authenticating most domain routes, and it populates req.user. A router
// mounted above it would silently serve unauthenticated requests with
// req.user === undefined. backend/test/routing.test.js pins this.
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const http = require("http");
const path = require("path");
const { WebSocketServer } = require("ws");
const { router: authRouter, requireApprovedUser, getApprovedUserFromCookieHeader, getValidTwitchToken, readUsers, findUserByOverlayToken } = require("./auth");
const { sendEvent } = require("./analytics");
const errorLog = require("./errorLog");
const { router: adminRouter } = require("./adminAuth");
const sessions = require("./sessions");
const aiRouter = require("./routes/ai");
const chatRouter = require("./routes/chat");
const xpRouter = require("./routes/xp");
const activityRouter = require("./routes/activity");
const overlaysRouter = require("./routes/overlays");
const streamRouter = require("./routes/stream");
const settingsRouter = require("./routes/settings");
const videoRouter = require("./routes/video");
const overlayBuilderRouter = require("./routes/overlayBuilder");
const ttsRouter = require("./routes/tts");

const PORT = process.env.PORT || 3001;
const app = express();
// nginx sits in front of this process on localhost and sets X-Forwarded-For /
// X-Real-IP from the real client (see sites-available/vtamigo). "loopback"
// tells Express to only trust those headers when the direct TCP peer is
// 127.0.0.1/::1 — i.e. only nginx can set them, so req.ip reflects the real
// visitor without letting an internet client spoof its own IP by hand.
app.set("trust proxy", "loopback");
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: "10mb" })); // memory .md imports and base64 avatar image uploads (5MB image -> ~6.7MB base64) can be large

// POST /api/collect — relay for frontend-only analytics events (settings
// changes, button clicks with no other network signal). Same-origin, so it
// isn't recognized as a third-party tracker the way calling cloud.umami.is
// directly from the browser is.
app.post("/api/collect", (req, res) => {
  const { event, data } = req.body || {};
  if (event) {
    const user = getApprovedUserFromCookieHeader(req.headers.cookie);
    sendEvent(event, { req, twitchLogin: user?.login, data });
  }
  res.status(204).end();
});

// POST /api/log-error — relay for frontend app errors (uncaught exceptions,
// unhandled promise rejections, React render errors, and explicit logError()
// calls). Public/unauthenticated on purpose — errors can happen before login
// (e.g. on the login screen) and we still want to see those.
app.post("/api/log-error", (req, res) => {
  const { message, stack, source } = req.body || {};
  if (message) {
    const user = getApprovedUserFromCookieHeader(req.headers.cookie);
    errorLog.addEntry({
      message,
      stack,
      source,
      url: req.body?.url,
      userAgent: req.headers["user-agent"],
      twitchLogin: user?.login,
    });
  }
  res.status(204).end();
});

// Twitch login + admin panel routes are public (or self-protected via their
// own middleware); everything else requires an approved, logged-in user.
app.use(authRouter);
app.use(adminRouter);

// Serve the built frontend on the VPS — public, so the login screen itself
// can load before the user is authenticated. In dev, Vite serves it instead
// and VITE_DEV is set.
const isProd = !process.env.VITE_DEV;
const distPath = path.join(__dirname, "../frontend/dist");

// Only the canonical public host should be indexable. Everything else —
// staging, bare-IP access, the packaged Electron app — is treated as private.
function isCanonicalHost(req) {
  const host = (req.get("host") || "").toLowerCase().split(":")[0];
  const canonical = (process.env.CANONICAL_HOST || "vtamigo.top").toLowerCase();
  return host === canonical || host === `www.${canonical}`;
}

// robots.txt alone is not enough to keep staging out of search results:
// Cloudflare's "managed robots.txt" prepends its own `User-agent: *` group
// with `Allow: /`, and a crawler merging two same-agent groups resolves the
// equal-length Allow/Disallow conflict in favour of the least restrictive
// rule — so our Disallow gets ignored. This header can't be merged away, and
// it blocks *indexing* rather than crawling, which is what we actually want.
app.use((req, res, next) => {
  if (!isCanonicalHost(req)) res.set("X-Robots-Tag", "noindex, nofollow");
  next();
});

if (isProd) {
  // robots.txt is generated per-host rather than shipped as a static file:
  // prod and staging build from the same repo, so a single committed file
  // would let dev.vtamigo.top get indexed and compete with prod in search.
  // Fail closed — only the canonical host is crawlable, so staging, bare-IP
  // access and the packaged Electron app all say "go away" by default.
  app.get("/robots.txt", (req, res) => {
    res.type("text/plain");
    if (!isCanonicalHost(req)) return res.send("User-agent: *\nDisallow: /\n");
    // The app pages below all require an approved Twitch login, so there's
    // nothing for a crawler to index there — keep it on the public pages.
    res.send(
      "User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /overlay-builder\nDisallow: /overlay/\n"
    );
  });
  app.use(express.static(distPath));
}

// Known API route prefixes that require an approved, logged-in user. Any GET
// request outside these prefixes is treated as SPA client-side routing (e.g.
// "/", "/admin") and served the app shell — the SPA itself checks /auth/me
// and shows the login/pending screen client-side, so this reveals no data.
const PROTECTED_PREFIXES = [
  "/respond", "/memory", "/connect", "/disconnect", "/say",
  "/event-response", "/xp", "/avatar", "/tts", "/video",
  "/activity", "/overlay-builder",
];
app.use((req, res, next) => {
  // /xp/ranking and /video/state, /video/ended are excluded even though they
  // match protected prefixes below — they're the endpoints the OBS overlay
  // needs, and OBS's Browser Source has no access to the streamer's session
  // cookie. They do their own auth inline (cookie session OR ?token= overlay
  // token) instead of the blanket check.
  // "/overlay-builder" bare (no trailing segment) is the Overlay Studio SPA
  // page itself, not an API call — like /admin, it does its own
  // client-side /auth/me check (see OverlayBuilder.jsx), so it must fall
  // through to the SPA catch-all unauthenticated. Everything under
  // "/overlay-builder/..." (the actual API routes) still matches the prefix
  // check below and gets gated normally.
  if (req.path === "/xp/ranking" || req.path === "/video/state" || req.path === "/video/ended" || req.path === "/overlay-builder") return next();
  // Match hyphenated variants too (e.g. "/connect-bot", "/connect-tiktok"),
  // not just "/connect" itself or "/connect/..." — a plain "/" boundary
  // check let those slip through unauthenticated, which crashed /connect-bot
  // (it reads req.user, never populated without requireApprovedUser).
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => req.path === p || req.path.startsWith(p + "/") || req.path.startsWith(p + "-")
  );
  if (!isProtected) return next();
  requireApprovedUser(req, res, next);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/chat" });
// Hand the shared state module the two objects only this file can build, so
// every router's `require("../sessions")` can broadcast. Must happen before
// the routers below are mounted — see sessions.js's header.
sessions.attach({ server, wss });

// ── Domain routers ───────────────────────────────────────────────────────────
// All ten sit *below* the PROTECTED_PREFIXES gate above, which is what
// authenticates the routes whose prefixes are on that list and populates
// req.user for them. Routers whose paths are not on the list (overlays,
// stream, settings, and the OBS-facing exclusions) carry their own inline or
// requireApprovedUser checks — see each file's header.
app.use(aiRouter);            // /respond, /memory/*
app.use(chatRouter);          // /connect*, /disconnect*, /say*, /event-response
app.use(xpRouter);            // /xp/*, /overlay/xp
app.use(activityRouter);      // /activity/recent
app.use(overlaysRouter);      // /overlay/avatar*, /overlay/chat, /chat-overlay/*
app.use(streamRouter);        // /stream/*
app.use(settingsRouter);      // /settings
app.use(videoRouter);         // /video/*, /overlay/video
app.use(overlayBuilderRouter); // /overlay-builder/*, /overlay/custom/*
app.use(ttsRouter);           // /avatar/speaking/*, /tts/piper*

// GET /health
app.get("/health", (req, res) => res.json({ ok: true }));

// SPA catch-all — must be registered after every specific API route above so
// it acts only as a fallback for client-side routes ("/", "/admin"). It stays
// public: the guard above only blocks PROTECTED_PREFIXES, and the SPA itself
// does its own client-side /auth/me check.
if (isProd) {
  app.get("*", (req, res) => {
    // "/" and the known client-side routes below still render their normal
    // page — main.jsx figures out which — everything else is a real 404,
    // so it gets the right status code even though the SPA itself renders
    // the NotFound page for it.
    // Keep in sync with the page() switch in frontend/src/main.jsx.
    const knownPath = req.path === "/" || ["/admin", "/overlay-builder", "/privacy", "/faq"].some((p) => req.path.startsWith(p));
    res.status(knownPath ? 200 : 404).sendFile(path.join(distPath, "index.html"));
  });
}

wss.on("connection", (ws, req) => {
  // The OBS overlay (backend/overlay/xp.html) can't send the session cookie —
  // it's a separate CEF instance — so it connects with ?token=... instead
  // (forwarded from its own query string, see xp.html).
  const token = new URL(req.url, "http://internal").searchParams.get("token");
  const user = (token && findUserByOverlayToken(token)) || getApprovedUserFromCookieHeader(req.headers.cookie);
  if (!user) {
    console.log("[ws] rejected unauthenticated connection");
    ws.close(4401, "unauthorized");
    return;
  }
  ws.twitchId = user.twitchId;
  console.log(`[ws] frontend connected (${user.login})`);
  ws.on("close", () => console.log(`[ws] frontend disconnected (${user.login})`));
});

// Every 30 min, check whether each connected account's Twitch token needs a
// refresh (getValidTwitchToken refreshes transparently when close to expiry)
// and reconnect if it rotated — EventSub subscriptions are per-websocket-
// session, so a reconnect naturally re-subscribes with the fresh token.
//
// Called from index.js at startup rather than on import, so requiring this
// module from a test doesn't leave a live timer behind.
function startBackgroundJobs() {
  return setInterval(async () => {
    for (const [twitchId, session] of sessions.twitchSessions) {
      try {
        const freshToken = await getValidTwitchToken(twitchId);
        if (freshToken !== session.accessToken) {
          const user = readUsers().find((u) => u.twitchId === twitchId);
          if (user) {
            console.log(`[twitch] token refreshed for ${user.login} — reconnecting`);
            await sessions.connectTwitchForUser(user, session.botCreds);
          }
        }
      } catch (err) {
        console.warn(`[twitch] periodic token refresh failed for ${twitchId}:`, err.message);
      }
    }
  }, 30 * 60 * 1000);
}

// Requiring this module builds the app and wires every route, but never
// listens and never starts a timer — that's index.js's job. Tests can import
// { app } and drive it with supertest without binding a port or kicking off
// the background refresh loop.
module.exports = { app, server, wss, startBackgroundJobs, PORT };
