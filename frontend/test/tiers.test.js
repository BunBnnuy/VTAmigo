// Seed suite for the frontend test harness. tiers.js is pure logic with no
// DOM or network, so it exercises the runner without depending on anything
// the purge batches are about to delete.
import { describe, expect, it } from "vitest";
import { TIERS, clampToTier, tierLimits } from "../src/tiers.js";

describe("tierLimits", () => {
  it("returns the matching tier's limits", () => {
    expect(tierLimits("basic")).toBe(TIERS.basic);
  });

  it("falls back to pro for an unknown tier", () => {
    expect(tierLimits("nonexistent")).toBe(TIERS.pro);
    expect(tierLimits(undefined)).toBe(TIERS.pro);
  });
});

describe("clampToTier", () => {
  it("leaves values that the tier already allows untouched", () => {
    expect(clampToTier("advanced", { batchWindow: 60, maxMessages: 20 })).toEqual({
      batchWindow: 60,
      maxMessages: 20,
    });
  });

  it("snaps a downgraded user's out-of-range settings to the closest option", () => {
    // advanced allows a 20s window; basic does not, so it must land on 300.
    expect(clampToTier("basic", { batchWindow: 20, maxMessages: 30 })).toEqual({
      batchWindow: 300,
      maxMessages: 20,
    });
  });

  it("collapses free tier to its single fixed option", () => {
    expect(clampToTier("free", { batchWindow: 30, maxMessages: 10 })).toEqual({
      batchWindow: 600,
      maxMessages: 30,
    });
  });

  it("passes pro through unchanged, since it is free-form", () => {
    expect(clampToTier("pro", { batchWindow: 7, maxMessages: 3 })).toEqual({
      batchWindow: 7,
      maxMessages: 3,
    });
  });
});
