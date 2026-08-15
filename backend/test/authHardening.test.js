// Covers the trust root: what SESSION_SECRET is allowed to be, that each
// purpose gets its own key off it, and that the pieces derived from it
// (overlay tokens, token encryption) behave when rotated or corrupted.
import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";

const auth = require("../auth");
const adminAuth = require("../adminAuth");
const { db } = require("../db");

describe("resolveSessionSecret", () => {
  const { resolveSessionSecret, DEV_FALLBACK_SECRET } = auth;
  const realSecret = "x".repeat(48);

  it("refuses to boot without a secret outside development", () => {
    expect(() => resolveSessionSecret({ secret: undefined, env: "production" })).toThrow(
      /SESSION_SECRET is not set/
    );
  });

  it("names the environment and how to generate a secret, so the error is actionable", () => {
    let message = "";
    try {
      resolveSessionSecret({ secret: "", env: "staging" });
    } catch (err) {
      message = err.message;
    }
    expect(message).toContain("APP_ENV=staging");
    expect(message).toContain("randomBytes");
    // The operator needs to know this is not a free action before doing it.
    expect(message).toMatch(/log in again|invalidates existing sessions/);
  });

  it("rejects the repo's own placeholder in production", () => {
    expect(() => resolveSessionSecret({ secret: DEV_FALLBACK_SECRET, env: "production" })).toThrow(
      /placeholder/
    );
  });

  it("rejects a secret too short to be worth having", () => {
    expect(() => resolveSessionSecret({ secret: "short", env: "production" })).toThrow(/characters/);
  });

  it("accepts a real secret in production, with nothing to warn about", () => {
    expect(resolveSessionSecret({ secret: realSecret, env: "production" })).toEqual({
      secret: realSecret,
      warning: null,
    });
  });

  it("falls back in development and test, but says so", () => {
    for (const env of ["development", "test"]) {
      const { secret, warning } = resolveSessionSecret({ secret: undefined, env });
      expect(secret).toBe(DEV_FALLBACK_SECRET);
      expect(warning).toMatch(/SESSION_SECRET is not set/);
    }
  });

  it("ignores a whitespace-only secret rather than treating it as set", () => {
    expect(() => resolveSessionSecret({ secret: "   ", env: "production" })).toThrow(
      /SESSION_SECRET is not set/
    );
  });
});

describe("per-purpose subkeys", () => {
  it("gives every purpose a different key", () => {
    const keys = ["session-jwt", "admin-jwt", "overlay-token"].map((p) => auth.deriveKey(p).toString("hex"));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("is deterministic, so restarting the process doesn't log everyone out", () => {
    expect(auth.deriveKey("session-jwt")).toEqual(auth.deriveKey("session-jwt"));
  });

  it("does not use the raw secret as a signing key any more", () => {
    expect(auth.deriveKey("session-jwt").toString()).not.toBe(auth.DEV_FALLBACK_SECRET);
  });

  it("makes a user session token invalid as an admin token", () => {
    const userToken = jwt.sign({ twitchId: "123" }, auth.deriveKey("session-jwt"), { expiresIn: "1h" });
    // Even claiming to be admin, it is signed with the wrong key now.
    expect(() => jwt.verify(userToken, adminAuth.ADMIN_JWT_KEY, { subject: "admin" })).toThrow();
  });

  it("makes an admin token invalid as a user session token", () => {
    const adminToken = jwt.sign({}, adminAuth.ADMIN_JWT_KEY, { subject: "admin", expiresIn: "1h" });
    expect(() => jwt.verify(adminToken, auth.deriveKey("session-jwt"))).toThrow();
  });
});

describe("admin password comparison", () => {
  const { passwordMatches } = adminAuth;

  it("accepts the right password", () => {
    expect(passwordMatches("correct horse battery staple", "correct horse battery staple")).toBe(true);
  });

  it("rejects a wrong password of the same length", () => {
    expect(passwordMatches("aaaaaaaa", "bbbbbbbb")).toBe(false);
  });

  it("rejects a wrong password of a different length without throwing", () => {
    // timingSafeEqual throws on length mismatch; hashing first is what stops
    // a short guess from crashing the login route instead of failing it.
    expect(() => passwordMatches("a", "a much longer password")).not.toThrow();
    expect(passwordMatches("a", "a much longer password")).toBe(false);
  });

  it("rejects a missing password instead of throwing", () => {
    expect(passwordMatches(undefined, "expected")).toBe(false);
    expect(passwordMatches(null, "expected")).toBe(false);
  });
});

describe("token encryption at rest", () => {
  it("round-trips a Twitch token", () => {
    const plain = "oauth:abcdef123456";
    expect(auth.decryptToken(auth.encryptToken(plain))).toBe(plain);
  });

  it("returns null for a corrupt value rather than throwing", () => {
    // A live deployment that changes SESSION_SECRET hits exactly this: every
    // stored token becomes undecryptable. It has to degrade to "log in again",
    // not crash the process on the first request that touches a token.
    expect(() => auth.decryptToken("not-a-real-ciphertext")).not.toThrow();
    expect(auth.decryptToken("not-a-real-ciphertext")).toBeNull();
    expect(auth.decryptToken(null)).toBeNull();
  });
});

describe("overlay token rotation", () => {
  const twitchId = "overlay-rotation-test";

  function seedUser() {
    db.prepare(`DELETE FROM users WHERE twitchId = ?`).run(twitchId);
    const users = auth.readUsers();
    users.push({ twitchId, login: "rotator", approved: true, overlayTokenVersion: 1 });
    auth.writeUsers(users);
  }

  it("resolves a freshly issued token back to its account", () => {
    seedUser();
    const token = auth.getOverlayToken(twitchId);
    expect(auth.findUserByOverlayToken(token)?.twitchId).toBe(twitchId);
  });

  it("invalidates the previous token when rotated", () => {
    seedUser();
    const before = auth.getOverlayToken(twitchId);
    const after = auth.rotateOverlayToken(twitchId);

    expect(after).not.toBe(before);
    // The whole point: a leaked URL stops working.
    expect(auth.findUserByOverlayToken(before)).toBeNull();
    expect(auth.findUserByOverlayToken(after)?.twitchId).toBe(twitchId);
  });

  it("keeps issuing the rotated token on later reads", () => {
    seedUser();
    const rotated = auth.rotateOverlayToken(twitchId);
    expect(auth.getOverlayToken(twitchId)).toBe(rotated);
  });

  it("does not resolve a token for an unapproved account", () => {
    seedUser();
    const token = auth.getOverlayToken(twitchId);
    const users = auth.readUsers();
    users.find((u) => u.twitchId === twitchId).approved = false;
    auth.writeUsers(users);

    expect(auth.findUserByOverlayToken(token)).toBeNull();
  });

  it("returns null when rotating an account that doesn't exist", () => {
    expect(auth.rotateOverlayToken("no-such-account")).toBeNull();
  });

  it("survives a user row written without the column by older callers", () => {
    // writeUsers takes whole user objects from callers that predate the
    // column; a null would violate NOT NULL and break the whole save.
    db.prepare(`DELETE FROM users WHERE twitchId = ?`).run(twitchId);
    const users = auth.readUsers();
    users.push({ twitchId, login: "legacy", approved: true }); // no overlayTokenVersion
    expect(() => auth.writeUsers(users)).not.toThrow();
    expect(auth.findUserByOverlayToken(auth.getOverlayToken(twitchId))?.twitchId).toBe(twitchId);
  });
});

describe("random-looking outputs are actually keyed", () => {
  it("derives overlay tokens from the subkey, not the bare secret", () => {
    const bare = crypto
      .createHmac("sha256", auth.DEV_FALLBACK_SECRET)
      .update(`overlay:someone`)
      .digest("hex")
      .slice(0, 32);
    expect(auth.getOverlayToken("someone", 1)).not.toBe(bare);
  });
});
