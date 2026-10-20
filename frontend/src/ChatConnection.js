// Owns retries independently of React renders. Reconnecting only replaces the
// browser socket; the server resumes the account's Twitch session if needed.
export class ChatConnection {
  constructor({ url, onOpen, onClose, onMessage, onDiagnostic, WebSocketImpl = WebSocket }) {
    Object.assign(this, { url, onOpen, onClose, onMessage, onDiagnostic, WebSocketImpl });
    this.socket = null;
    this.stopped = true;
    this.retryDelay = 1000;
    this.wake = () => {
      if (this.stopped) return;
      if (this.socket && Date.now() - this.lastMessageAt > 90000) this.expire();
      else if (!this.socket) { clearTimeout(this.retryTimer); this.open(); }
    };
  }

  start() {
    this.stop();
    this.stopped = false;
    this.retryDelay = 1000;
    window.addEventListener("online", this.wake);
    document.addEventListener("visibilitychange", this.wake);
    this.open();
  }

  open() {
    if (this.stopped || this.socket) return;
    let ws;
    try { ws = new this.WebSocketImpl(this.url()); }
    catch (error) { this.onDiagnostic?.({ reason: error.message }); this.retry(); return; }
    this.socket = ws;
    this.lastMessageAt = Date.now();
    this.watchdog = setInterval(() => {
      if (Date.now() - this.lastMessageAt > 90000) this.expire();
    }, 25000);
    ws.onopen = () => {
      if (ws !== this.socket) return;
      this.retryDelay = 1000;
      this.lastMessageAt = Date.now();
      this.onOpen?.();
    };
    ws.onmessage = (event) => {
      if (ws !== this.socket) return;
      this.lastMessageAt = Date.now();
      this.onMessage?.(event);
    };
    ws.onerror = () => {}; // close carries the actionable code/reason
    ws.onclose = (event) => {
      if (ws !== this.socket) return;
      this.socket = null;
      clearInterval(this.watchdog);
      this.onClose?.();
      this.onDiagnostic?.({ code: event.code, reason: event.reason, wasClean: event.wasClean });
      // Revoked authentication needs a fresh login, not an endless retry loop.
      if (event.code === 4401 || event.code === 4403) this.stop();
      else this.retry();
    };
  }

  expire() {
    this.releaseSocket();
    this.onClose?.();
    this.onDiagnostic?.({ reason: "heartbeat_timeout" });
    this.retry();
  }

  retry() {
    if (this.stopped) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.open(), this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, 30000);
  }

  releaseSocket() {
    clearInterval(this.watchdog);
    const ws = this.socket;
    this.socket = null;
    if (ws) {
      ws.onopen = ws.onclose = ws.onmessage = ws.onerror = null;
      ws.close();
    }
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    window.removeEventListener("online", this.wake);
    document.removeEventListener("visibilitychange", this.wake);
    this.releaseSocket();
  }
}
