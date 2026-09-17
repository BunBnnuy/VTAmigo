import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

const sockets = [];

class FakeWebSocket extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    super();
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    sockets.push(this);
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close");
  }
}

function message(metadata, payload = {}) {
  return Buffer.from(JSON.stringify({ metadata, payload }));
}

describe("EventSub reconnect", () => {
  it("keeps inherited subscriptions and ignores the expected old-socket close", async () => {
    sockets.length = 0;
    const statuses = [];
    const { EventSubClient } = require("../eventsub");
    const client = new EventSubClient({
      channel: "example",
      clientId: "client-id",
      token: "access-token",
      onRedeem: () => {},
      onEvent: () => {},
      onStatus: (status) => statuses.push(status),
      WebSocketImpl: FakeWebSocket,
    });

    client.connect();
    const oldSocket = sockets[0];
    expect(oldSocket.url).toContain("keepalive_timeout_seconds=30");
    oldSocket.readyState = FakeWebSocket.OPEN;
    oldSocket.emit("open");
    oldSocket.emit("message", message(
      { message_type: "session_reconnect" },
      { session: { reconnect_url: "wss://eventsub.example/reconnect" } },
    ));

    expect(sockets).toHaveLength(2);
    const newSocket = sockets[1];
    newSocket.readyState = FakeWebSocket.OPEN;
    newSocket.emit("open");
    newSocket.emit("message", message(
      { message_type: "session_welcome" },
      { session: { id: "new-session", keepalive_timeout_seconds: 10 } },
    ));
    await new Promise((resolve) => setImmediate(resolve));

    expect(sockets).toHaveLength(2);
    expect(oldSocket.readyState).toBe(FakeWebSocket.CLOSED);
    expect(statuses.filter((status) => status.type === "eventsub_disconnected")).toHaveLength(0);
    expect(statuses.filter((status) => status.type === "eventsub_connected")).toHaveLength(1);

    client.disconnect();
  });
});
