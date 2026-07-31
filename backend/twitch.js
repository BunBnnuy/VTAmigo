const WebSocket = require("ws");

const TWITCH_IRC_URL = "wss://irc-ws.chat.twitch.tv:443";

// Hype keywords that can trigger early batching
const HYPE_KEYWORDS = [
  "pogchamp",
  "pog",
  "omegalul",
  "lul",
  "kekw",
  "lets go",
  "let's go",
  "clip it",
  "letsgo",
  "gg",
  "w",
  "based",
  "hyped",
];

function parseTwitchMessage(raw) {
  // Parse: @tags :user!user@user.tmi.twitch.tv PRIVMSG #channel :message
  const tagMatch = raw.match(/^@([^ ]+) /);
  const tags = {};
  if (tagMatch) {
    tagMatch[1].split(";").forEach((kv) => {
      const [k, v] = kv.split("=");
      tags[k] = v;
    });
  }

  const rest = tagMatch ? raw.slice(tagMatch[0].length) : raw;
  const msgMatch = rest.match(/^:(\w+)!\w+@\S+ PRIVMSG #(\S+) :(.+)$/s);
  if (!msgMatch) return null;

  const [, username, channel, text] = msgMatch;
  const color = tags["color"] || "#9147ff";
  const rewardId = tags["custom-reward-id"] || null;
  const rewardTitle = rewardId ? (tags["msg-param-reward-title"] || "Canje de puntos de canal") : null;

  return {
    id: tags["id"] || `${Date.now()}-${Math.random()}`,
    username,
    channel,
    text: text.trim(),
    color,
    timestamp: Date.now(),
    isHype: HYPE_KEYWORDS.some((kw) => text.toLowerCase().includes(kw)),
    isRedeem: !!rewardId,
    rewardId,
    rewardTitle,
  };
}

class TwitchIRCClient {
  constructor({ channel, token, username, onMessage, onStatus }) {
    this.channel = channel.toLowerCase().replace(/^#/, "");
    this.token = token;
    this.username = username || "justinfan" + Math.floor(Math.random() * 80000);
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.ws = null;
    this.reconnectDelay = 1000;
    this.dead = false;
    this.ready = false;
    this.pendingSays = [];
  }

  connect() {
    this.dead = false;
    this._open();
  }

  _open() {
    if (this.dead) return;
    this.onStatus({ type: "connecting", channel: this.channel });

    const ws = new WebSocket(TWITCH_IRC_URL);
    this.ws = ws;

    ws.on("open", () => {
      this.reconnectDelay = 1000;
      const pass = this.token
        ? `oauth:${this.token.replace(/^oauth:/, "")}`
        : "SCHMOOPIIE";
      ws.send(`PASS ${pass}`);
      ws.send(`NICK ${this.username}`);
      ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
      ws.send(`JOIN #${this.channel}`);
    });

    ws.on("message", (data) => {
      const raw = data.toString();
      for (const line of raw.split("\r\n")) {
        if (!line) continue;
        if (line.startsWith("PING")) {
          ws.send("PONG :tmi.twitch.tv");
          continue;
        }
        if (line.includes("PRIVMSG")) {
          const msg = parseTwitchMessage(line);
          if (msg) this.onMessage(msg);
        }
        if (line.includes(":Welcome, GLHF!")) {
          this.ready = true;
          this.onStatus({ type: "connected", channel: this.channel });
          this._flushPending();
        }
        if (line.includes("NOTICE")) {
          console.log(`[twitch/${this.username}] NOTICE:`, line);
          if (line.includes("Login authentication failed") || line.includes("Login unsuccessful")) {
            this.onStatus({ type: "auth_error" });
          }
        }
      }
    });

    ws.on("close", () => {
      this.ready = false;
      if (!this.dead) {
        this.onStatus({ type: "disconnected" });
        setTimeout(() => {
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
          this._open();
        }, this.reconnectDelay);
      }
    });

    ws.on("error", (err) => {
      this.onStatus({ type: "error", message: err.message });
    });
  }

  _send(text) {
    if (this.ws && this.ws.readyState === 1 /* OPEN */) {
      this.ws.send(`PRIVMSG #${this.channel} :${text}`);
      return true;
    }
    return false;
  }

  _flushPending() {
    const queued = this.pendingSays;
    this.pendingSays = [];
    for (const text of queued) this._send(text);
  }

  // If the IRC handshake hasn't completed yet (e.g. a message arrives right
  // as the bot is still connecting), queue it instead of dropping it —
  // it gets flushed once the "Welcome, GLHF!" auth confirmation lands.
  say(text) {
    if (this.ready) return this._send(text);
    if (this.pendingSays.length < 10) this.pendingSays.push(text);
    return true;
  }

  disconnect() {
    this.dead = true;
    this.ready = false;
    this.pendingSays = [];
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

module.exports = { TwitchIRCClient };
