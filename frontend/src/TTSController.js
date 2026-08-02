// TTS queue — responses play sequentially, never overlapping.
// Providers: "windows" (Web Speech API, default), "elevenlabs" (backend proxy → Audio element),
// or "piper" (local offline Piper CLI via backend proxy → Audio element).

import { apiFetch, apiUrl } from "./api.js";

const AVG_CHARS_PER_SEC = 14;

function lipsyncStart(text, durationMs) {
  apiFetch("/lipsync/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, durationMs }),
  }).catch(() => {});
}

function lipsyncStop() {
  apiFetch("/lipsync/stop", { method: "POST" }).catch(() => {});
}

class TTSController {
  constructor() {
    this.synth = window.speechSynthesis;
    this.queue = [];
    this.playing = false; // true while the queue has/is processing an item (including mid-generation)
    this.speaking = false; // true only once audio is actually audible — same instant as lipsyncStart/lipsyncStop
    this.muted = false;
    this.volume = 1;
    this.rate = 1;
    this.voiceURI = null;
    this.provider = "windows";
    this.elevenLabsKey = "";
    this.elevenLabsVoiceId = "";
    this.piperVoice = "";
    this.currentAudio = null; // active remote-provider Audio element
    this.onStateChange = null; // () => void — called when playing/queue changes
  }

  getVoices() {
    return this.synth.getVoices();
  }

  setVoice(uri) {
    this.voiceURI = uri;
  }

  setVolume(v) {
    this.volume = v;
    if (this.currentAudio) this.currentAudio.volume = v;
  }

  setRate(r) {
    this.rate = r;
  }

  setProvider(p) {
    this.provider = p || "windows";
  }

  setElevenLabs({ apiKey, voiceId }) {
    if (apiKey != null) this.elevenLabsKey = apiKey;
    if (voiceId != null) this.elevenLabsVoiceId = voiceId;
  }

  setPiper({ voice }) {
    if (voice != null) this.piperVoice = voice;
  }

  setMuted(m) {
    this.muted = m;
    if (m) {
      lipsyncStop();
      this._setSpeaking(false);
      this._stopCurrentAudio();
      this.synth.cancel();
    }
  }

  _setSpeaking(v) {
    if (this.speaking === v) return;
    this.speaking = v;
    this._notify();
  }

  // onDone: optional callback fired when this specific item finishes playing
  enqueue(text, onDone) {
    if (!text) return;
    this.queue.push({ text, onDone: onDone || null });
    this._notify();
    if (!this.playing) this._next();
  }

  skip() {
    lipsyncStop();
    this._setSpeaking(false);
    if (this.currentAudio) {
      this._stopCurrentAudio(true); // fires its onDone → _next()
    } else {
      this.synth.cancel();
      // onend will fire → _next()
    }
  }

  clearQueue() {
    lipsyncStop();
    this._setSpeaking(false);
    this.queue = [];
    this._stopCurrentAudio();
    this.synth.cancel();
    this.playing = false;
    this._notify();
  }

  _stopCurrentAudio(fireDone = false) {
    const audio = this.currentAudio;
    if (!audio) return;
    this.currentAudio = null;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    if (audio.src) URL.revokeObjectURL(audio.src);
    if (fireDone && audio._onFinished) audio._onFinished();
  }

  _next() {
    if (this.muted || this.queue.length === 0) {
      this.playing = false;
      this._notify();
      return;
    }
    const { text, onDone } = this.queue.shift();
    this.playing = true;
    this._notify();

    if (this.provider === "elevenlabs" && this.elevenLabsKey && this.elevenLabsVoiceId) {
      this._speakRemote(text, onDone, "ElevenLabs", "/tts/elevenlabs", {
        text, apiKey: this.elevenLabsKey, voiceId: this.elevenLabsVoiceId,
      });
    } else if (this.provider === "piper") {
      this._speakRemote(text, onDone, "Piper", "/tts/piper", {
        text, voice: this.piperVoice || undefined,
      });
    } else {
      this._speakWindows(text, onDone);
    }
  }

  _speakWindows(text, onDone) {
    const utt = new SpeechSynthesisUtterance(text);
    utt.volume = this.volume;
    utt.rate = this.rate;

    if (this.voiceURI) {
      const voice = this.synth.getVoices().find((v) => v.voiceURI === this.voiceURI);
      if (voice) utt.voice = voice;
    }

    utt.onstart = () => {
      const durationMs = Math.round((text.length / (AVG_CHARS_PER_SEC * this.rate)) * 1000);
      lipsyncStart(text, durationMs);
      this._setSpeaking(true);
    };

    utt.onend = () => {
      lipsyncStop();
      this._setSpeaking(false);
      if (onDone) onDone();
      this._next();
    };

    utt.onerror = () => {
      lipsyncStop();
      this._setSpeaking(false);
      if (onDone) onDone();
      this._next();
    };

    this.synth.speak(utt);
  }

  // Fetches audio from a backend TTS proxy route and plays it; falls back to Windows TTS on failure.
  async _speakRemote(text, onDone, label, url, body) {
    let blob;
    try {
      const res = await fetch(apiUrl(url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${label} proxy returned ${res.status}`);
      blob = await res.blob();
    } catch (err) {
      console.warn(`[tts] ${label} failed, falling back to Windows TTS:`, err.message);
      this._speakWindows(text, onDone);
      return;
    }

    // Muted/skipped while the clip was generating
    if (this.muted) {
      if (onDone) onDone();
      this._next();
      return;
    }

    const audio = new Audio(URL.createObjectURL(blob));
    audio.volume = this.volume;
    audio.playbackRate = this.rate;
    this.currentAudio = audio;

    const finish = () => {
      if (this.currentAudio === audio) {
        this.currentAudio = null;
        if (audio.src) URL.revokeObjectURL(audio.src);
      }
      lipsyncStop();
      this._setSpeaking(false);
      if (onDone) onDone();
      this._next();
    };
    audio._onFinished = () => {
      lipsyncStop();
      this._setSpeaking(false);
      if (onDone) onDone();
      this._next();
    };
    audio.onended = finish;
    audio.onerror = finish;

    try {
      await audio.play();
      // Real clip length drives the mouth-sync phoneme timeline
      const durationMs = Math.round(((audio.duration || text.length / AVG_CHARS_PER_SEC) / this.rate) * 1000);
      lipsyncStart(text, durationMs);
      this._setSpeaking(true);
    } catch {
      finish();
    }
  }

  _notify() {
    if (this.onStateChange) this.onStateChange();
  }
}

export const tts = new TTSController();
