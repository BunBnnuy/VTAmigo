// The TTS controller is the only thing that tells the backend the co-host
// started or stopped talking (POST /avatar/speaking/start|stop), and that
// signal is what drives the avatar overlay for every user. It also has to
// keep responses from talking over each other. Neither had any coverage, so
// this suite pins both down.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// TTSController exports a singleton created at import time, so each test
// resets the module registry to get a fresh, unshared controller.
async function freshTts() {
  vi.resetModules();
  const mod = await import("../src/TTSController.js");
  return mod.tts;
}

// Minimal Web Speech API stand-in: speak() just records the utterance so the
// test can fire its lifecycle callbacks by hand, the way a real voice would.
function fakeSynth() {
  const spoken = [];
  return {
    spoken,
    speak(utt) { spoken.push(utt); },
    cancel: vi.fn(),
    getVoices: () => [],
  };
}

// jsdom ships no speech synthesis at all, so the utterance type the
// controller constructs has to be provided too.
class FakeUtterance {
  constructor(text) {
    this.text = text;
    this.volume = 1;
    this.rate = 1;
    this.voice = null;
  }
}

class FakeAudio {
  static instances = [];
  constructor(src) {
    this.src = src;
    this.volume = 1;
    this.playbackRate = 1;
    this.duration = 2;
    this.paused = false;
    FakeAudio.instances.push(this);
  }
  play() { return Promise.resolve(); }
  pause() { this.paused = true; }
}

// Every POST the controller made, as a list of paths (the origin varies with
// the api.js backend-url logic and isn't what these tests are about).
function postedPaths() {
  return globalThis.fetch.mock.calls.map(([url]) => String(url).replace(/^https?:\/\/[^/]+/, ""));
}

const realSynth = window.speechSynthesis;
const realAudio = globalThis.Audio;
const realUtterance = globalThis.SpeechSynthesisUtterance;

let synth;

beforeEach(() => {
  synth = fakeSynth();
  window.speechSynthesis = synth;
  globalThis.fetch = vi.fn(async () => ({ ok: true, blob: async () => new Blob(["audio"]) }));
  FakeAudio.instances = [];
  globalThis.Audio = FakeAudio;
  globalThis.SpeechSynthesisUtterance = FakeUtterance;
  URL.createObjectURL = vi.fn(() => "blob:fake-clip");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  window.speechSynthesis = realSynth;
  globalThis.Audio = realAudio;
  globalThis.SpeechSynthesisUtterance = realUtterance;
});

describe("queueing", () => {
  it("plays one response at a time and starts the next when the first ends", async () => {
    const tts = await freshTts();

    tts.enqueue("first");
    tts.enqueue("second");

    // Second response must wait — two voices at once is the bug this guards.
    expect(synth.spoken).toHaveLength(1);
    expect(synth.spoken[0].text).toBe("first");
    expect(tts.queue).toHaveLength(1);

    synth.spoken[0].onstart();
    synth.spoken[0].onend();

    expect(synth.spoken).toHaveLength(2);
    expect(synth.spoken[1].text).toBe("second");
    expect(tts.queue).toHaveLength(0);
  });

  it("fires each item's onDone callback when that item finishes", async () => {
    const tts = await freshTts();
    const done = vi.fn();

    tts.enqueue("hello", done);
    synth.spoken[0].onstart();
    expect(done).not.toHaveBeenCalled();

    synth.spoken[0].onend();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("ignores empty text instead of queueing a silent turn", async () => {
    const tts = await freshTts();
    tts.enqueue("");
    expect(synth.spoken).toHaveLength(0);
    expect(tts.playing).toBe(false);
  });
});

describe("avatar speaking signal", () => {
  it("only reports speaking once audio is actually audible", async () => {
    const tts = await freshTts();

    tts.enqueue("hello chat");
    // Queued and being prepared, but nothing is audible yet.
    expect(tts.playing).toBe(true);
    expect(tts.speaking).toBe(false);
    expect(postedPaths()).not.toContain("/avatar/speaking/start");

    synth.spoken[0].onstart();
    expect(tts.speaking).toBe(true);
    expect(postedPaths()).toContain("/avatar/speaking/start");

    synth.spoken[0].onend();
    expect(tts.speaking).toBe(false);
    expect(postedPaths()).toContain("/avatar/speaking/stop");
  });

  it("stays silent for the whole of a remote provider's generation", async () => {
    const tts = await freshTts();
    tts.setProvider("piper");

    let releaseClip;
    globalThis.fetch = vi.fn(() => new Promise((resolve) => {
      releaseClip = () => resolve({ ok: true, blob: async () => new Blob(["audio"]) });
    }));

    tts.enqueue("generated line");
    await Promise.resolve();

    // Generation can take seconds; the avatar must not open its mouth yet.
    expect(tts.playing).toBe(true);
    expect(tts.speaking).toBe(false);
    expect(postedPaths()).not.toContain("/avatar/speaking/start");

    releaseClip();
    await vi.waitFor(() => expect(tts.speaking).toBe(true));

    const startCall = globalThis.fetch.mock.calls.find(([url]) => String(url).endsWith("/avatar/speaking/start"));
    expect(startCall).toBeTruthy();
    // Clip length, not an estimate from the text, drives the mouth timeline.
    expect(JSON.parse(startCall[1].body)).toMatchObject({ text: "generated line", durationMs: 2000 });
  });

  it("tells the overlay to stop when a response is skipped", async () => {
    const tts = await freshTts();
    tts.enqueue("a long ramble");
    synth.spoken[0].onstart();
    globalThis.fetch.mockClear();

    tts.skip();

    expect(postedPaths()).toContain("/avatar/speaking/stop");
    expect(tts.speaking).toBe(false);
    expect(synth.cancel).toHaveBeenCalled();
  });
});

describe("mute and volume", () => {
  it("muting silences the current response and tells the overlay to stop", async () => {
    const tts = await freshTts();
    tts.enqueue("mid sentence");
    synth.spoken[0].onstart();
    globalThis.fetch.mockClear();

    tts.setMuted(true);

    expect(tts.speaking).toBe(false);
    expect(synth.cancel).toHaveBeenCalled();
    expect(postedPaths()).toContain("/avatar/speaking/stop");
  });

  it("does not speak anything queued while muted", async () => {
    const tts = await freshTts();
    tts.setMuted(true);

    tts.enqueue("nobody hears this");

    expect(synth.spoken).toHaveLength(0);
    expect(tts.playing).toBe(false);
  });

  it("applies the configured volume and rate to what it speaks", async () => {
    const tts = await freshTts();
    tts.setVolume(0.4);
    tts.setRate(1.5);

    tts.enqueue("quiet and quick");

    expect(synth.spoken[0].volume).toBe(0.4);
    expect(synth.spoken[0].rate).toBe(1.5);
  });

  it("changes the volume of a remote clip that is already playing", async () => {
    const tts = await freshTts();
    tts.setProvider("piper");

    tts.enqueue("playing now");
    await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(1));

    tts.setVolume(0.25);

    expect(FakeAudio.instances[0].volume).toBe(0.25);
  });
});
