// Device-code enrollment for the downloadable tunnel client (server/tunnel-client).
// A guest runs the client locally, it generates its own SSH keypair, and this
// flow lets them prove who they are via the existing Twitch login + admin
// approval system before the backend grants their public key restricted SSH
// port-forwarding access on the VPS. Flat JSON store, same pattern as users.json.
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { requireApprovedUser } = require("./auth");
const { requireAdmin } = require("./adminAuth");

const DEVICES_PATH = path.join(__dirname, "devices.json");
const PENDING_TTL_MS = 15 * 60 * 1000;
const BASE_PORT = 8001;

// Dedicated, unprivileged SSH user on the VPS used only for restricted
// reverse port-forwarding — see server/README.md for the one-time setup.
// In local dev this file won't exist / won't be writable, which is fine:
// approve() below logs and continues rather than failing the whole request.
const TUNNEL_AUTHORIZED_KEYS = process.env.TUNNEL_AUTHORIZED_KEYS || "/home/tunnel/.ssh/authorized_keys";
const TUNNEL_HOST = process.env.TUNNEL_HOST || "93130123.xyz";
const TUNNEL_SSH_USER = "tunnel";

function readDevices() {
  try {
    return JSON.parse(fs.readFileSync(DEVICES_PATH, "utf8"));
  } catch {
    return [];
  }
}

function writeDevices(devices) {
  fs.writeFileSync(DEVICES_PATH, JSON.stringify(devices, null, 2));
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

// Single-line marker per device so we can find-and-remove it precisely on
// revoke without disturbing any other authorized_keys entries.
function authorizedKeysLine(device) {
  const opts = [
    "restrict",
    "port-forwarding",
    'permitopen="127.0.0.1:8001"',
    `permitlisten="${device.assignedPort}"`,
  ].join(",");
  return `${opts} ${device.publicKey.trim()} vtamigo-device:${device.deviceCode}`;
}

function appendAuthorizedKey(device) {
  try {
    fs.mkdirSync(path.dirname(TUNNEL_AUTHORIZED_KEYS), { recursive: true });
    fs.appendFileSync(TUNNEL_AUTHORIZED_KEYS, authorizedKeysLine(device) + "\n");
  } catch (err) {
    console.warn("[devices] could not write authorized_keys (expected in local dev):", err.message);
  }
}

function removeAuthorizedKey(device) {
  try {
    const lines = fs.readFileSync(TUNNEL_AUTHORIZED_KEYS, "utf8").split("\n");
    const marker = `vtamigo-device:${device.deviceCode}`;
    const kept = lines.filter((l) => !l.includes(marker));
    fs.writeFileSync(TUNNEL_AUTHORIZED_KEYS, kept.join("\n"));
  } catch (err) {
    console.warn("[devices] could not update authorized_keys on revoke:", err.message);
  }
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
router.get("/device/lookup", requireApprovedUser, (req, res) => {
  const { userCode } = req.query;
  const devices = pruneExpired(readDevices());
  const device = devices.find((d) => d.userCode === (userCode || "").toUpperCase());
  if (!device) return res.status(404).json({ error: "Code not found or expired" });
  res.json({ status: device.status, createdAt: device.createdAt });
});

// POST /device/approve — { userCode } — only an already-approved, logged-in
// Twitch user can approve a new device (their own or a guest's).
router.post("/device/approve", requireApprovedUser, (req, res) => {
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
  appendAuthorizedKey(device);

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
  removeAuthorizedKey(device);
  res.json({ ok: true });
});

module.exports = { router };
