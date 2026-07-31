// Separate, password-only session for /admin — independent of Twitch login.
const express = require("express");
const jwt = require("jsonwebtoken");
const { readUsers, writeUsers, clearTwitchTokens } = require("./auth");
const sysmonitor = require("./sysmonitor");

const ADMIN_SECRET = process.env.SESSION_SECRET || "dev-insecure-session-secret";
const ADMIN_COOKIE = "admin_session";

function requireAdmin(req, res, next) {
  const token = req.cookies && req.cookies[ADMIN_COOKIE];
  if (!token) return res.status(401).json({ error: "Not authorized" });
  try {
    jwt.verify(token, ADMIN_SECRET, { subject: "admin" });
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

  const token = jwt.sign({}, ADMIN_SECRET, { subject: "admin", expiresIn: "12h" });
  res.cookie(ADMIN_COOKIE, token, { httpOnly: true, sameSite: "lax", maxAge: 12 * 60 * 60 * 1000 });
  res.json({ ok: true });
});

router.post("/admin/logout", (req, res) => {
  res.clearCookie(ADMIN_COOKIE);
  res.json({ ok: true });
});

router.get("/admin/users", requireAdmin, (req, res) => {
  res.json({ users: readUsers() });
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

// GET /admin/stats — CPU/RAM/process snapshot for the resource monitor panel
router.get("/admin/stats", requireAdmin, async (req, res) => {
  try {
    res.json(await sysmonitor.getStats());
  } catch (err) {
    console.error("[admin/stats]", err.message);
    res.status(500).json({ error: "Failed to read system stats" });
  }
});

module.exports = { router, requireAdmin };
