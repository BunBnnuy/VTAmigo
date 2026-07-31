const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

const isDev = !app.isPackaged;
const BACKEND_PORT = 3001;
const DEV_FRONTEND_URL = `http://localhost:5173`;
const PROD_FRONTEND_URL = `http://localhost:${BACKEND_PORT}`;

let mainWindow = null;

// ── Start backend ─────────────────────────────────────────────────────────────
let backendProc = null;

function startBackend() {
  const backendPath = isDev
    ? path.join(__dirname, "../backend/index.js")
    : path.join(process.resourcesPath, "backend/index.js");

  // Spawn as a separate Node.js process so it runs without Electron's
  // security restrictions (needed for worker_threads to fetch from the network).
  backendProc = spawn(process.execPath, [backendPath], {
    stdio: "inherit",
    env: { ...process.env },
  });

  backendProc.on("error", (err) => console.error("[electron] Backend error:", err.message));
  backendProc.on("exit", (code) => console.log("[electron] Backend exited:", code));
  console.log("[electron] Backend started as child process (pid", backendProc.pid, ")");
}

app.on("will-quit", () => {
  if (backendProc) backendProc.kill();
});

// ── Wait for a URL to respond before opening the window ──────────────────────
function waitForURL(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const http = require("http");

    const try_ = () => {
      http.get(url, () => resolve()).on("error", () => {
        if (Date.now() - start > timeout) return reject(new Error(`Timeout waiting for ${url}`));
        setTimeout(try_, 500);
      });
    };
    try_();
  });
}

// ── Create window ─────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "VTAmigo",
    backgroundColor: "#0e0e10",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
    // Remove default menu bar
    autoHideMenuBar: true,
  });

  const url = isDev ? DEV_FRONTEND_URL : PROD_FRONTEND_URL;
  mainWindow.loadURL(url);

  // Open external links in the system browser, not in Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.on("closed", () => { mainWindow = null; });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  if (!isDev) startBackend();

  // In dev, Vite may still be starting — wait for it
  const waitURL = isDev ? DEV_FRONTEND_URL : PROD_FRONTEND_URL;
  try {
    await waitForURL(`${waitURL}/`);
  } catch {
    console.warn("[electron] Frontend not responding, opening anyway");
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
