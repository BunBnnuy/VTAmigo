const WebSocket = require("ws");
const https = require("https");

const EVENTSUB_URL = "wss://eventsub.wss.twitch.tv/ws";
const KEEPALIVE_TIMEOUT_MS = 35000;

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on("error", reject);
  });
}

function httpsPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const urlObj = new URL(url);
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, data }); }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function getBroadcasterId(channel, clientId, token) {
  const res = await httpsGet(
    `https://api.twitch.tv/helix/users?login=${encodeURIComponent(channel)}`,
    { "Client-ID": clientId, Authorization: `Bearer ${token}` }
  );
  if (res.status !== 200 || !res.data.data?.length) {
    throw new Error(
      `No se pudo obtener el ID del canal "${channel}" (HTTP ${res.status}). Verifica el Client-ID y el token OAuth.`
    );
  }
  return res.data.data[0].id;
}

async function subscribe(sessionId, broadcasterId, clientId, token, type, version, condition) {
  const res = await httpsPost(
    "https://api.twitch.tv/helix/eventsub/subscriptions",
    { "Client-ID": clientId, Authorization: `Bearer ${token}` },
    { type, version, condition, transport: { method: "websocket", session_id: sessionId } }
  );
  if (res.status !== 202) {
    // Log but don't throw — missing scope for one event type shouldn't kill the whole connection
    console.warn(`[eventsub] No se pudo suscribir a "${type}": ${res.data?.message || res.status}`);
  }
}

async function subscribeAll(sessionId, broadcasterId, clientId, token) {
  const auth = { "Client-ID": clientId, Authorization: `Bearer ${token}` };
  const b = { broadcaster_user_id: broadcasterId };

  await Promise.allSettled([
    subscribe(sessionId, broadcasterId, clientId, token,
      "channel.channel_points_custom_reward_redemption.add", "1", b),
    subscribe(sessionId, broadcasterId, clientId, token,
      "channel.follow", "2", { ...b, moderator_user_id: broadcasterId }),
    subscribe(sessionId, broadcasterId, clientId, token,
      "channel.subscribe", "1", b),
    subscribe(sessionId, broadcasterId, clientId, token,
      "channel.subscription.message", "1", b),
    subscribe(sessionId, broadcasterId, clientId, token,
      "channel.subscription.gift", "1", b),
    subscribe(sessionId, broadcasterId, clientId, token,
      "channel.raid", "1", { to_broadcaster_user_id: broadcasterId }),
    subscribe(sessionId, broadcasterId, clientId, token,
      "channel.cheer", "1", b),
  ]);
}

// Parse a raw Twitch EventSub notification into a unified event object
function parseEvent(subscriptionType, event) {
  switch (subscriptionType) {
    case "channel.channel_points_custom_reward_redemption.add":
      return {
        kind: "redeem",
        username: event.user_name || event.user_login,
        rewardTitle: event.reward?.title || "Canje de puntos",
        rewardId: event.reward?.id || null,
        text: event.user_input || "",
        isSilentRedeem: !event.user_input,
        isRedeem: true,
      };

    case "channel.follow":
      return {
        kind: "follow",
        username: event.user_name || event.user_login,
      };

    case "channel.subscribe":
      return {
        kind: "sub",
        username: event.user_name || event.user_login,
        tier: event.tier || "1000",
        isGift: event.is_gift || false,
      };

    case "channel.subscription.message":
      return {
        kind: "resub",
        username: event.user_name || event.user_login,
        tier: event.tier || "1000",
        months: event.cumulative_months || 1,
        streak: event.streak_months || null,
        message: event.message?.text || "",
      };

    case "channel.subscription.gift":
      return {
        kind: "giftsub",
        username: event.user_name || event.user_login || "Anónimo",
        tier: event.tier || "1000",
        count: event.total || 1,
        isAnonymous: event.is_anonymous || false,
      };

    case "channel.raid":
      return {
        kind: "raid",
        username: event.from_broadcaster_user_name || event.from_broadcaster_user_login,
        viewers: event.viewers || 0,
      };

    case "channel.cheer":
      return {
        kind: "cheer",
        username: event.user_name || event.user_login || "Anónimo",
        bits: event.bits || 0,
        message: event.message || "",
        isAnonymous: event.is_anonymous || false,
      };

    default:
      return null;
  }
}

class EventSubClient {
  constructor({ channel, clientId, token, onRedeem, onEvent, onStatus }) {
    this.channel = channel.toLowerCase().replace(/^#/, "");
    this.clientId = clientId;
    this.token = token.replace(/^oauth:/, "");
    this.onRedeem = onRedeem;
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.ws = null;
    this.dead = false;
    this.reconnectDelay = 2000;
    this.keepaliveTimer = null;
  }

  connect() {
    this.dead = false;
    this._open();
  }

  _open() {
    if (this.dead) return;
    this.onStatus({ type: "eventsub_connecting" });

    const ws = new WebSocket(EVENTSUB_URL);
    this.ws = ws;
    this._attachHandlers(ws);
  }

  _attachHandlers(ws) {
    ws.on("open", () => {
      this.reconnectDelay = 2000;
      this._resetKeepalive();
    });

    ws.on("message", async (data) => {
      this._resetKeepalive();
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }

      const msgType = msg.metadata?.message_type;

      if (msgType === "session_welcome") {
        const sessionId = msg.payload.session.id;
        try {
          const broadcasterId = await getBroadcasterId(this.channel, this.clientId, this.token);
          await subscribeAll(sessionId, broadcasterId, this.clientId, this.token);
          this.onStatus({ type: "eventsub_connected", channel: this.channel });
        } catch (err) {
          this.onStatus({ type: "eventsub_error", message: err.message });
          ws.close();
        }
      } else if (msgType === "session_keepalive") {
        // heartbeat — nothing to do
      } else if (msgType === "notification") {
        const subType = msg.payload?.subscription?.type;
        const event = msg.payload?.event;
        if (!event) return;

        const parsed = parseEvent(subType, event);
        if (!parsed) return;

        if (parsed.kind === "redeem") {
          // Redeems go to the chat feed via the existing onRedeem path
          this.onRedeem({
            id: event.id || `${Date.now()}-${Math.random()}`,
            username: parsed.username,
            color: "#9147ff",
            timestamp: Date.now(),
            rewardTitle: parsed.rewardTitle,
            rewardId: parsed.rewardId,
            text: parsed.text,
            isSilentRedeem: parsed.isSilentRedeem,
            isRedeem: true,
            isHype: false,
          });
        } else {
          // All other events (follow, sub, raid, etc.) go to onEvent for immediate response
          this.onEvent({
            id: `${Date.now()}-${Math.random()}`,
            timestamp: Date.now(),
            ...parsed,
          });
        }
      } else if (msgType === "session_reconnect") {
        const reconnectUrl = msg.payload?.session?.reconnect_url;
        if (reconnectUrl) this._reconnectTo(reconnectUrl);
      } else if (msgType === "revocation") {
        this.onStatus({ type: "eventsub_error", message: "Suscripción revocada por Twitch." });
      }
    });

    ws.on("close", () => {
      clearTimeout(this.keepaliveTimer);
      if (!this.dead) {
        this.onStatus({ type: "eventsub_disconnected" });
        setTimeout(() => {
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
          this._open();
        }, this.reconnectDelay);
      }
    });

    ws.on("error", (err) => {
      this.onStatus({ type: "eventsub_error", message: err.message });
    });
  }

  _reconnectTo(url) {
    const oldWs = this.ws;
    const ws = new WebSocket(url);
    this.ws = ws;
    this._attachHandlers(ws);
    // Close old connection once new one sends welcome
    const origOnMsg = ws.listeners("message")[0];
    ws.once("message", (data) => {
      try {
        if (JSON.parse(data.toString()).metadata?.message_type === "session_welcome") {
          oldWs.close();
        }
      } catch {}
    });
  }

  _resetKeepalive() {
    clearTimeout(this.keepaliveTimer);
    this.keepaliveTimer = setTimeout(() => {
      if (this.ws) this.ws.close();
    }, KEEPALIVE_TIMEOUT_MS);
  }

  disconnect() {
    this.dead = true;
    clearTimeout(this.keepaliveTimer);
    if (this.ws) { this.ws.close(); this.ws = null; }
  }
}

module.exports = { EventSubClient };
