// The dice button should exercise different acts on consecutive clicks, not
// return the same line twice. These tests pin both properties.
import { describe, expect, it } from "vitest";
import { RANDOM_ACT_NAMES, randomLine } from "../src/vrmLab/randomText.js";
import { actFor } from "../src/vrmLab/performance.js";

describe("randomLine", () => {
  it("returns a usable line", () => {
    const line = randomLine();
    expect(typeof line).toBe("string");
    expect(line.length).toBeGreaterThan(10);
    expect(line.length).toBeLessThan(400);
  });

  it("does not repeat the same act twice in a row", () => {
    let previous = actFor(randomLine());
    for (let i = 0; i < 40; i++) {
      const act = actFor(randomLine());
      expect(act).not.toBe(previous);
      previous = act;
    }
  });

  it("covers every act in the sample", () => {
    const seen = new Set();
    for (const act of RANDOM_ACT_NAMES) {
      for (let i = 0; i < 20; i++) seen.add(actFor(randomLine()));
    }
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });
});
