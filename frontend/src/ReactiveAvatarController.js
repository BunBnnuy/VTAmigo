// Detects the streamer's microphone activity without transcribing audio.
// The analyser is connected only to the microphone source, never to the
// audio destination, so this cannot create microphone feedback in the app.

const DEFAULT_THRESHOLD = 0.035;
const DEFAULT_SILENCE_DELAY_MS = 300;
const DEFAULT_POLL_INTERVAL_MS = 50;

function getAudioContextConstructor() {
  return window.AudioContext || window.webkitAudioContext || null;
}

function measureRms(analyser, buffer) {
  analyser.getByteTimeDomainData(buffer);
  let sum = 0;
  for (const sample of buffer) {
    const normalized = (sample - 128) / 128;
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / buffer.length);
}

export class ReactiveAvatarController {
  constructor({
    mediaDevices = navigator.mediaDevices,
    AudioContextConstructor = getAudioContextConstructor(),
    threshold = DEFAULT_THRESHOLD,
    silenceDelayMs = DEFAULT_SILENCE_DELAY_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    setIntervalFn = window.setInterval.bind(window),
    clearIntervalFn = window.clearInterval.bind(window),
  } = {}) {
    this.mediaDevices = mediaDevices;
    this.AudioContextConstructor = AudioContextConstructor;
    this.threshold = threshold;
    this.silenceDelayMs = silenceDelayMs;
    this.pollIntervalMs = pollIntervalMs;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;

    this.enabled = false;
    this.speaking = false;
    this.error = null;
    this.onStateChange = null;

    this._stream = null;
    this._context = null;
    this._source = null;
    this._analyser = null;
    this._buffer = null;
    this._pollTimer = null;
    this._silenceSince = null;
  }

  get supported() {
    return !!(this.mediaDevices?.getUserMedia && this.AudioContextConstructor);
  }

  async start() {
    if (this.enabled) return true;
    if (!this.supported) {
      this._setError("El navegador no permite detectar actividad del micrófono");
      return false;
    }

    this.error = null;
    try {
      const stream = await this.mediaDevices.getUserMedia({ audio: true });
      // Store each resource as soon as it exists so a later Web Audio setup
      // failure still stops the microphone tracks and closes the context.
      this._stream = stream;
      const context = new this.AudioContextConstructor();
      this._context = context;
      if (context.state === "suspended" && context.resume) await context.resume();

      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);

      this._source = source;
      this._analyser = analyser;
      this._buffer = new Uint8Array(analyser.fftSize);
      this.enabled = true;
      this._silenceSince = null;
      this._pollTimer = this.setIntervalFn(() => this._sample(), this.pollIntervalMs);
      this._notify();
      return true;
    } catch (error) {
      this._cleanupAudio();
      this._setError(error?.name === "NotAllowedError"
        ? "Permiso de micrófono rechazado"
        : `No se pudo iniciar el micrófono: ${error?.message || "error desconocido"}`);
      return false;
    }
  }

  stop() {
    const changed = this.enabled || this.speaking || !!this.error;
    this.enabled = false;
    this.error = null;
    this._silenceSince = null;
    this._cleanupAudio();
    this._setSpeaking(false);
    if (changed) this._notify();
  }

  _sample() {
    if (!this.enabled || !this._analyser || !this._buffer) return;
    const active = measureRms(this._analyser, this._buffer) >= this.threshold;
    if (active) {
      this._silenceSince = null;
      this._setSpeaking(true);
      return;
    }
    if (this.speaking) {
      if (this._silenceSince == null) this._silenceSince = Date.now();
      if (Date.now() - this._silenceSince >= this.silenceDelayMs) this._setSpeaking(false);
    }
  }

  _cleanupAudio() {
    if (this._pollTimer != null) this.clearIntervalFn(this._pollTimer);
    this._pollTimer = null;
    try { this._source?.disconnect(); } catch {}
    try { this._analyser?.disconnect?.(); } catch {}
    for (const track of this._stream?.getTracks?.() || []) track.stop();
    if (this._context && this._context.state !== "closed") this._context.close?.();
    this._stream = null;
    this._context = null;
    this._source = null;
    this._analyser = null;
    this._buffer = null;
  }

  _setSpeaking(value) {
    if (this.speaking === value) return;
    this.speaking = value;
    this._notify();
  }

  _setError(message) {
    this.enabled = false;
    this.error = message;
    this._notify();
  }

  _notify() {
    if (this.onStateChange) this.onStateChange();
  }
}

export const reactiveAvatar = new ReactiveAvatarController();
