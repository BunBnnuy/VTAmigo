// Independent TTS queue for explicit chat commands such as "!tts hello".
// This controller has its own settings and queue. It does not use the AI TTS
// controller or update the avatar speaking state.
//
// Like the AI TTS controller it can play locally ("app"), hand lines to the
// separate Chat TTS OBS overlay ("overlay"), or both — see _sendToOverlay.

import { apiFetch } from "./api.js";

export const DEFAULT_CHAT_TTS_COMMAND = "tts";
export const DEFAULT_CHAT_TTS_TEMPLATE = "{user} dijo: {mensaje}";

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

export function formatChatTTSMessage(template, user, message) {
  const source = String(template || DEFAULT_CHAT_TTS_TEMPLATE);
  const values = {
    user: String(user || "Twitch"),
    message: String(message || ""),
    // The default is Spanish, so keep this alias alongside the requested
    // English placeholder for convenient localized templates.
    mensaje: String(message || ""),
  };
  return source.replace(/\{(user|message|mensaje)\}/gi, (_, key) => values[key.toLowerCase()] ?? "");
}

class ChatTTSController {
  constructor(synth = typeof window !== "undefined" ? window.speechSynthesis : null) {
    this.synth = synth;
    this.queue = [];
    this.current = false;
    this.enabled = false;
    this.voiceURI = "";
    // Effective gain for this queue (the Mixer panel's chat-TTS channel times
    // master). Applied per utterance, so a live slider move affects the next
    // one; the browser echoes it for anything already mid-sentence.
    this.volume = 1;
    // "app" (local browser, default), "overlay" (Chat TTS OBS overlay source)
    // or "both".
    this.output = "app";
  }

  getVoices() {
    return this.synth?.getVoices?.() || [];
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (!this.enabled) {
      this.queue = [];
      if (this.output !== "app") this._clearOverlay();
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

  setVolume(v) {
    const n = Number(v);
    this.volume = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
  }

  setOutput(mode) {
    this.output = mode === "overlay" || mode === "both" ? mode : "app";
  }

  enqueue(text) {
    if (!this.enabled || !text || this.volume <= 0) return;
    const sendOverlay = this.output !== "app";
    const playLocal = this.output !== "overlay" && !!this.synth;
    if (sendOverlay) this._sendToOverlay(text);
    if (!playLocal) return;
    this.queue.push(text);
    this._next();
  }

  stop() {
    this.queue = [];
    this.current = false;
    if (this.output !== "app") this._clearOverlay();
  }

  // Hands one line to the account's Chat TTS overlay (backend /tts/chat-speak →
  // {type:"chat_tts_speak"} broadcast → overlay/chat-tts.html). The overlay
  // runs its own sequential queue. Chat TTS has no speed setting; the overlay
  // applies the chat-TTS/master mixer gains itself, so volume stays 1 here.
  _sendToOverlay(text) {
    apiFetch("/tts/chat-speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        voiceURI: this.voiceURI || null,
        rate: 1,
        volume: 1,
        forcePiper: false,
      }),
    }).catch(() => {});
  }

  _clearOverlay() {
    apiFetch("/tts/chat-skip", { method: "POST" }).catch(() => {});
  }

  _next() {
    if (!this.enabled || this.current || this.queue.length === 0 || !this.synth) return;
    const text = this.queue.shift();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.volume = this.volume;
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
