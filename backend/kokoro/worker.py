#!/usr/bin/env python3
"""Kokoro-82M worker — the Spanish-capable sidecar behind backend/kokoro.js.

Same line protocol as backend/kitten/worker.py:

    {"id": 1, "text": "hola", "voice": "ef_dora", "speed": 1.0}
    {"ready": true, "model": "...", "voices": [...], "sampleRate": 24000}
    {"id": 1, "ok": true, "wav": "<base64 WAV>"}
    {"id": 1, "ok": false, "error": "..."}

Kokoro-82M (Apache 2.0) is a StyleTTS 2 decoder with eight language families
and 54 voices. The Spanish voices (ef_dora, em_alex, em_santa) are the reason
this engine exists: KittenTTS's lightweight models are English-only.

The installed kokoro-onnx release is pinned to 0.4.7 because newer versions
require Python <3.14 and this host has 3.14. That release's create() sends
`speed` as int32, which the v1.1 ONNX exports reject, so this worker drives the
session directly: phonemize with espeak (the library's tokenizer), split into
model-sized batches, and feed int64 tokens + float32 style/speed. Verified
against kokoro-v1.0.onnx (fp32) and voices-v1.0.bin.
"""

import base64
import io
import json
import os
import sys
import traceback

_PROTOCOL = os.fdopen(os.dup(1), "w", encoding="utf-8", buffering=1)
os.dup2(2, 1)

DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.environ.get("KOKORO_MODEL", os.path.join(DIR, "models", "kokoro-v1.0.onnx"))
VOICES_PATH = os.environ.get("KOKORO_VOICES", os.path.join(DIR, "models", "voices-v1.0.bin"))
MAX_TEXT_CHARS = int(os.environ.get("KOKORO_MAX_TEXT_CHARS", "1000"))
# Spanish first: the AI co-host speaks Spanish by default in this app.
FALLBACK_VOICES = [
    "ef_dora", "em_alex", "em_santa",
    "af_heart", "af_bella", "af_nova",
    "am_michael", "am_fenrir", "bf_emma", "bm_george",
]
DEFAULT_VOICE = os.environ.get("KOKORO_DEFAULT_VOICE", "ef_dora")

# Kokoro's voice ids start with the language family: af_/am_ American English,
# bf_/bm_ British English, ef_/em_ Spanish, etc. Map them to espeak languages.
LANGUAGES = {
    "a": "en-us",
    "b": "en-gb",
    "e": "es",
    "f": "fr-fr",
    "h": "hi",
    "i": "it",
    "j": "ja",
    "p": "pt-br",
    "z": "zh",
}


def emit(payload):
    _PROTOCOL.write(json.dumps(payload) + "\n")
    _PROTOCOL.flush()


def clamp(value, low, high, fallback):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    if number != number or number in (float("inf"), float("-inf")):
        return fallback
    return min(high, max(low, number))


def wav_bytes(samples, sample_rate):
    import numpy as np
    import soundfile as sf

    pcm = np.clip(np.asarray(samples, dtype="float32"), -1.0, 1.0)
    buffer = io.BytesIO()
    sf.write(buffer, pcm, sample_rate, format="WAV", subtype="PCM_16")
    return buffer.getvalue()


def main():
    import numpy as np
    from kokoro_onnx import Kokoro
    from kokoro_onnx.config import MAX_PHONEME_LENGTH, SAMPLE_RATE
    from kokoro_onnx.trim import trim as trim_audio

    kokoro = Kokoro(MODEL_PATH, VOICES_PATH)
    available = list(kokoro.get_voices())
    voices = [voice for voice in FALLBACK_VOICES if voice in available] or available
    default_voice = DEFAULT_VOICE if DEFAULT_VOICE in voices else voices[0]
    emit({"ready": True, "model": "Kokoro-82M", "voices": voices, "sampleRate": SAMPLE_RATE})

    def synthesize(text, voice, speed):
        lang = LANGUAGES.get(voice[0], "en-us")
        phonemes = kokoro.tokenizer.phonemize(text, lang)
        if not phonemes.strip():
            raise ValueError("text produced no phonemes")
        parts = []
        for chunk in kokoro._split_phonemes(phonemes):
            tokens = np.array(kokoro.tokenizer.tokenize(chunk), dtype=np.int64)
            if len(tokens) > MAX_PHONEME_LENGTH:
                tokens = tokens[:MAX_PHONEME_LENGTH]
            style = kokoro.get_voice_style(voice)[len(tokens)]
            inputs = {
                "input_ids": np.array([[0, *tokens, 0]], dtype=np.int64),
                "style": np.array(style, dtype=np.float32),
                "speed": np.array([speed], dtype=np.float32),
            }
            audio, _ = trim_audio(kokoro.sess.run(None, inputs)[0])
            parts.append(audio)
        return np.concatenate(parts)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            text = str(request.get("text") or "").strip()[:MAX_TEXT_CHARS]
            if not text:
                raise ValueError("text is required")
            voice = request.get("voice") or default_voice
            if voice not in voices:
                raise ValueError(f"unknown voice: {voice}")
            speed = clamp(request.get("speed"), 0.5, 2.0, 1.0)
            audio = synthesize(text, voice, speed)
            emit({
                "id": request_id,
                "ok": True,
                "wav": base64.b64encode(wav_bytes(audio, SAMPLE_RATE)).decode("ascii"),
            })
        except Exception as err:  # never let one bad line kill the worker
            print(f"[kokoro/worker] {err}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            emit({"id": request_id, "ok": False, "error": str(err)})


if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        print(f"[kokoro/worker] fatal: {err}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
