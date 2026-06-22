// Web Speech API TTS queue — responses play sequentially, never overlapping.

const AVG_CHARS_PER_SEC = 14;

function lipsyncStart(text, durationMs) {
  fetch("/lipsync/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, durationMs }),
  }).catch(() => {});
}

function lipsyncStop() {
  fetch("/lipsync/stop", { method: "POST" }).catch(() => {});
}

class TTSController {
  constructor() {
    this.synth = window.speechSynthesis;
    this.queue = [];
    this.playing = false;
    this.muted = false;
    this.volume = 1;
    this.rate = 1;
    this.voiceURI = null;
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
  }

  setRate(r) {
    this.rate = r;
  }

  setMuted(m) {
    this.muted = m;
    if (m) {
      lipsyncStop();
      this.synth.cancel();
    }
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
    this.synth.cancel();
    // onend will fire → _next()
  }

  clearQueue() {
    lipsyncStop();
    this.queue = [];
    this.synth.cancel();
    this.playing = false;
    this._notify();
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
    };

    utt.onend = () => {
      lipsyncStop();
      if (onDone) onDone();
      this._next();
    };

    utt.onerror = () => {
      lipsyncStop();
      if (onDone) onDone();
      this._next();
    };

    this.synth.speak(utt);
  }

  _notify() {
    if (this.onStateChange) this.onStateChange();
  }
}

export const tts = new TTSController();
