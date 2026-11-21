// The timeline sampler is what makes the 5 VRM presets look like speech:
// it must pick the segment under the audio clock, honour the per-segment
// amplitude (consonants are quieter shapes), report bilabial closures, and
// return silence inside punctuation gaps.
import { describe, expect, it } from "vitest";
import {
  VISEME_NAMES,
  emptyWeights,
  sampleTimeline,
  smoothWeights,
} from "../src/vrmLab/visemeTimeline.js";

const timeline = [
  { v: "aa", t: 0, d: 0.1, amp: 1 },
  { v: "ih", t: 0.1, d: 0.1, amp: 0.4 },
  { v: "close", t: 0.2, d: 0.05, amp: 1 },
  // 0.25 - 0.45 is a punctuation gap
  { v: "oh", t: 0.45, d: 0.1, amp: 1 },
];

describe("sampleTimeline", () => {
  it("returns the segment under the playhead", () => {
    expect(sampleTimeline(timeline, 0.05).aa).toBe(1);
    expect(sampleTimeline(timeline, 0.15).ih).toBe(0.4);
    expect(sampleTimeline(timeline, 0.47).oh).toBe(1);
  });

  it("reports bilabial closures separately from the vowel presets", () => {
    const w = sampleTimeline(timeline, 0.22);
    expect(w.close).toBe(1);
    expect(w.aa).toBe(0);
  });

  it("returns silence inside gaps and past the end", () => {
    for (const t of [0.3, 0.44, 0.9]) {
      const w = sampleTimeline(timeline, t);
      for (const name of VISEME_NAMES) expect(w[name]).toBe(0);
      expect(w.close).toBe(0);
    }
  });

  it("handles an empty timeline", () => {
    expect(sampleTimeline([], 0)).toEqual(emptyWeights());
    expect(sampleTimeline(null, 1)).toEqual(emptyWeights());
  });
});

describe("smoothWeights", () => {
  it("approaches the target without overshooting", () => {
    const current = emptyWeights();
    const target = { ...emptyWeights(), aa: 1 };
    for (let i = 0; i < 40; i++) smoothWeights(current, target, 1 / 60, 0.035);
    expect(current.aa).toBeGreaterThan(0.9);
    expect(current.aa).toBeLessThanOrEqual(1);
  });

  it("follows a dropping target back to silence", () => {
    const current = { ...emptyWeights(), aa: 1 };
    for (let i = 0; i < 40; i++) smoothWeights(current, emptyWeights(), 1 / 60, 0.035);
    expect(current.aa).toBeLessThan(0.05);
  });
});
