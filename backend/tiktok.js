const { WebcastPushConnection } = require("tiktok-live-connector");

class TikTokChatClient {
  constructor({ username, onMessage, onStatus }) {
    this.username = username;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.connection = null;
    this.dead = false;
    this.reconnectDelay = 2000;
    this._reconnectTimer = null;
  }

  connect() {
    this.dead = false;
    this._open();
  }

  _open() {
    if (this.dead) return;
    this.onStatus({ type: "connecting", channel: this.username });

    const conn = new WebcastPushConnection(this.username, {
      enableExtendedGiftInfo: false,
      requestPollingIntervalMs: 2000,
    });
    this.connection = conn;

    conn.connect()
      .then((state) => {
        this.reconnectDelay = 2000;
        this.onStatus({ type: "connected", channel: this.username });
      })
      .catch((err) => {
        this.onStatus({ type: "error", message: err.message });
        this._scheduleReconnect();
      });

    conn.on("chat", (data) => {
      this.onMessage({
        id: `tiktok-${Date.now()}-${Math.random()}`,
        username: data.uniqueId || data.nickname || "user",
        channel: this.username,
        text: data.comment || "",
        color: "#fe2c55",
        timestamp: Date.now(),
        isHype: false,
        isRedeem: false,
        platform: "tiktok",
      });
    });

    conn.on("gift", (data) => {
      if (!data.isRepeating) {
        this.onMessage({
          id: `tiktok-gift-${Date.now()}-${Math.random()}`,
          username: data.uniqueId || "user",
          channel: this.username,
          text: `gifted ${data.repeatCount}x ${data.giftName}`,
          color: "#ff9f43",
          timestamp: Date.now(),
          isRedeem: true,
          rewardTitle: data.giftName,
          platform: "tiktok",
        });
      }
    });

    conn.on("disconnected", () => {
      if (!this.dead) {
        this.onStatus({ type: "disconnected" });
        this._scheduleReconnect();
      }
    });

    conn.on("error", (err) => {
      this.onStatus({ type: "error", message: err.info || err.message || String(err) });
    });
  }

  _scheduleReconnect() {
    if (this.dead) return;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
      this._open();
    }, this.reconnectDelay);
  }

  disconnect() {
    this.dead = true;
    clearTimeout(this._reconnectTimer);
    if (this.connection) {
      try { this.connection.disconnect(); } catch {}
      this.connection = null;
    }
  }
}

module.exports = { TikTokChatClient };
