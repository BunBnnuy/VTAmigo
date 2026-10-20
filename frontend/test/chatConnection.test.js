import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatConnection } from "../src/ChatConnection.js";

class FakeSocket {
  static sockets = [];
  constructor() { FakeSocket.sockets.push(this); }
  close = vi.fn();
  open() { this.onopen?.(); }
  message(data = '{"type":"heartbeat"}') { this.onmessage?.({ data }); }
  drop(code = 1006) { this.onclose?.({ code, reason: "", wasClean: false }); }
}

let connection;
let onOpen, onClose, onMessage, onDiagnostic;
beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.sockets = [];
  onOpen = vi.fn(); onClose = vi.fn(); onMessage = vi.fn(); onDiagnostic = vi.fn();
  connection = new ChatConnection({
    url: () => "wss://example.test/chat", WebSocketImpl: FakeSocket,
    onOpen, onClose, onMessage, onDiagnostic,
  });
  connection.start();
});
afterEach(() => { connection.stop(); vi.useRealTimers(); });

describe("chat recovery", () => {
  it("reconnects after a network drop and receives messages on the replacement", () => {
    FakeSocket.sockets[0].open();
    FakeSocket.sockets[0].drop();
    expect(onClose).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000);
    FakeSocket.sockets[1].open();
    FakeSocket.sockets[1].message('{"type":"chat"}');
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onMessage).toHaveBeenCalledWith({ data: '{"type":"chat"}' });
    expect(onDiagnostic).toHaveBeenCalledWith({ code: 1006, reason: "", wasClean: false });
  });

  it("backs off repeated failed connections", () => {
    FakeSocket.sockets[0].drop();
    vi.advanceTimersByTime(1000);
    FakeSocket.sockets[1].drop();
    vi.advanceTimersByTime(1999);
    expect(FakeSocket.sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.sockets).toHaveLength(3);
  });

  it("keeps an idle chat alive when server heartbeats arrive", () => {
    FakeSocket.sockets[0].open();
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(25000);
      FakeSocket.sockets[0].message();
    }
    expect(FakeSocket.sockets).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("replaces a silent half-open connection without waiting for its close event", () => {
    FakeSocket.sockets[0].open();
    vi.advanceTimersByTime(101000);
    expect(FakeSocket.sockets[0].close).toHaveBeenCalledOnce();
    expect(FakeSocket.sockets).toHaveLength(2);
    expect(onDiagnostic).toHaveBeenCalledWith({ reason: "heartbeat_timeout" });
  });

  it("manual stop cancels retries and ignores stale events and browser wakeups", () => {
    const oldClose = FakeSocket.sockets[0].onclose;
    FakeSocket.sockets[0].drop();
    connection.stop();
    oldClose({ code: 1006 });
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(300000);
    expect(FakeSocket.sockets).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([4401, 4403])("does not retry rejected authentication (%s)", (code) => {
    FakeSocket.sockets[0].drop(code);
    vi.advanceTimersByTime(300000);
    window.dispatchEvent(new Event("online"));
    expect(FakeSocket.sockets).toHaveLength(1);
  });

  it("recovers promptly when the browser comes online without creating duplicate sockets", () => {
    FakeSocket.sockets[0].drop();
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("online"));
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.sockets).toHaveLength(2);
  });
});
