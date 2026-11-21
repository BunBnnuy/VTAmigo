// Pure halves of the viseme pipeline: phoneme tokens → timeline, and WAV →
// speech bounds. Phonemization itself needs the piper_phonemize binary, which
// CI doesn't ship, so it is exercised by hand (and by the lab) instead.
import { describe, expect, it } from "vitest";

const { buildTimeline, wavSpeechBounds } = require("../visemes");

// 16-bit mono PCM WAV with a tone in [from, to) and silence elsewhere.
function makeWav({ sampleRate = 22050, seconds = 1, from = 0.2, to = 0.8 } = {}) {
  const frames = Math.floor(sampleRate * seconds);
  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate;
    const gain = t >= from && t < to ? 0.5 : 0;
    data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * t) * 32767 * gain), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

describe("buildTimeline", () => {
  it("fills exactly the measured speech span", () => {
    const segs = buildTimeline(["ˈ", "o", "l", "a", " ", "m", "i"], 0.1, 1.1);
    expect(segs.length).toBeGreaterThan(0);
    expect(segs[0].t).toBeCloseTo(0.1, 3);
    const last = segs[segs.length - 1];
    expect(last.t + last.d).toBeCloseTo(1.1, 3);
  });

  it("maps vowels to VRM presets and stressed vowels run longer", () => {
    const plain = buildTimeline(["a"], 0, 1)[0];
    expect(plain.v).toBe("aa");
    expect(buildTimeline(["e"], 0, 1)[0].v).toBe("ee");
    expect(buildTimeline(["i"], 0, 1)[0].v).toBe("ih");
    expect(buildTimeline(["o"], 0, 1)[0].v).toBe("oh");
    expect(buildTimeline(["u"], 0, 1)[0].v).toBe("ou");

    // The span is normalised, so stress shows up as a share of it: the
    // stressed vowel takes more time than the unstressed one.
    const segs = buildTimeline(["ˈ", "a", "a"], 0, 1);
    expect(segs[0].d).toBeGreaterThan(segs[1].d);
  });

  it("closes the mouth on bilabials instead of borrowing a vowel", () => {
    const segs = buildTimeline(["a", "m", "a"], 0, 1);
    const middle = segs.find((s) => s.v === "close");
    expect(middle).toBeTruthy();
    expect(middle.amp).toBe(1);
  });

  it("reserves time for punctuation between words", () => {
    const withComma = buildTimeline(["a", ",", "a"], 0, 1);
    const vowelSegs = withComma.filter((s) => s.v === "aa");
    expect(vowelSegs.length).toBe(2);
    const gap = vowelSegs[1].t - (vowelSegs[0].t + vowelSegs[0].d);
    expect(gap).toBeGreaterThan(0.05);
  });
});

describe("wavSpeechBounds", () => {
  it("finds the first and last audible window, not the file edges", () => {
    const bounds = wavSpeechBounds(makeWav({ seconds: 1, from: 0.2, to: 0.8 }));
    expect(bounds.duration).toBeCloseTo(1, 2);
    expect(bounds.start).toBeGreaterThan(0.15);
    expect(bounds.start).toBeLessThan(0.22);
    expect(bounds.end).toBeGreaterThan(0.78);
    expect(bounds.end).toBeLessThan(0.88);
  });

  it("falls back to the whole file when nothing crosses the noise floor", () => {
    const bounds = wavSpeechBounds(makeWav({ seconds: 0.5, from: 2, to: 3 }));
    expect(bounds.start).toBe(0);
    expect(bounds.end).toBeCloseTo(bounds.duration, 5);
  });

  it("rejects a non-RIFF buffer instead of returning garbage", () => {
    expect(() => wavSpeechBounds(Buffer.from("not a wav at all"))).toThrow("WAV_INVALID");
  });
});
