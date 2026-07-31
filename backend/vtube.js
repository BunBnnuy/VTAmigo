// VTube Studio WebSocket API client. Connects to VTS, authenticates as a
// plugin, and lets callers inject parameter values.
//
// createConnection() returns one independent connection — callers that need
// to talk to several separate VTS instances (e.g. one per approved tunnel)
// should keep their own registry of connections rather than sharing one.

const { WebSocket } = require("ws");

const PING_INTERVAL_MS = 5000;
const RECONNECT_DELAY_MS = 5000;
const DEFAULT_PLUGIN_NAME = "Twitch Chat Bot";
const DEFAULT_DEVELOPER_NAME = "AICompanion";

function createConnection(initialUrl) {
  let cfg = { url: initialUrl, pluginName: DEFAULT_PLUGIN_NAME, developerName: DEFAULT_DEVELOPER_NAME };

  let ws = null;
  let token = null;       // persists across reconnects
  let connected = false;
  let authenticated = false;
  let connecting = false;
  let pingTimer = null;
  let reconnectTimer = null;
  let lastError = null;
  let _loggedFirstInject = false;

  // ── Public state ────────────────────────────────────────────────────────────

  function getStatus() {
    return { connected, authenticated, lastError, url: cfg.url };
  }

  // ── Config ──────────────────────────────────────────────────────────────────

  function setConfig(newCfg) {
    const urlChanged = newCfg.url && newCfg.url !== cfg.url;
    cfg = { ...cfg, ...newCfg };
    if (urlChanged) {
      disconnect();
      connect();
    }
  }

  // ── Connection lifecycle ────────────────────────────────────────────────────

  function connect() {
    if (connecting || (ws && ws.readyState === WebSocket.OPEN)) return;
    connecting = true;
    clearTimeout(reconnectTimer);

    try {
      // Every tunnel (vtube-tunnel.ps1 and the downloadable tunnel client)
      // forwards straight through to the client's local VTS on 127.0.0.1:8001,
      // regardless of which port we're dialing here on the VPS side. VTS's
      // WebSocket server validates the Host header against its own bound
      // port and rejects a mismatch with 400 — so the Host header must always
      // say "localhost:8001" even when cfg.url points at a different port.
      ws = new WebSocket(cfg.url, { headers: { Host: "localhost:8001" } });
    } catch (err) {
      console.warn(`[vtube:${cfg.url}] Cannot create WebSocket:`, err.message);
      connecting = false;
      scheduleReconnect();
      return;
    }

    ws.on("open", () => {
      connected = true;
      connecting = false;
      authenticated = false;
      lastError = null;
      console.log(`[vtube:${cfg.url}] Connected to VTube Studio`);
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
      console.log(`[vtube:${cfg.url}] Disconnected`);
      scheduleReconnect();
    });

    ws.on("error", (err) => {
      // Swallow — close event will handle reconnect
      console.warn(`[vtube:${cfg.url}] Error:`, err.message);
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

  // ── VTS API ─────────────────────────────────────────────────────────────────

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

  function handleMessage(msg) {
    switch (msg.messageType) {
      case "AuthenticationTokenResponse":
        if (msg.data?.authenticationToken) {
          token = msg.data.authenticationToken;
          console.log(`[vtube:${cfg.url}] Token received, authenticating…`);
          authenticate();
        } else {
          console.warn(`[vtube:${cfg.url}] Token request failed:`, JSON.stringify(msg.data));
        }
        break;

      case "AuthenticationResponse":
        if (msg.data?.authenticated) {
          authenticated = true;
          lastError = null;
          console.log(`[vtube:${cfg.url}] Plugin authenticated`);
        } else {
          const reason = msg.data?.reason || "unknown";
          console.warn(`[vtube:${cfg.url}] Auth rejected:`, reason, "— requesting new token");
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
          console.log(`[vtube:${cfg.url}] First inject response:`, JSON.stringify(msg.data));
        }
        break;

      case "APIError":
        lastError = `${msg.data?.errorID}: ${msg.data?.message}`;
        console.error(`[vtube:${cfg.url}] API Error:`, lastError);
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

  // ── Parameter injection ─────────────────────────────────────────────────────

  function injectParam(paramName, value) {
    if (!authenticated) return;
    // VTS clamps to the parameter's own min/max internally — don't restrict here
    send("InjectParameterDataRequest", {
      faceFound: false,
      mode: "set",
      parameterValues: [{ id: paramName, value, weight: 1 }],
    }, "inject");
  }

  connect();

  return { injectParam, getStatus, setConfig, connect, disconnect };
}

module.exports = { createConnection };
