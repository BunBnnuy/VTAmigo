import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Native (Twitch) emotes used to be resolved only from the IRC `emotes` tag.
// Messages we synthesize ourselves — the overlay's test-message preview, the
// bot's /say, /say-as-streamer — carry no tag, so Kappa and channel emotes
// rendered as plain text there. This pins the name-based fallback, which
// fetches Twitch's own emote sets with an app token (no user session needed).
const HELIX_EMOTES = {
  data: [
    { name: "killbnQlazo", id: "emotesv2_abc", emote_type: "subscriptions" },
    { name: "Kappa", id: "25", emote_type: "globals" },
  ],
};

function stubTwitch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      if (String(url).includes("/oauth2/token")) {
        return { ok: true, json: async () => ({ access_token: "app-token", expires_in: 3600 }) };
      }
      return { ok: true, json: async () => HELIX_EMOTES };
    })
  );
}

describe("native emote name resolution", () => {
  beforeEach(() => {
    process.env.TWITCH_CLIENT_ID = "test-client";
    process.env.TWITCH_CLIENT_SECRET = "test-secret";
    stubTwitch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TWITCH_CLIENT_ID;
    delete process.env.TWITCH_CLIENT_SECRET;
  });

  it("resolves a channel emote by name with no IRC emotes tag", async () => {
    const emotes = require("../emotes");
    emotes.prime("1018929501", "1018929501");

    await vi.waitFor(
      () => {
        expect(emotes.resolveEmotes("killbnQlazo", "", "1018929501").length).toBe(1);
      },
      { timeout: 2000 }
    );

    const [em] = emotes.resolveEmotes("hello killbnQlazo there", "", "1018929501");
    expect(em.name).toBe("killbnQlazo");
    expect(em.type).toBe("twitch");
    expect(em.urls[1]).toContain("static-cdn.jtvnw.net");
    expect(em.start).toBe(6);
    expect(em.end).toBe(16);
  });

  it("still treats the IRC tag as authoritative when present", () => {
    const emotes = require("../emotes");
    // No prime/network needed: the tag path is fully synchronous.
    const out = emotes.resolveEmotes("Kappa", "25:0-4", null);
    expect(out).toEqual([
      expect.objectContaining({ name: "Kappa", type: "twitch", start: 0, end: 4 }),
    ]);
  });
});
