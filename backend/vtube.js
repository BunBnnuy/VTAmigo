// VTube Studio WebSocket API client.
// Connects to VTS, authenticates as a plugin, and lets callers inject parameter values.

const { WebSocket } = require("ws");

const PING_INTERVAL_MS = 5000;
const RECONNECT_DELAY_MS = 5000;

let cfg = {
  url: "ws://localhost:8001",
  pluginName: "Twitch Chat Bot",
  developerName: "AICompanion",
};

let ws = null;
let token = null;       // persists across reconnects
let connected = false;
let authenticated = false;
let connecting = false;
let pingTimer = null;
let reconnectTimer = null;
let lastError = null;

// ── Public state ──────────────────────────────────────────────────────────────

function getStatus() {
  return { connected, authenticated, lastError };
}

// ── Config ────────────────────────────────────────────────────────────────────

function setConfig(newCfg) {
  const urlChanged = newCfg.url && newCfg.url !== cfg.url;
  cfg = { ...cfg, ...newCfg };
  if (urlChanged) {
    disconnect();
    connect();
  }
}

// ── Connection lifecycle ──────────────────────────────────────────────────────

function connect() {
  if (connecting || (ws && ws.readyState === WebSocket.OPEN)) return;
  connecting = true;
  clearTimeout(reconnectTimer);

  try {
    ws = new WebSocket(cfg.url);
  } catch (err) {
    console.warn("[vtube] Cannot create WebSocket:", err.message);
    connecting = false;
    scheduleReconnect();
    return;
  }

  ws.on("open", () => {
    connected = true;
    connecting = false;
    authenticated = false;
    lastError = null;
    console.log("[vtube] Connected to VTube Studio");
    startPing();
    requestToken();
  });

  ws.on("message", (raw) => {
    try { handleMessage(JSON.parse(raw.toString())); } catch {}
  });

  ws.on("close", () => {
    connected = false;
    authenticated = false;
    connecting = false;
    clearInterval(pingTimer);
    console.log("[vtube] Disconnected");
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    // Swallow — close event will handle reconnect
    console.warn("[vtube] Error:", err.message);
  });
}

function disconnect() {
  clearInterval(pingTimer);
  clearTimeout(reconnectTimer);
  if (ws) {
    ws.removeAllListeners();
    try { ws.close(); } catch {}
    ws = null;
  }
  connected = false;
  authenticated = false;
  connecting = false;
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
}

// ── VTS API ───────────────────────────────────────────────────────────────────

function send(msgType, data, reqId) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    apiName: "VTubeStudioPublicAPI",
    apiVersion: "1.0",
    requestID: reqId || msgType,
    messageType: msgType,
    data: data || {},
  }));
}

function requestToken() {
  if (token) {
    authenticate();
    return;
  }
  send("AuthenticationTokenRequest", {
    pluginName: cfg.pluginName,
    pluginDeveloper: cfg.developerName,
  }, "token_req");
}

function authenticate() {
  send("AuthenticationRequest", {
    pluginName: cfg.pluginName,
    pluginDeveloper: cfg.developerName,
    authenticationToken: token,
  }, "auth_req");
}

let _loggedFirstInject = false;

function handleMessage(msg) {
  switch (msg.messageType) {
    case "AuthenticationTokenResponse":
      if (msg.data?.authenticationToken) {
        token = msg.data.authenticationToken;
        console.log("[vtube] Token received, authenticating…");
        authenticate();
      } else {
        console.warn("[vtube] Token request failed:", JSON.stringify(msg.data));
      }
      break;

    case "AuthenticationResponse":
      if (msg.data?.authenticated) {
        authenticated = true;
        lastError = null;
        console.log("[vtube] Plugin authenticated");
      } else {
        const reason = msg.data?.reason || "unknown";
        console.warn("[vtube] Auth rejected:", reason, "— requesting new token");
        lastError = "auth_rejected: " + reason;
        token = null;
        authenticated = false;
        // Request a fresh token (will trigger the VTS allow popup again)
        requestToken();
      }
      break;

    case "InjectParameterDataResponse":
      // Log the first injection response so we can confirm it works
      if (!_loggedFirstInject) {
        _loggedFirstInject = true;
        console.log("[vtube] First inject response:", JSON.stringify(msg.data));
      }
      break;

    case "APIError":
      lastError = `${msg.data?.errorID}: ${msg.data?.message}`;
      console.error("[vtube] API Error:", lastError);
      break;

    default:
      break;
  }
}

function startPing() {
  clearInterval(pingTimer);
  pingTimer = setInterval(() => {
    send("APIStateRequest", {}, "ping");
  }, PING_INTERVAL_MS);
}

// ── Parameter injection ───────────────────────────────────────────────────────

function injectParam(paramName, value) {
  if (!authenticated) return;
  // VTS clamps to the parameter's own min/max internally — don't restrict here
  send("InjectParameterDataRequest", {
    faceFound: false,
    mode: "set",
    parameterValues: [{ id: paramName, value, weight: 1 }],
  }, "inject");
}

// Start connecting immediately — if VTS isn't running this is a no-op (reconnects silently)
connect();

module.exports = { injectParam, getStatus, setConfig, connect, disconnect };
