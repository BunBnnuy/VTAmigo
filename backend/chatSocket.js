const { randomUUID } = require("crypto");

// Native ping/pong keeps OBS and browsers alive through idle proxies. The
// JSON heartbeat also lets the app detect a connection that silently stalls.
function monitorChatSocket(ws, { login, client }) {
  const id = randomUUID();
  let lastPongAt = Date.now();
  const context = { id, login, client };
  console.log("[ws] connected", JSON.stringify(context));
  ws.on("pong", () => { lastPongAt = Date.now(); });
  const timer = setInterval(() => {
    if (ws.readyState !== 1) return;
    if (Date.now() - lastPongAt > 90000) {
      console.warn("[ws] heartbeat_timeout", JSON.stringify(context));
      ws.terminate();
      return;
    }
    ws.ping();
    ws.send(JSON.stringify({ type: "heartbeat" }));
  }, 25000);
  timer.unref?.();
  ws.on("error", (error) => {
    console.warn("[ws] error", JSON.stringify({ ...context, message: error.message }));
  });
  ws.on("close", (code, reason) => {
    clearInterval(timer);
    console.log("[ws] disconnected", JSON.stringify({
      ...context, code, reason: String(reason).slice(0, 200),
    }));
  });
}

module.exports = { monitorChatSocket };
