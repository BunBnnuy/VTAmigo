// Separate, password-only session for /admin — independent of Twitch login.
const express = require("express");
const jwt = require("jsonwebtoken");
const { readUsers, writeUsers, clearTwitchTokens } = require("./auth");
const sysmonitor = require("./sysmonitor");
const usage = require("./usage");
const siteConfig = require("./siteConfig");
const errorLog = require("./errorLog");

const ADMIN_SECRET = process.env.SESSION_SECRET || "dev-insecure-session-secret";
const ADMIN_COOKIE = "admin_session";
const SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4h inactivity timeout

// Sliding session: every authenticated request re-signs the cookie with a
// fresh 4h expiry, so the admin only gets logged out after 4h of no activity
// rather than a fixed time since login.
function requireAdmin(req, res, next) {
  const token = req.cookies && req.cookies[ADMIN_COOKIE];
  if (!token) return res.status(401).json({ error: "Not authorized" });
  try {
    jwt.verify(token, ADMIN_SECRET, { subject: "admin" });
    const fresh = jwt.sign({}, ADMIN_SECRET, { subject: "admin", expiresIn: "4h" });
    res.cookie(ADMIN_COOKIE, fresh, { httpOnly: true, sameSite: "lax", maxAge: SESSION_MAX_AGE_MS });
    next();
  } catch {
    res.status(401).json({ error: "Not authorized" });
  }
}

const router = express.Router();

router.post("/admin/login", (req, res) => {
  const { password } = req.body || {};
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return res.status(503).json({ error: "ADMIN_PASSWORD is not configured on this server" });
  if (password !== expected) return res.status(401).json({ error: "Wrong password" });

  const token = jwt.sign({}, ADMIN_SECRET, { subject: "admin", expiresIn: "4h" });
  res.cookie(ADMIN_COOKIE, token, { httpOnly: true, sameSite: "lax", maxAge: SESSION_MAX_AGE_MS });
  res.json({ ok: true });
});

router.post("/admin/logout", (req, res) => {
  res.clearCookie(ADMIN_COOKIE);
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

module.exports = { router, requireAdmin };
