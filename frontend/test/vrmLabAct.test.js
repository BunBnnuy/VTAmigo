// Text → act classification and the gesture envelopes that drive it. The
// rules are intentionally simple; these tests pin the behaviour that matters
// (greetings beat question words, neutral is the fallback) rather than every
// keyword.
import { describe, expect, it } from "vitest";
import { actFor, classifyAct, sampleAct, sampleIdle } from "../src/vrmLab/performance.js";

describe("classifyAct", () => {
  it("greets before it asks", () => {
    expect(classifyAct("¡Hola! ¿Cómo estás?").act).toBe("greeting");
    expect(classifyAct("Buenas noches").act).toBe("greeting");
  });

  it("detects questions, thanks and moods", () => {
    expect(classifyAct("¿Qué hora es?").act).toBe("question");
    expect(classifyAct("Gracias por todo").act).toBe("thanks");
    expect(classifyAct("Lo siento mucho").act).toBe("sad");
    expect(classifyAct("Estoy enfadado").act).toBe("angry");
    expect(classifyAct("Quizá mañana").act).toBe("thinking");
    expect(classifyAct("¡No me lo puedo creer!").act).toBe("surprised");
  });

  it("falls back to neutral", () => {
    expect(classifyAct("Nos vemos en un rato").act).toBe("neutral");
    expect(classifyAct("").act).toBe("neutral");
  });

  it("exposes the same result through actFor", () => {
    expect(actFor("Hola")).toBe("greeting");
  });
});

describe("sampleAct", () => {
  it("raises and folds the arm for a greeting, then lowers it", () => {
    const mid = sampleAct("greeting", 1);
    expect(mid.arm).toBeTruthy();
    expect(mid.arm.angle).toBeGreaterThan(1);
    expect(mid.arm.bend).toBeGreaterThan(1);
    expect(mid.expression).toBe("happy");

    const after = sampleAct("greeting", 4);
    expect(after.arm.angle).toBeCloseTo(0, 5);
    expect(after.weight).toBeCloseTo(0, 5);
  });

  it("nods down for sadness", () => {
    expect(sampleAct("sad", 1.5).head.pitch).toBeGreaterThan(0.1);
  });

  it("does nothing for neutral", () => {
    const act = sampleAct("neutral", 1);
    expect(act.arm).toBeNull();
    expect(act.expression).toBeNull();
    expect(act.head.pitch).toBe(0);
  });
});

describe("sampleIdle", () => {
  it("keeps moving and stays subtle", () => {
    const a = sampleIdle(0);
    const b = sampleIdle(1.7);
    expect(a.head.roll).not.toBeCloseTo(b.head.roll, 5);
    for (const value of Object.values(a.head)) expect(Math.abs(value)).toBeLessThan(0.1);
    for (const value of Object.values(a.spine)) expect(Math.abs(value)).toBeLessThan(0.05);
  });
});
