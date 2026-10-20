import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
const { server } = require("../app");
const sessions = require("../sessions");
const { readUsers, writeUsers, getOverlayToken, signSession } = require("../auth");
const user = { twitchId: "chat-recovery-test", login: "chatrecovery", approved: true };
const sockets = [];
let port;
beforeAll(async () => {
  writeUsers([...readUsers().filter((u) => u.twitchId !== user.twitchId), user]);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});
afterEach(async () => {
  await Promise.all(sockets.splice(0).map((ws) => new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    ws.once("close", resolve); ws.close();
  })));
  sessions.twitchSessions.delete(user.twitchId);
  vi.restoreAllMocks();
});
afterAll(async () => {
  writeUsers(readUsers().filter((u) => u.twitchId !== user.twitchId));
  await new Promise((resolve) => server.close(resolve));
});
function connect(overlay = false) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/chat${overlay ? `?token=${getOverlayToken(user.twitchId)}` : ""}`, {
    headers: overlay ? {} : { Cookie: `session=${signSession(user)}` },
  });
  sockets.push(ws);
  return ws;
}
function status(ws) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no chat status")), 2000);
    ws.on("message", (raw) => {
      const data = JSON.parse(raw.toString());
      if (data.type === "status") { clearTimeout(timer); resolve(data.status.type); }
    });
    ws.once("error", reject);
  });
}
function readySession() {
  sessions.twitchSessions.set(user.twitchId, {
    twitchClient: { ready: true }, botClient: { ready: true }, botUsername: "testbot", usingSiteBot: false,
  });
}
describe("browser session recovery", () => {
  it("resumes Twitch after a server restart and reports the current status", async () => {
    const restore = vi.spyOn(sessions, "connectTwitchForUser").mockImplementation(async () => readySession());
    expect(await status(connect())).toBe("connected");
    expect(restore).toHaveBeenCalledOnce();
    expect(restore.mock.calls[0][0].login).toBe(user.login);
  });
  it("reuses the live Twitch session when only the browser connection dropped", async () => {
    readySession();
    const restore = vi.spyOn(sessions, "connectTwitchForUser");
    expect(await status(connect())).toBe("connected");
    expect(restore).not.toHaveBeenCalled();
  });
  it("coalesces recovery when two tabs reconnect at once", async () => {
    let finish;
    const restore = vi.spyOn(sessions, "connectTwitchForUser").mockImplementation(() => new Promise((resolve) => {
      finish = () => { readySession(); resolve(); };
    }));
    const first = connect(); const firstStatus = status(first);
    const second = connect(); const secondStatus = status(second);
    await Promise.all([first, second].map((ws) => new Promise((resolve) => ws.once("open", resolve))));
    finish();
    expect(await firstStatus).toBe("connected");
    expect(await secondStatus).toBe("connected");
    expect(restore).toHaveBeenCalledOnce();
  });
  it("does not start Twitch from an OBS overlay alone", async () => {
    const restore = vi.spyOn(sessions, "connectTwitchForUser");
    const ws = connect(true);
    await new Promise((resolve) => ws.once("open", resolve));
    expect(restore).not.toHaveBeenCalled();
  });
  it("stops retries if Twitch requires a new login", async () => {
    vi.spyOn(sessions, "connectTwitchForUser").mockRejectedValue(new Error("TWITCH_TOKEN_REFRESH_FAILED"));
    const ws = connect();
    const code = await new Promise((resolve) => ws.once("close", resolve));
    expect(code).toBe(4401);
  });
});
