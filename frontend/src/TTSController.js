// TTS queue — responses play sequentially, never overlapping.
// Providers: "windows" (Web Speech API, default), "piper" (local offline
// Piper CLI), "kitten" (English-only KittenTTS) or "kokoro" (Kokoro-82M,
// official Spanish voices) — the local engines are proxied by the backend and
// played through an Audio element.

import { apiFetch, apiUrl } from "./api.js";

const AVG_CHARS_PER_SEC = 14;

// These two are the only driver of the avatar overlay: the backend answers
// them by broadcasting {type:"tts_state", playing} over the WebSocket, which
// is what swaps the overlay between its speaking and silent image. Call them
// at the exact moments audio becomes/stops being audible, never around
// generation, or the avatar's mouth desyncs from the voice.
function speakingStart(text, durationMs) {
  apiFetch("/avatar/speaking/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, durationMs }),
  }).catch(() => {});
}

function speakingStop() {
  apiFetch("/avatar/speaking/stop", { method: "POST" }).catch(() => {});
}

class TTSController {
  constructor() {
    this.synth = window.speechSynthesis;
    this.queue = [];
    this.playing = false; // true while the queue has/is processing an item (including mid-generation)
    this.speaking = false; // true only once audio is actually audible — same instant as speakingStart/speakingStop
    this.muted = false;
    this.volume = 1; // effective local gain (provider volume × mixer channels)
    this.overlayVolume = 1; // raw provider volume; the voice overlay applies the mixer itself
    this.rate = 1;
    this.voiceURI = null;
    this.provider = "windows";
    // "app" (local browser, default), "overlay" (OBS voice-overlay browser
    // source only) or "both" — see _next().
    this.output = "app";
    this.piperVoice = "";
    this.kittenVoice = "";
    this.kokoroVoice = "";
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

  // The overlay gets the un-mixed provider volume and applies the Mixer panel's
  // bot-voice/master gains itself, so the two paths never double-apply them.
  setOverlayVolume(v) {
    this.overlayVolume = v;
  }

  setOutput(mode) {
    this.output = mode === "overlay" || mode === "both" ? mode : "app";
  }

  setRate(r) {
    this.rate = r;
  }

  setProvider(p) {
    this.provider = p || "windows";
  }

  setPiper({ voice }) {
    if (voice != null) this.piperVoice = voice;
  }

  setKitten({ voice }) {
    if (voice != null) this.kittenVoice = voice;
  }

  setKokoro({ voice }) {
    if (voice != null) this.kokoroVoice = voice;
  }

  setMuted(m) {
    this.muted = m;
    if (m) {
      if (this.output !== "app") this._clearOverlay();
      speakingStop();
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
    if (this.output !== "app") this._clearOverlay();
    speakingStop();
    this._setSpeaking(false);
    if (this.currentAudio) {
      this._stopCurrentAudio(true); // fires its onDone → _next()
    } else {
      this.synth.cancel();
      // onend will fire → _next()
    }
  }

  clearQueue() {
    if (this.output !== "app") this._clearOverlay();
    speakingStop();
    this._setSpeaking(false);
    this.queue = [];
    this._stopCurrentAudio();
    this.synth.cancel();
    this.playing = false;
    this._notify();
  }

  // Hands one line to the account's voice overlay (backend /tts/speak →
  // {type:"tts_speak"} broadcast → overlay/voice.html). The overlay owns its
  // own sequential queue and reports the audible window back as tts_state.
  _sendToOverlay(text) {
    apiFetch("/tts/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        voiceURI: this.voiceURI || null,
        piperVoice: this.piperVoice || null,
        kittenVoice: this.kittenVoice || null,
        kokoroVoice: this.kokoroVoice || null,
        ttsProvider: this.provider,
        rate: this.rate,
        volume: this.overlayVolume,
        forcePiper: this.provider === "piper",
      }),
    }).catch(() => {});
  }

  _clearOverlay() {
    apiFetch("/tts/skip", { method: "POST" }).catch(() => {});
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

    // The voice overlay owns playback when the output setting includes it: the
    // app either just hands the line off ("overlay") or also speaks it locally
    // ("both"). Overlay-only drains the local queue immediately — the overlay
    // runs its own sequential queue — and the tts_state WS event drives the
    // speaking UI (see App.jsx).
    if (this.output === "overlay") {
      this._sendToOverlay(text);
      if (onDone) onDone();
      this._next();
      return;
    }
    if (this.output === "both") this._sendToOverlay(text);

    if (this.provider === "piper") {
      this._speakRemote(text, onDone, "Piper", "/tts/piper", {
        text, voice: this.piperVoice || undefined,
      });
    } else if (this.provider === "kitten") {
      this._speakRemote(text, onDone, "KittenTTS", "/tts/kitten", {
        text, voice: this.kittenVoice || undefined,
      });
    } else if (this.provider === "kokoro") {
      this._speakRemote(text, onDone, "Kokoro", "/tts/kokoro", {
        text, voice: this.kokoroVoice || undefined,
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
      speakingStart(text, durationMs);
      this._setSpeaking(true);
    };

    utt.onend = () => {
      speakingStop();
      this._setSpeaking(false);
      if (onDone) onDone();
      this._next();
    };

    utt.onerror = () => {
      speakingStop();
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
      speakingStop();
      this._setSpeaking(false);
      if (onDone) onDone();
      this._next();
    };
    audio._onFinished = () => {
      speakingStop();
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
      speakingStart(text, durationMs);
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
