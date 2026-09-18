// Shared express-rate-limit limiters (Issue 2: abuse limits, Issue 3: admin brute-force).
//
// NOTE on scaling: these use the default in-process MemoryStore, which is NOT
// shared between Node processes or VPS restarts. Behind multi-process hosting
// (cluster / pm2 / several containers) each process enforces its own budget,
// so an attacker gets Nx the allowance. Move to a shared store (e.g.
// rate-limit-redis) if the backend ever runs more than one process.
const { rateLimit } = require("express-rate-limit");

const standardHeaders = { standardHeaders: true, legacyHeaders: false };

// 5 expensive AI generations per minute per IP, shared by POST /respond and
// POST /tts/piper (both burn CLI/GPU time). Applied inside the routers —
// *after* the auth gate in app.js — so unauthenticated 401s don't consume it.
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  ...standardHeaders,
  message: { error: "Too many AI requests, slow down and try again shortly" },
});

// 10/min per IP for the two public, unauthenticated relays (/api/collect,
// /api/log-error). They do no expensive work, but without a cap one browser
// tab (or botnet) can flood the analytics/error pipeline and the admin log.
const anonymousLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  ...standardHeaders,
  message: { error: "Too many requests, slow down and try again shortly" },
});

// POST /admin/login: 5 attempts per 15 min per IP…
const adminLoginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  ...standardHeaders,
  message: { error: "Too many login attempts, try again later" },
});

// …plus a global ceiling across all IPs so a distributed spray still trips.
// Single fixed key: every login attempt worldwide counts against one bucket.
const adminLoginGlobalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  keyGenerator: () => "admin-login-global",
  ...standardHeaders,
  message: { error: "Too many login attempts, try again later" },
});

module.exports = { aiLimiter, anonymousLimiter, adminLoginIpLimiter, adminLoginGlobalLimiter };
