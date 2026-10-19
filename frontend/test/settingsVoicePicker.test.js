// The unified voice picker must switch both engine and voice from one choice.
// These tests render the real Settings panel with mocked voice endpoints and
// drive the <select> the way a user would.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import Settings from "../src/Settings.jsx";
import { encodeVoiceValue } from "../src/ttsVoices.js";

const BASE_SETTINGS = {
  language: "en",
  ttsProvider: "windows",
  voiceURI: "",
  piperVoice: "",
  kittenVoice: "",
  kokoroVoice: "",
  ttsRate: 1,
  ttsVolume: 1,
  ttsOutput: "app",
  micMode: "off",
};

function renderSettings() {
  return render(createElement(Settings, {
    settings: BASE_SETTINGS,
    tier: "pro",
    onSave: vi.fn(),
    onClose: vi.fn(),
  }));
}

beforeEach(() => {
  globalThis.fetch = vi.fn((url) => {
    const path = String(url);
    if (path.includes("/tts/piper/voices")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ installed: true, voices: [{ id: "es_dalia", name: "Dalia" }] }),
      });
    }
    if (path.includes("/tts/kitten/voices")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ installed: true, voices: [{ id: "Luna", name: "Luna" }] }),
      });
    }
    if (path.includes("/tts/kokoro/voices")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ installed: true, voices: [{ id: "ef_dora", name: "Dora · ES" }] }),
      });
    }
    // Overlay URLs, bot account and memory status are irrelevant here.
    return new Promise(() => {});
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("unified TTS voice picker", () => {
  it("lists voices from every engine as Provider/Voice", async () => {
    renderSettings();
    expect(await screen.findByRole("option", { name: "Windows/Default" })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Piper/Dalia" })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Kitten/Luna" })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Kokoro/Dora · ES" })).toBeInTheDocument();
  });

  it("switches to Kokoro when a Kokoro voice is selected", async () => {
    renderSettings();
    const option = await screen.findByRole("option", { name: "Kokoro/Dora · ES" });
    const select = option.closest("select");

    fireEvent.change(select, { target: { value: option.value } });

    await waitFor(() => expect(select.value).toBe(encodeVoiceValue("kokoro", "ef_dora")));
    // The selected engine's explanatory hint replaces the previous one.
    expect(screen.getByText(/official Spanish voices/i)).toBeInTheDocument();
  });

  it("switches back to Piper with its own voice", async () => {
    renderSettings();
    const option = await screen.findByRole("option", { name: "Piper/Dalia" });
    const select = option.closest("select");

    fireEvent.change(select, { target: { value: option.value } });

    await waitFor(() => expect(select.value).toBe(encodeVoiceValue("piper", "es_dalia")));
    expect(screen.getByText(/Runs fully offline on CPU/i)).toBeInTheDocument();
  });
});
