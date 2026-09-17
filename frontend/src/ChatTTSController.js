// Independent TTS queue for explicit chat commands such as "!tts hello".
// This controller has its own settings and queue. It does not use the AI TTS
// controller or update the avatar speaking state.

export const DEFAULT_CHAT_TTS_COMMAND = "tts";

export function extractChatTTSMessage(text, command) {
  if (typeof text !== "string") return null;
  const normalizedCommand = String(command || DEFAULT_CHAT_TTS_COMMAND)
    .trim()
    .replace(/^!+/, "")
    .toLowerCase();
  if (!normalizedCommand) return null;

  const prefix = `!${normalizedCommand}`;
  const lowerText = text.toLowerCase();
  const nextCharacter = text[prefix.length];
  if (lowerText !== prefix && (!lowerText.startsWith(prefix) || !/\s/.test(nextCharacter || ""))) return null;

  const speech = text.slice(prefix.length).trim();
  return speech || null;
}

class ChatTTSController {
  constructor(synth = typeof window !== "undefined" ? window.speechSynthesis : null) {
    this.synth = synth;
    this.queue = [];
    this.current = false;
    this.enabled = false;
    this.voiceURI = "";
  }

  getVoices() {
    return this.synth?.getVoices?.() || [];
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (!this.enabled) {
      this.queue = [];
      // speechSynthesis is shared by the browser. Do not call cancel here:
      // it would also interrupt an AI response currently being spoken.
      this.current = false;
    } else {
      this._next();
    }
  }

  setVoice(uri) {
    this.voiceURI = uri || "";
  }

  enqueue(text) {
    if (!this.enabled || !text || !this.synth) return;
    this.queue.push(text);
    this._next();
  }

  stop() {
    this.queue = [];
    this.current = false;
  }

  _next() {
    if (!this.enabled || this.current || this.queue.length === 0 || !this.synth) return;
    const text = this.queue.shift();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = this.getVoices().find((item) => item.voiceURI === this.voiceURI);
    if (voice) utterance.voice = voice;
    this.current = true;
    const finish = () => {
      if (!this.current) return;
      this.current = false;
      this._next();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    this.synth.speak(utterance);
  }
}

export const chatTts = new ChatTTSController();
export { ChatTTSController };
