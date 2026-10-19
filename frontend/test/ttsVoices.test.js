// The unified TTS voice picker encodes both engine and voice in one value.
// These tests pin the encoding (browser voiceURIs can contain ":"), the
// settings patch it produces, and the "Provider/Voice" labels the panels show.
import { describe, expect, it } from "vitest";
import {
  buildVoiceOptions,
  encodeVoiceValue,
  parseVoiceValue,
  selectedVoiceValue,
  voiceSelectionPatch,
  withSelectedOption,
} from "../src/ttsVoices.js";

const t = (key) => ({ "ttsVoices.providerDefault": "Default" }[key] || key);

describe("voice value encoding", () => {
  it("round-trips a browser voiceURI that contains a colon", () => {
    const value = encodeVoiceValue("windows", "urn:moz-tts:voice:es");
    expect(parseVoiceValue(value)).toEqual({ provider: "windows", voice: "urn:moz-tts:voice:es" });
  });

  it("falls back to the Windows default for unknown values", () => {
    expect(parseVoiceValue("")).toEqual({ provider: "windows", voice: "" });
    expect(parseVoiceValue("nope:voice")).toEqual({ provider: "windows", voice: "" });
  });
});

describe("selectedVoiceValue", () => {
  it("reads the voice field that belongs to the active provider", () => {
    expect(selectedVoiceValue({ ttsProvider: "piper", piperVoice: "es_dalia" })).toBe(encodeVoiceValue("piper", "es_dalia"));
    expect(selectedVoiceValue({ ttsProvider: "kokoro", kokoroVoice: "ef_dora" })).toBe(encodeVoiceValue("kokoro", "ef_dora"));
    expect(selectedVoiceValue({ ttsProvider: "windows", voiceURI: "Google español" })).toBe(encodeVoiceValue("windows", "Google español"));
  });

  it("defaults to the Windows system voice", () => {
    expect(selectedVoiceValue({})).toBe(encodeVoiceValue("windows", ""));
  });
});

describe("voiceSelectionPatch", () => {
  it("switches provider and only that provider's voice", () => {
    expect(voiceSelectionPatch(encodeVoiceValue("piper", "es_dalia"))).toEqual({
      ttsProvider: "piper",
      piperVoice: "es_dalia",
    });
    expect(voiceSelectionPatch(encodeVoiceValue("kokoro", ""))).toEqual({
      ttsProvider: "kokoro",
      kokoroVoice: "",
    });
  });
});

describe("buildVoiceOptions", () => {
  const options = buildVoiceOptions({
    voices: [
      { voiceURI: "ms-raul", name: "Microsoft Raúl" },
      { voiceURI: "google-es", name: "Google español" },
    ],
    piperVoices: [{ id: "es_dalia", name: "Dalia" }],
    kittenVoices: [{ id: "Luna", name: "Luna" }],
    kokoroVoices: [{ id: "ef_dora", name: "Dora · ES" }],
    t,
  });

  it("labels everything as Provider/Voice in one flat list", () => {
    expect(options.map((option) => option.label)).toEqual([
      "Windows/Default",
      "Windows/Microsoft Raúl",
      "Browser/Google español",
      "Piper/Default",
      "Piper/Dalia",
      "Kitten/Default",
      "Kitten/Luna",
      "Kokoro/Default",
      "Kokoro/Dora · ES",
    ]);
  });

  it("keeps a saved voice selectable when the fetched list does not contain it", () => {
    const value = encodeVoiceValue("piper", "deleted-voice");
    const withCurrent = withSelectedOption(options, value, t);
    expect(withCurrent[0]).toEqual({ value, label: "Piper/deleted-voice" });
    // Existing list untouched when the value is already present.
    expect(withSelectedOption(options, options[1].value, t)).toBe(options);
  });
});
