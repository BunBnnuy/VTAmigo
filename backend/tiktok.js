const { TikTokLiveConnection, WebcastEvent, ControlEvent } = require("tiktok-live-connector");

class TikTokChatClient {
  constructor({ username, onMessage, onStatus }) {
    this.username = username.replace(/^@/, "");
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

    // Remove listeners from previous connection so stale events can't fire
    if (this.connection) {
      try { this.connection.removeAllListeners(); this.connection.disconnect(); } catch {}
      this.connection = null;
    }

    this.onStatus({ type: "connecting", channel: this.username });

    const conn = new TikTokLiveConnection(`@${this.username}`, { processInitialData: false });
    this.connection = conn;

    conn.on(ControlEvent.CONNECTED, () => {
      if (this.connection !== conn) return;
      this.reconnectDelay = 2000;
      this.onStatus({ type: "connected", channel: this.username });
    });

    conn.on(ControlEvent.DISCONNECTED, () => {
      if (this.connection !== conn) return;
      if (!this.dead) {
        this.onStatus({ type: "disconnected" });
        this._scheduleReconnect();
      }
    });

    conn.on(ControlEvent.ERROR, (err) => {
      if (this.connection !== conn) return;
      const msg = err?.message || err?.info || String(err);
      this.onStatus({ type: "error", message: msg });
    });

    conn.on(WebcastEvent.CHAT, (data) => {
      if (this.connection !== conn || this.dead) return;
      const username = data?.user?.nickname || data?.user?.id || "user";
      const text = data?.content || "";
      if (!text) return;
      const msgId = data?.common?.msgId;
      this.onMessage({
        id: msgId ? `tiktok-${msgId}` : `tiktok-${Date.now()}-${Math.random()}`,
        username,
        channel: this.username,
        text,
        color: "#fe2c55",
        timestamp: Date.now(),
        isHype: false,
        isRedeem: false,
        platform: "tiktok",
      });
    });

    conn.on(WebcastEvent.GIFT, (data) => {
      if (this.connection !== conn || this.dead) return;
      if (data?.gift?.repeatEnd || !data?.gift?.repeatCount) {
        const username = data?.user?.nickname || data?.user?.id || "user";
        const giftName = data?.gift?.giftDetails?.giftName || "gift";
        const count = data?.gift?.repeatCount || 1;
        const msgId = data?.common?.msgId;
        this.onMessage({
          id: msgId ? `tiktok-gift-${msgId}` : `tiktok-gift-${Date.now()}-${Math.random()}`,
          username,
          channel: this.username,
          text: `gifted ${count}x ${giftName}`,
          color: "#ff9f43",
          timestamp: Date.now(),
          isRedeem: true,
          rewardTitle: giftName,
          platform: "tiktok",
        });
      }
    });

    conn.connect().catch((err) => {
      if (this.connection !== conn) return;
      const msg = err?.message || String(err);
      this.onStatus({ type: "error", message: msg });
      if (!this.dead) this._scheduleReconnect();
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
      try { this.connection.removeAllListeners(); this.connection.disconnect(); } catch {}
      this.connection = null;
    }
  }
}

module.exports = { TikTokChatClient };
