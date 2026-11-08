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

// IRCv3 tags escape a handful of characters so a value can never break the
// line: \s is a space, \: a semicolon, \\ a backslash, \r / \n newlines.
// Only the USERNOTICE fields we render (system-msg, the viewer's message)
// actually need decoding, but the helper is shared by both parsers.
const TAG_ESCAPES = { s: " ", ":": ";", "\\": "\\", r: "\r", n: "\n" };

function unescapeTagValue(value) {
  return String(value).replace(/\\(.)/g, (_, ch) => (ch in TAG_ESCAPES ? TAG_ESCAPES[ch] : ch));
}

// Split a raw IRC line into its tags and the tagless remainder. Values may
// contain "=" (tag ids, base64-ish payloads), so only the first one separates
// the key from the value.
function splitIrcTags(raw) {
  const tagMatch = raw.match(/^@([^ ]+) /);
  const tags = {};
  if (!tagMatch) return { tags, rest: raw };
  for (const kv of tagMatch[1].split(";")) {
    const eq = kv.indexOf("=");
    if (eq === -1) continue;
    tags[kv.slice(0, eq)] = kv.slice(eq + 1);
  }
  return { tags, rest: raw.slice(tagMatch[0].length) };
}

function parseTwitchMessage(raw) {
  // Parse: @tags :user!user@user.tmi.twitch.tv PRIVMSG #channel :message
  const { tags, rest } = splitIrcTags(raw);
  const msgMatch = rest.match(/^:(\w+)!\w+@\S+ PRIVMSG #(\S+) :(.+)$/s);
  if (!msgMatch) return null;

  const [, username, channel, rawText] = msgMatch;
  // "/me" messages arrive CTCP-wrapped as \x01ACTION <text>\x01 — strip the
  // envelope so the control bytes never reach a renderer, and flag it so the
  // overlay can italicize/colorize the way Twitch does.
  const actionMatch = rawText.match(/^\x01ACTION (.*)\x01$/s);
  const isAction = !!actionMatch;
  const text = actionMatch ? actionMatch[1] : rawText;
  const color = tags["color"] || "#9147ff";
  const rewardId = tags["custom-reward-id"] || null;
  const rewardTitle = rewardId ? (tags["msg-param-reward-title"] || "Canje de puntos de canal") : null;
  // The IRC prefix's username is always lowercase (it's the login name);
  // "display-name" carries the user's actual capitalization (and, for CJK
  // etc. logins, their native-script display name), so prefer it for anything
  // shown on screen.
  const displayName = tags["display-name"] || username;

  return {
    id: tags["id"] || `${Date.now()}-${Math.random()}`,
    username: displayName,
    login: username.toLowerCase(), // stable lowercase identity, e.g. for bot-account matching
    channel,
    text: text.trim(),
    color,
    timestamp: Date.now(),
    isHype: HYPE_KEYWORDS.some((kw) => text.toLowerCase().includes(kw)),
    isRedeem: !!rewardId,
    rewardId,
    rewardTitle,
    isAction,

    // ── Raw IRC metadata, resolved later by backend/emotes.js ───────────────
    // Kept as the untouched tag strings so the parser stays synchronous and
    // free of network calls; enrichment happens once in handleChat.
    userId: tags["user-id"] || null,
    roomId: tags["room-id"] || null,
    badgeTag: tags["badges"] || "", // "broadcaster/1,subscriber/12"
    emoteTag: tags["emotes"] || "", // "25:0-4,12-16/1902:6-10"
    emoteOnly: tags["emote-only"] === "1",
  };
}

// USERNOTICE is how Twitch delivers chat-visible notices that aren't regular
// messages: subs, raids, announcements… and, since 2026, viewer milestones.
// The only one this app consumes is the watch streak
// (msg-id=viewermilestone, msg-param-category=watch-streak) — see
// dev.twitch.tv/docs/irc/tags. Everything else is dropped, exactly as before.
function parseUserNotice(raw) {
  const { tags, rest } = splitIrcTags(raw);
  // ":tmi.twitch.tv USERNOTICE #channel" with an optional ":message" tail.
  const noticeMatch = rest.match(/^:tmi\.twitch\.tv USERNOTICE #(\S+?)(?: :([\s\S]*))?$/);
  if (!noticeMatch) return null;

  return {
    id: tags["id"] || null,
    msgId: tags["msg-id"] || null,
    category: tags["msg-param-category"] || null,
    milestoneId: tags["msg-param-id"] || null,
    streak: tags["msg-param-value"] ? Number(tags["msg-param-value"]) : null,
    systemMessage: unescapeTagValue(tags["system-msg"] || ""),
    message: (noticeMatch[2] || "").trim(),
    username: tags["display-name"] || tags["login"] || "",
    login: tags["login"] || "",
    userId: tags["user-id"] || null,
    color: tags["color"] || null,
    timestamp: Number(tags["tmi-sent-ts"]) || Date.now(),
  };
}

class TwitchIRCClient {
  constructor({ channel, token, username, onMessage, onStatus, onNotice }) {
    this.channel = channel.toLowerCase().replace(/^#/, "");
    this.token = token;
    this.username = username || "justinfan" + Math.floor(Math.random() * 80000);
    this.onMessage = onMessage;
    this.onNotice = onNotice || (() => {});
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
        if (line.includes("USERNOTICE")) {
          const notice = parseUserNotice(line);
          if (notice) this.onNotice(notice);
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
    if (text.length > 499) text = text.slice(0, 494) + "(...)";
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

module.exports = { TwitchIRCClient, parseTwitchMessage, parseUserNotice };
