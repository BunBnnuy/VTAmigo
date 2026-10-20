import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { monitorChatSocket } = require("../chatSocket");

let ws;
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  ws = new EventEmitter();
  Object.assign(ws, { readyState: 1, ping: vi.fn(), send: vi.fn(), terminate: vi.fn() });
  monitorChatSocket(ws, { login: "tester", client: "app" });
});
afterEach(() => { ws.emit("close", 1000, Buffer.from("done")); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("chat heartbeat and diagnostics", () => {
  it("keeps a quiet healthy browser alive using ping/pong and JSON heartbeats", () => {
    for (let i = 0; i < 12; i++) {
      vi.advanceTimersByTime(25000);
      ws.emit("pong");
    }
    expect(ws.ping).toHaveBeenCalledTimes(12);
    expect(ws.send).toHaveBeenCalledWith('{"type":"heartbeat"}');
    expect(ws.terminate).not.toHaveBeenCalled();
  });
  it("terminates a dead peer and logs the heartbeat timeout", () => {
    vi.advanceTimersByTime(100000);
    expect(ws.terminate).toHaveBeenCalledOnce();
    expect(console.warn).toHaveBeenCalledWith("[ws] heartbeat_timeout", expect.stringContaining('"login":"tester"'));
  });
  it("records the client, connection ID and close reason and removes the timer", () => {
    ws.emit("close", 1006, Buffer.from("network lost"));
    expect(console.log).toHaveBeenCalledWith("[ws] disconnected", expect.stringContaining('"code":1006,"reason":"network lost"'));
    expect(vi.getTimerCount()).toBe(0);
  });
  it("handles socket errors without crashing the backend", () => {
    expect(() => ws.emit("error", new Error("ECONNRESET"))).not.toThrow();
    expect(console.warn).toHaveBeenCalledWith("[ws] error", expect.stringContaining("ECONNRESET"));
  });
});
