// !sr is handled by the video queue, so it must never reach the AI buffer —
// the co-host answering "!sr <song>" out loud is the bug this guards.
import { describe, expect, it } from "vitest";
import { isSongRequest } from "../src/chatCommands.js";

describe("isSongRequest", () => {
  it("matches a normal song request", () => {
    expect(isSongRequest("!sr never gonna give you up")).toBe(true);
    expect(isSongRequest("!sr https://youtu.be/dQw4w9WgXcQ")).toBe(true);
  });

  it("matches a bare !sr, which is noise for the AI even though the queue ignores it", () => {
    expect(isSongRequest("!sr")).toBe(true);
  });

  it("ignores case, the way the backend's own matcher does", () => {
    expect(isSongRequest("!SR una cancion")).toBe(true);
    expect(isSongRequest("!Sr una cancion")).toBe(true);
  });

  it("tolerates leading whitespace", () => {
    expect(isSongRequest("   !sr una cancion")).toBe(true);
  });

  it("leaves a different command that merely starts the same way alone", () => {
    expect(isSongRequest("!srsomething")).toBe(false);
    expect(isSongRequest("!srt")).toBe(false);
  });

  it("only matches at the start, so talking about the command still reaches the AI", () => {
    expect(isSongRequest("usa !sr para pedir canciones")).toBe(false);
    expect(isSongRequest("hola")).toBe(false);
  });

  it("does not treat other commands as song requests", () => {
    expect(isSongRequest("!bot hola")).toBe(false);
    expect(isSongRequest("!skip")).toBe(false);
  });

  it("survives a missing or non-string text", () => {
    expect(isSongRequest(undefined)).toBe(false);
    expect(isSongRequest(null)).toBe(false);
    expect(isSongRequest("")).toBe(false);
    expect(isSongRequest(42)).toBe(false);
  });
});
