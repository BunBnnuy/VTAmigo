// Device-code enrollment for the downloadable tunnel client (server/tunnel-client).
// A guest runs the client locally, it generates its own SSH keypair, and this
// flow lets them prove who they are via the existing Twitch login + admin
// approval system before the backend grants their public key restricted SSH
// port-forwarding access on the VPS. Flat JSON store, same pattern as users.json.
//
// Approved keys are looked up live by sshd via an AuthorizedKeysCommand
// (server/tunnel-authorized-keys.sh) that reads this same store — now the
// `devices` SQLite table (see db.js) instead of devices.json directly, so
// that script needs to query the DB file for this environment instead.
// See server/README.md.
const express = require("express");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const { requireApprovedUser } = require("./auth");
const { requireAdmin } = require("./adminAuth");
const { db } = require("./db");

const PENDING_TTL_MS = 15 * 60 * 1000;
const BASE_PORT = 8001;

// userCode is a short, human-typed 24-bit code (crypto.randomBytes(3)) —
// fine for its purpose (avoiding a fat-fingered approval) but brute-forceable
// without a request cap, since /device/lookup and /device/approve both
// accept it. Caps well below what brute-forcing 16.7M combinations needs.
const deviceCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const TUNNEL_HOST = process.env.TUNNEL_HOST || "vtamigo.top";
const TUNNEL_SSH_USER = "tunnel";

const DEVICE_COLUMNS = ["deviceCode", "userCode", "publicKey", "twitchId", "status", "assignedPort", "createdAt", "approvedAt"];

const upsertDeviceStmt = db.prepare(`
  INSERT INTO devices (${DEVICE_COLUMNS.join(", ")})
  VALUES (${DEVICE_COLUMNS.map((c) => "@" + c).join(", ")})
  ON CONFLICT(deviceCode) DO UPDATE SET
    ${DEVICE_COLUMNS.filter((c) => c !== "deviceCode").map((c) => `${c} = excluded.${c}`).join(", ")}
`);
const deleteDeviceStmt = db.prepare(`DELETE FROM devices WHERE deviceCode = ?`);
const selectAllDeviceCodesStmt = db.prepare(`SELECT deviceCode FROM devices`);

function readDevices() {
  return db.prepare(`SELECT * FROM devices`).all();
}

// Callers read the full array, mutate/push entries, then pass the whole
// thing back — same "rewrite the whole file" contract devices.json used to
// have, just against SQLite: upsert everything present, delete anything no
// longer in the array.
function writeDevices(devices) {
  const txn = db.transaction((list) => {
    const keep = new Set();
    for (const d of list) {
      keep.add(d.deviceCode);
      const row = {};
      for (const c of DEVICE_COLUMNS) row[c] = d[c] === undefined ? null : d[c];
      upsertDeviceStmt.run(row);
    }
    for (const { deviceCode } of selectAllDeviceCodesStmt.all()) {
      if (!keep.has(deviceCode)) deleteDeviceStmt.run(deviceCode);
    }
  });
  txn(devices);
}

function pruneExpired(devices) {
  const now = Date.now();
  return devices.filter((d) => {
    if (d.status !== "pending") return true;
    return now - new Date(d.createdAt).getTime() < PENDING_TTL_MS;
  });
}

function nextPort(devices) {
  const used = devices
    .filter((d) => d.status === "approved" && Number.isInteger(d.assignedPort))
    .map((d) => d.assignedPort);
  return used.length ? Math.max(...used) + 1 : BASE_PORT + 1; // 8001 stays reserved for the owner's own tunnel
}

// Look up the approved tunnel (if any) belonging to a logged-in Twitch user.
function getApprovedDeviceForUser(twitchId) {
  if (!twitchId) return null;
  const devices = pruneExpired(readDevices());
  return devices.find((d) => d.status === "approved" && d.twitchId === twitchId) || null;
}

// Distinct twitchIds that currently have an approved tunnel — used to
// reconnect every known VTS instance at server boot.
function listApprovedDeviceOwners() {
  const devices = pruneExpired(readDevices());
  const ids = new Set(devices.filter((d) => d.status === "approved" && d.twitchId).map((d) => d.twitchId));
  return [...ids];
}

const router = express.Router();

// POST /device/init — { publicKey } → { deviceCode, userCode, verifyUrl }
router.post("/device/init", (req, res) => {
  const { publicKey } = req.body || {};
  if (!publicKey || typeof publicKey !== "string" || !publicKey.trim().startsWith("ssh-")) {
    return res.status(400).json({ error: "A valid SSH public key is required" });
  }

  const devices = pruneExpired(readDevices());
  const deviceCode = crypto.randomBytes(32).toString("hex");
  const userCode = crypto.randomBytes(3).toString("hex").toUpperCase(); // short, shown to the human

  devices.push({
    deviceCode,
    userCode,
    publicKey: publicKey.trim(),
    twitchId: null,
    status: "pending",
    assignedPort: null,
    createdAt: new Date().toISOString(),
    approvedAt: null,
  });
  writeDevices(devices);

  res.json({
    deviceCode,
    userCode,
    verifyUrl: `https://${TUNNEL_HOST}/device?code=${userCode}`,
  });
});

// GET /device/poll?deviceCode=... — client polls this until approved
router.get("/device/poll", (req, res) => {
  const { deviceCode } = req.query;
  if (!deviceCode) return res.status(400).json({ error: "deviceCode is required" });

  const devices = pruneExpired(readDevices());
  writeDevices(devices);
  const device = devices.find((d) => d.deviceCode === deviceCode);
  if (!device) return res.status(404).json({ status: "expired" });

  if (device.status !== "approved") {
    return res.json({ status: device.status });
  }
  res.json({
    status: "approved",
    port: device.assignedPort,
    host: TUNNEL_HOST,
    tunnelUser: TUNNEL_SSH_USER,
  });
});

// GET /device/lookup?userCode=... — used by the /device approval page to show
// what's being approved before the user commits (no secrets in the response).
router.get("/device/lookup", requireApprovedUser, deviceCodeLimiter, (req, res) => {
  const { userCode } = req.query;
  const devices = pruneExpired(readDevices());
  const device = devices.find((d) => d.userCode === (userCode || "").toUpperCase());
  if (!device) return res.status(404).json({ error: "Code not found or expired" });
  res.json({ status: device.status, createdAt: device.createdAt });
});

// POST /device/approve — { userCode } — only an already-approved, logged-in
// Twitch user can approve a new device (their own or a guest's).
router.post("/device/approve", requireApprovedUser, deviceCodeLimiter, (req, res) => {
  const { userCode } = req.body || {};
  if (!userCode) return res.status(400).json({ error: "userCode is required" });

  const devices = pruneExpired(readDevices());
  const device = devices.find((d) => d.userCode === userCode.toUpperCase());
  if (!device) return res.status(404).json({ error: "Code not found or expired" });
  if (device.status === "approved") return res.json({ ok: true, alreadyApproved: true });

  device.status = "approved";
  device.twitchId = req.user.twitchId;
  device.assignedPort = nextPort(devices);
  device.approvedAt = new Date().toISOString();
  writeDevices(devices);

  res.json({ ok: true, port: device.assignedPort });
});

// GET /admin/devices — list all devices (admin panel)
router.get("/admin/devices", requireAdmin, (req, res) => {
  res.json({ devices: pruneExpired(readDevices()) });
});

// POST /admin/devices/:deviceCode/revoke
router.post("/admin/devices/:deviceCode/revoke", requireAdmin, (req, res) => {
  const devices = readDevices();
  const device = devices.find((d) => d.deviceCode === req.params.deviceCode);
  if (!device) return res.status(404).json({ error: "Device not found" });
  device.status = "revoked";
  writeDevices(devices);
  res.json({ ok: true });
});

module.exports = { router, getApprovedDeviceForUser, listApprovedDeviceOwners };
