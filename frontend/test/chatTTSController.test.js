import { describe, expect, it } from "vitest";
import { ChatTTSController, extractChatTTSMessage } from "../src/ChatTTSController.js";

describe("extractChatTTSMessage", () => {
  it("extracts the text after the default command", () => {
    expect(extractChatTTSMessage("!tts Hola comunidad", "")).toBe("Hola comunidad");
  });

  it("matches case-insensitively and accepts a custom command", () => {
    expect(extractChatTTSMessage("!SAY Buenos días", "say")).toBe("Buenos días");
  });

  it("does not match a command prefix inside another word", () => {
    expect(extractChatTTSMessage("!ttsmith Hola", "tts")).toBeNull();
    expect(extractChatTTSMessage("hola !tts mundo", "tts")).toBeNull();
    expect(extractChatTTSMessage("!tts", "tts")).toBeNull();
  });
});

describe("ChatTTSController", () => {
  it("keeps its own queue and applies the selected voice", () => {
    const spoken = [];
    const synth = {
      getVoices: () => [{ voiceURI: "voice-1", name: "Test", lang: "es-MX" }],
      speak: (utterance) => spoken.push(utterance),
    };
    const OriginalUtterance = globalThis.SpeechSynthesisUtterance;
    globalThis.SpeechSynthesisUtterance = function (text) { this.text = text; };
    try {
      const controller = new ChatTTSController(synth);
      controller.setVoice("voice-1");
      controller.setEnabled(true);
      controller.enqueue("uno");
      controller.enqueue("dos");

      expect(spoken).toHaveLength(1);
      expect(spoken[0].text).toBe("uno");
      expect(spoken[0].voice.voiceURI).toBe("voice-1");

      spoken[0].onend();
      expect(spoken).toHaveLength(2);
      expect(spoken[1].text).toBe("dos");
    } finally {
      globalThis.SpeechSynthesisUtterance = OriginalUtterance;
    }
  });
});
