// Playout rules for the live show script: eligibility windows, FIFO across
// decks, question gating and immutable "used" marking.
import { describe, expect, it, vi } from "vitest";
import {
  countUnplayed,
  markBeatUsed,
  nextCandidates,
  pickNextBeat,
  previewBeats,
} from "../src/showScript.js";

const NOW = 1_700_000_000_000;
const MIN = 60_000;

const beat = (id, over = {}) => ({
  id,
  kind: "topic",
  text: `Beat ${id}`,
  afterMin: 0,
  beforeMin: 0,
  ...over,
});

const deck = (id, createdAt, beats) => ({ id, createdAt, beats });

describe("show script eligibility", () => {
  it("excludes used, not-yet-eligible and expired beats", () => {
    const decks = [
      deck("d1", NOW - 10 * MIN, [
        beat("a"),
        beat("b", { usedAt: NOW - MIN }),
        beat("c", { afterMin: 20 }),
        beat("e", { beforeMin: 5 }),
      ]),
    ];
    expect(countUnplayed(decks, NOW)).toBe(1);
    expect(unplayedIds(decks)).toEqual(["a"]);
  });

  it("consumes decks oldest-first and caps the per-deck candidates", () => {
    const decks = [
      deck("new", NOW - MIN, [beat("n1"), beat("n2")]),
      deck("old", NOW - 20 * MIN, [beat("o1"), beat("o2"), beat("o3"), beat("o4")]),
    ];
    const candidates = nextCandidates(decks, NOW, { perDeck: 2 });
    expect(candidates.map((b) => b.id)).toEqual(["o1", "o2"]);
    expect(candidates.every((b) => b.deckId === "old")).toBe(true);
  });

  it("moves to the next deck when the oldest has no eligible beats left", () => {
    const decks = [
      deck("old", NOW - 20 * MIN, [beat("o1", { usedAt: NOW })]),
      deck("new", NOW - MIN, [beat("n1")]),
    ];
    expect(nextCandidates(decks, NOW).map((b) => b.id)).toEqual(["n1"]);
  });
});

describe("pickNextBeat", () => {
  it("never asks a question into an empty room", () => {
    const decks = [deck("d1", NOW - MIN, [beat("q", { kind: "question" })])];
    expect(pickNextBeat(decks, NOW, { viewerCount: 0 })).toBeNull();
    expect(pickNextBeat(decks, NOW, { viewerCount: 2 })).not.toBeNull();
  });

  it("respects the question cooldown but falls back to non-questions", () => {
    const decks = [
      deck("d1", NOW - MIN, [
        beat("q", { kind: "question" }),
        beat("t", { kind: "topic" }),
      ]),
    ];
    const picked = pickNextBeat(decks, NOW, {
      viewerCount: 10,
      lastQuestionAt: NOW - MIN,
    });
    expect(picked.kind).toBe("topic");
  });

  it("picks only among the first three candidates", () => {
    const decks = [
      deck("d1", NOW - MIN, [
        beat("a"),
        beat("b"),
        beat("c"),
        beat("d"),
      ]),
    ];
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    try {
      const picked = pickNextBeat(decks, NOW, { viewerCount: 0 });
      expect(["a", "b", "c"]).toContain(picked.id);
      expect(picked.id).not.toBe("d");
    } finally {
      random.mockRestore();
    }
  });
});

describe("markBeatUsed", () => {
  it("marks only the target beat and leaves the source array untouched", () => {
    const decks = [deck("d1", NOW - MIN, [beat("a"), beat("b")])];
    const next = markBeatUsed(decks, "d1", "a", NOW);
    expect(next[0].beats[0].usedAt).toBe(NOW);
    expect(next[0].beats[1].usedAt).toBeUndefined();
    expect(decks[0].beats[0].usedAt).toBeUndefined();
  });
});

describe("previewBeats", () => {
  it("flattens eligible beats with their deck id and respects the limit", () => {
    const decks = [
      deck("d1", NOW - MIN, [beat("a"), beat("b")]),
      deck("d2", NOW - MIN, [beat("c")]),
    ];
    const preview = previewBeats(decks, NOW, 2);
    expect(preview).toHaveLength(2);
    expect(preview.every((b) => b.deckId)).toBe(true);
  });
});

function unplayedIds(decks) {
  return previewBeats(decks, NOW, 100).map((b) => b.id);
}
