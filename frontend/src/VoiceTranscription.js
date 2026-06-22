const FATAL_ERRORS = new Set(["not-allowed", "service-not-allowed"]);

class VoiceTranscriptionController {
  constructor() {
    this.running = false;
    this.modelStatus = "ready"; // always ready — Web Speech API needs no model download
    this.error = null;
    this.speaking = false;
    this.lastText = "";
    this.onTranscript = null;
    this.onStateChange = null;
    this._lang = "es-ES";
    this._recognition = null;
  }

  get supported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  setLang(lang) {
    this._lang = lang || "es-ES";
    if (this._recognition) this._recognition.lang = this._lang;
  }

  setDevice() {
    // Web Speech API doesn't support device selection — no-op
  }

  start() {
    if (!this.supported) {
      this._setError("SpeechRecognition not supported — use Chrome");
      return;
    }
    if (this.running) return;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this._recognition = new SR();
    this._recognition.lang = this._lang;
    this._recognition.continuous = true;
    this._recognition.interimResults = true;
    this._recognition.maxAlternatives = 1;

    this._recognition.onstart = () => {
      this.error = null;
      this.running = true;
      this._notifyState();
    };

    this._recognition.onspeechstart = () => {
      this.speaking = true;
      this._notifyState();
    };

    this._recognition.onspeechend = () => {
      this.speaking = false;
      this._notifyState();
    };

    this._recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          const text = transcript.trim();
          if (text) {
            this.lastText = text;
            this.speaking = false;
            this._notifyState();
            if (this.onTranscript) this.onTranscript(text);
          }
        } else {
          interim += transcript;
        }
      }
      // Show interim text live while speaking
      if (interim) {
        this.lastText = interim;
        this._notifyState();
      }
    };

    this._recognition.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      this._setError(`Error: ${event.error}`);
      if (FATAL_ERRORS.has(event.error)) {
        this.running = false;
        this._notifyState();
      }
    };

    this._recognition.onend = () => {
      this.speaking = false;
      // Auto-restart unless deliberately stopped or fatal error
      if (this.running && !FATAL_ERRORS.has(this.error?.replace("Error: ", ""))) {
        try { this._recognition.start(); } catch {}
      } else {
        this.running = false;
        this._notifyState();
      }
    };

    try {
      this._recognition.start();
    } catch (err) {
      this._setError(`Start failed: ${err.message}`);
    }
  }

  stop() {
    this.running = false;
    this.speaking = false;
    this.lastText = "";
    this.error = null;
    if (this._recognition) {
      try { this._recognition.abort(); } catch {}
      this._recognition = null;
    }
    this._notifyState();
  }

  _setError(msg) {
    console.warn("[voice]", msg);
    this.error = msg;
    this.running = false;
    this._notifyState();
  }

  _notifyState() {
    if (this.onStateChange) this.onStateChange();
  }
}

export const voice = new VoiceTranscriptionController();
