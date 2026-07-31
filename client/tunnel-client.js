// VTAmigo tunnel client — lets a guest's PC open a VTube Studio lip-sync
// reverse tunnel to the VPS without ever handling a shared SSH private key.
//
// Flow: generate a local-only keypair -> register it with the backend ->
// show a short code + open the approval page in a browser -> poll until an
// already-approved VTAmigo user approves the device -> open the tunnel.
//
// Packaged into a single .exe with `pkg` (see package.json's
// build:tunnel-client script). Shells out to Windows' built-in OpenSSH
// client (ssh.exe / ssh-keygen.exe), same as server/vtube-tunnel.ps1 does.
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BACKEND = "https://vtamigo.top";
const CONFIG_DIR = path.join(os.homedir(), "AppData", "Local", "vtamigo-tunnel");
const KEY_PATH = path.join(CONFIG_DIR, "id_ed25519");
const STATE_PATH = path.join(CONFIG_DIR, "state.json");
const POLL_INTERVAL_MS = 3000;

function log(msg) {
  console.log(`[tunnel-client] ${msg}`);
}

function ensureKeypair() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  if (!fs.existsSync(KEY_PATH)) {
    log("Generating a local keypair (stays on this machine)...");
    execFileSync("ssh-keygen", ["-t", "ed25519", "-N", "", "-f", KEY_PATH], { stdio: "ignore" });
  }
  return fs.readFileSync(`${KEY_PATH}.pub`, "utf8").trim();
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return null;
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function openBrowser(url) {
  const cmd = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
}

async function registerDevice(publicKey) {
  const res = await fetch(`${BACKEND}/device/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKey }),
  });
  if (!res.ok) throw new Error(`device/init failed (${res.status})`);
  return res.json(); // { deviceCode, userCode, verifyUrl }
}

async function pollDevice(deviceCode) {
  const res = await fetch(`${BACKEND}/device/poll?deviceCode=${deviceCode}`);
  return res.json(); // { status } or { status: "approved", port, host, tunnelUser }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForApproval(deviceCode) {
  for (;;) {
    const result = await pollDevice(deviceCode);
    if (result.status === "approved") return result;
    if (result.status === "expired" || result.status === "revoked") {
      throw new Error(`Device ${result.status} — run this program again to re-enroll.`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

function runTunnel({ host, port, tunnelUser }) {
  log(`Starting reverse tunnel: ${host} port ${port} -> this PC's VTube Studio (127.0.0.1:8001)`);
  log("Leave this window open while streaming. Ctrl+C to stop.");

  const connect = () => {
    const ssh = spawn(
      "ssh",
      [
        "-i", KEY_PATH,
        "-N", "-R", `${port}:127.0.0.1:8001`,
        "-o", "ServerAliveInterval=30",
        "-o", "ServerAliveCountMax=3",
        "-o", "ExitOnForwardFailure=yes",
        "-o", "StrictHostKeyChecking=accept-new",
        `${tunnelUser}@${host}`,
      ],
      { stdio: "inherit" }
    );
    ssh.on("exit", () => {
      log("Tunnel dropped, reconnecting in 5s... (Ctrl+C to stop)");
      setTimeout(connect, 5000);
    });
  };
  connect();
}

async function main() {
  const publicKey = ensureKeypair();
  let state = readState();

  if (state && state.status === "approved") {
    log("Using previously-approved device credentials.");
    // Re-check in case an admin revoked it since last run.
    const result = await pollDevice(state.deviceCode);
    if (result.status === "approved") {
      return runTunnel(result);
    }
    log("Previous approval no longer valid — re-enrolling.");
    state = null;
  }

  log("Registering this device...");
  const { deviceCode, userCode, verifyUrl } = await registerDevice(publicKey);
  writeState({ deviceCode, status: "pending" });

  console.log("");
  console.log(`  Device code: ${userCode}`);
  console.log(`  Approve at:  ${verifyUrl}`);
  console.log("");
  log("Opening your browser — log in and approve this device to continue.");
  openBrowser(verifyUrl);

  const result = await waitForApproval(deviceCode);
  writeState({ deviceCode, status: "approved" });
  log("Device approved!");
  runTunnel(result);
}

main().catch((err) => {
  console.error(`[tunnel-client] Error: ${err.message}`);
  process.exitCode = 1;
});
