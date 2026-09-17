import { afterEach, describe, expect, it, vi } from "vitest";
import { ReactiveAvatarController } from "../src/ReactiveAvatarController.js";

function fakeAudio() {
  const state = { level: 128 };
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] };
  const analyser = {
    fftSize: 8,
    smoothingTimeConstant: 0,
    getByteTimeDomainData(buffer) { buffer.fill(state.level); },
    disconnect: vi.fn(),
  };
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const context = {
    state: "running",
    createMediaStreamSource: vi.fn(() => source),
    createAnalyser: vi.fn(() => analyser),
    close: vi.fn(() => Promise.resolve()),
  };
  class AudioContextConstructor {
    constructor() { return context; }
  }
  return { state, track, stream, analyser, source, context, AudioContextConstructor };
}

afterEach(() => vi.useRealTimers());

describe("ReactiveAvatarController", () => {
  it("detects microphone activity and returns to silence after the grace period", async () => {
    vi.useFakeTimers({ now: 0 });
    const audio = fakeAudio();
    const mediaDevices = { getUserMedia: vi.fn(async () => audio.stream) };
    const controller = new ReactiveAvatarController({
      mediaDevices,
      AudioContextConstructor: audio.AudioContextConstructor,
      silenceDelayMs: 300,
      pollIntervalMs: 50,
    });

    const states = [];
    controller.onStateChange = () => states.push({ enabled: controller.enabled, speaking: controller.speaking });
    await controller.start();
    expect(mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(controller.enabled).toBe(true);

    audio.state.level = 180;
    controller._sample();
    expect(controller.speaking).toBe(true);

    audio.state.level = 128;
    vi.setSystemTime(100);
    controller._sample();
    vi.setSystemTime(399);
    controller._sample();
    expect(controller.speaking).toBe(true);
    vi.setSystemTime(400);
    controller._sample();
    expect(controller.speaking).toBe(false);
    expect(states.filter((state) => state.speaking)).toHaveLength(1);

    controller.stop();
    expect(audio.track.stop).toHaveBeenCalledTimes(1);
    expect(audio.context.close).toHaveBeenCalledTimes(1);
    expect(controller.enabled).toBe(false);
  });

  it("reports an unsupported browser without requesting a microphone", async () => {
    const mediaDevices = { getUserMedia: vi.fn() };
    const controller = new ReactiveAvatarController({ mediaDevices, AudioContextConstructor: null });

    const started = await controller.start();

    expect(started).toBe(false);
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(controller.error).toContain("micrófono");
  });

  it("stops the track and reports permission errors", async () => {
    const mediaDevices = {
      getUserMedia: vi.fn(async () => { throw Object.assign(new Error("blocked"), { name: "NotAllowedError" }); }),
    };
    const controller = new ReactiveAvatarController({
      mediaDevices,
      AudioContextConstructor: class AudioContext {},
    });

    expect(await controller.start()).toBe(false);
    expect(controller.enabled).toBe(false);
    expect(controller.error).toBe("Permiso de micrófono rechazado");
  });
});
