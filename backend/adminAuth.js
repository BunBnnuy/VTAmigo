// Separate, password-only session for /admin — independent of Twitch login.
const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { readUsers, writeUsers, clearTwitchTokens, deriveKey, normalizeSessionVersion } = require("./auth");
const { adminLoginGlobalLimiter, adminLoginIpLimiter } = require("./rateLimits");
const { db } = require("./db");
const sysmonitor = require("./sysmonitor");
const usage = require("./usage");
const siteConfig = require("./siteConfig");
const errorLog = require("./errorLog");

// Its own subkey off the shared trust root, rather than SESSION_SECRET
// directly. requireAdmin does check `subject: "admin"`, so a user session JWT
// was never usable here — but that safety rested entirely on one verifier
// option being right. With separate keys, a user token is not even the right
// signature, so forgetting the claim check somewhere can't escalate.
const ADMIN_JWT_KEY = deriveKey("admin-jwt");
const ADMIN_COOKIE = "admin_session";
const SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4h inactivity timeout

// Same flags as the user-session cookies in auth.js (Issue 5): explicit
// path + sameSite + Secure, with matching options on clearCookie so the
// browser actually drops the value. See auth.js's baseCookieOptions for why
// secure:true is correct behind the TLS-terminating nginx (trust proxy:
// loopback in app.js). HSTS itself lives in nginx, not here.
function adminCookieOptions() {
  return { httpOnly: true, path: "/", sameSite: "lax", secure: true, maxAge: SESSION_MAX_AGE_MS };
}

function adminClearCookieOptions() {
  return { httpOnly: true, path: "/", sameSite: "lax", secure: true };
}

// Server-side revocation for the admin session (Issue 5). Admin JWTs carry
// `sv`; requireAdmin rejects mismatches, and logout bumps the counter so the
// old cookie dies server-side instead of living on until its 4h expiry.
function normalizeAdminSessionVersion(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

function getAdminSessionVersion() {
  try {
    const row = db.prepare(`SELECT sessionVersion FROM admin_state WHERE id = 1`).get();
    if (row) return normalizeAdminSessionVersion(row.sessionVersion);
    db.prepare(`INSERT OR IGNORE INTO admin_state (id, sessionVersion) VALUES (1, 1)`).run();
    return 1;
  } catch {
    return 1;
  }
}

function bumpAdminSessionVersion() {
  getAdminSessionVersion(); // ensure the row exists on older databases
  db.prepare(`UPDATE admin_state SET sessionVersion = sessionVersion + 1 WHERE id = 1`).run();
  return getAdminSessionVersion();
}

function signAdminToken() {
  return jwt.sign({ sv: getAdminSessionVersion() }, ADMIN_JWT_KEY, { subject: "admin", expiresIn: "4h" });
}

function isAdminPayloadValid(payload) {
  if (!payload) return false;
  const expected = getAdminSessionVersion();
  if (payload.sv === undefined) return expected === 1; // pre-sv cookie, valid until first revocation
  return payload.sv === expected;
}

// The password is compared byte-for-byte in constant time. timingSafeEqual
// throws on length mismatch — which would leak the length by itself — so both
// sides are hashed to a fixed 32 bytes first.
function passwordMatches(supplied, expected) {
  if (typeof supplied !== "string" || typeof expected !== "string") return false;
  const a = crypto.createHash("sha256").update(supplied).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

// Sliding session: every authenticated request re-signs the cookie with a
// fresh 4h expiry, so the admin only gets logged out after 4h of no activity
// rather than a fixed time since login. The refresh preserves `sv` so it
// does not un-revoke a logout; a bumped version keeps 401ing here.
function requireAdmin(req, res, next) {
  const token = req.cookies && req.cookies[ADMIN_COOKIE];
  if (!token) return res.status(401).json({ error: "Not authorized" });
  try {
    const payload = jwt.verify(token, ADMIN_JWT_KEY, { subject: "admin" });
    if (!isAdminPayloadValid(payload)) return res.status(401).json({ error: "Not authorized" });
    res.cookie(ADMIN_COOKIE, signAdminToken(), adminCookieOptions());
    next();
  } catch {
    res.status(401).json({ error: "Not authorized" });
  }
}

const router = express.Router();

// POST /admin/login — password-only, so it is the brute-force target. Two
// limiters: 5 attempts / 15min per IP plus a global 100 / 15min ceiling so a
// distributed spray still trips (both answer 429 while locked out). Every
// credential failure — missing or wrong password alike — gets the same 401
// message so the response never hints at what was wrong; timing stays
// constant via passwordMatches (hash-then-compare, no length leak).
router.post("/admin/login", adminLoginGlobalLimiter, adminLoginIpLimiter, (req, res) => {
  const { password } = req.body || {};
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return res.status(503).json({ error: "ADMIN_PASSWORD is not configured on this server" });
  if (!passwordMatches(password, expected)) {
    console.warn(`[admin/login] failed attempt from ${req.ip}`);
    return res.status(401).json({ error: "Invalid credentials" });
  }

  res.cookie(ADMIN_COOKIE, signAdminToken(), adminCookieOptions());
  res.json({ ok: true });
});

router.post("/admin/logout", (req, res) => {
  try {
    bumpAdminSessionVersion();
  } catch {
    /* logout stays idempotent even if the counter write fails */
  }
  res.clearCookie(ADMIN_COOKIE, adminClearCookieOptions());
  res.json({ ok: true });
});

// GET /admin/me — lets the frontend check for an existing valid session on
// load, so a page refresh doesn't force a re-login while the cookie is live.
router.get("/admin/me", requireAdmin, (req, res) => {
  res.json({ ok: true });
});

router.get("/admin/users", requireAdmin, (req, res) => {
  res.json({ users: readUsers() });
});

// GET /admin/usage — per-user AI generation counts and estimated token usage
// for today / this week / this month, keyed by twitchId.
router.get("/admin/usage", requireAdmin, (req, res) => {
  res.json({ usage: usage.getSummary() });
});

router.post("/admin/users/:twitchId/approve", requireAdmin, (req, res) => {
  const users = readUsers();
  const user = users.find((u) => u.twitchId === req.params.twitchId);
  if (!user) return res.status(404).json({ error: "User not found" });
  user.approved = true;
  user.approvedAt = new Date().toISOString();
  writeUsers(users);
  res.json({ ok: true, user });
});

const VALID_TIERS = ["free", "basic", "advanced", "pro"];

router.post("/admin/users/:twitchId/tier", requireAdmin, (req, res) => {
  const { tier } = req.body || {};
  if (!VALID_TIERS.includes(tier)) return res.status(400).json({ error: "Invalid tier" });
  const users = readUsers();
  const user = users.find((u) => u.twitchId === req.params.twitchId);
  if (!user) return res.status(404).json({ error: "User not found" });
  user.tier = tier;
  writeUsers(users);
  res.json({ ok: true, user });
});

router.post("/admin/users/:twitchId/revoke", requireAdmin, (req, res) => {
  const users = readUsers();
  const user = users.find((u) => u.twitchId === req.params.twitchId);
  if (!user) return res.status(404).json({ error: "User not found" });
  user.approved = false;
  user.approvedAt = null;
  // Security event: bump the session counter inline (same effect as
  // bumpSessionVersion) so the revoked account's existing JWTs die with the
  // approval, instead of staying valid for up to 30 more days.
  user.sessionVersion = normalizeSessionVersion(user.sessionVersion) + 1;
  writeUsers(users);
  clearTwitchTokens(user.twitchId);
  res.json({ ok: true, user });
});

// GET /admin/site-config — currently just the site-wide AI provider
router.get("/admin/site-config", requireAdmin, (req, res) => {
  res.json({ aiProvider: siteConfig.getProvider() });
});

// POST /admin/site-config — set the AI provider used for every user's chat
// responses site-wide (a user's own Settings preference is ignored)
router.post("/admin/site-config", requireAdmin, (req, res) => {
  const { aiProvider } = req.body || {};
  try {
    siteConfig.setProvider(aiProvider);
    res.json({ ok: true, aiProvider: siteConfig.getProvider() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /admin/stats — CPU/RAM/process snapshot for the resource monitor panel
router.get("/admin/stats", requireAdmin, async (req, res) => {
  try {
    res.json(await sysmonitor.getStats());
  } catch (err) {
    console.error("[admin/stats]", err.message);
    res.status(500).json({ error: "Failed to read system stats" });
  }
});

// GET /admin/error-log — recent frontend app errors reported via POST /api/log-error
router.get("/admin/error-log", requireAdmin, (req, res) => {
  res.json({ entries: errorLog.getEntries() });
});

// DELETE /admin/error-log — clear the log
router.delete("/admin/error-log", requireAdmin, (req, res) => {
  errorLog.clear();
  res.json({ ok: true });
});

// ADMIN_JWT_KEY and passwordMatches are exported for the test suite, which
// asserts key separation from user sessions and the constant-time compare.
// The session-version helpers are exported for the Issue 5 revocation tests.
module.exports = {
  router,
  requireAdmin,
  passwordMatches,
  ADMIN_JWT_KEY,
  ADMIN_COOKIE,
  getAdminSessionVersion,
  bumpAdminSessionVersion,
  signAdminToken,
};
