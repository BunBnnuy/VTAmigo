#!/usr/bin/env python3
"""KittenTTS worker — a long-lived sidecar behind backend/kitten.js.

Loading an ONNX voice model costs a few seconds and ~450 MB of RAM, so the
backend keeps one worker alive and feeds it one request per line on stdin
instead of paying that cost for every sentence:

    {"id": 1, "text": "hola", "voice": "Luna", "speed": 1.0}

The worker answers on stdout with one JSON object per line:

    {"ready": true, "model": "...", "voices": [...], "sampleRate": 24000}
    {"id": 1, "ok": true, "wav": "<base64 WAV>"}
    {"id": 1, "ok": false, "error": "..."}

Only the lightweight ONNX models (kitten-tts-mini/micro/nano-0.8) are handled
here: they are the ones that fit next to the rest of the backend on a small
VPS. KittenTTS 2 needs ~2.3 GB RSS and tens of seconds per sentence on CPU,
which is why it is not wired up; KITTEN_MODEL stays overridable so a bigger
box can point at another ONNX repository.

The model prints its own progress ("Generating audio for text: ...") on
stdout, which would corrupt the protocol, so fd 1 is duplicated for the
protocol and the original stdout is redirected to stderr for the duration of
the process.
"""

import base64
import io
import json
import os
import sys
import traceback

# Keep a private handle on the real stdout for protocol frames, then point
# everything else (including library print()s) at stderr -> service journal.
_PROTOCOL = os.fdopen(os.dup(1), "w", encoding="utf-8", buffering=1)
os.dup2(2, 1)

MODEL_NAME = os.environ.get("KITTEN_MODEL", "KittenML/kitten-tts-mini-0.8")
MAX_TEXT_CHARS = int(os.environ.get("KITTEN_MAX_TEXT_CHARS", "1000"))
DEFAULT_VOICE = os.environ.get("KITTEN_DEFAULT_VOICE", "Luna")
# Experimental: the 0.8 ONNX models are trained on English, but the phoneme
# inventory is shared IPA. Pointing espeak at another language makes an
# English voice read Spanish (accented, unofficial). "en-us" keeps the stock
# behaviour; see apply_phoneme_language().
LANGUAGE = os.environ.get("KITTEN_LANGUAGE", "en-us")
SAMPLE_RATE = 24000
FALLBACK_VOICES = ["Bella", "Jasper", "Luna", "Bruno", "Rosie", "Hugo", "Kiki", "Leo"]


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
    """Encode float samples as a 16-bit PCM WAV, entirely in memory."""
    import numpy as np
    import soundfile as sf

    pcm = np.clip(np.asarray(samples, dtype="float32"), -1.0, 1.0)
    buffer = io.BytesIO()
    sf.write(buffer, pcm, sample_rate, format="WAV", subtype="PCM_16")
    return buffer.getvalue()


def apply_phoneme_language(model, language):
    """Swap the ONNX model's English G2P for another espeak language.

    Only the legacy ONNX family (KittenTTSOnnx -> KittenTTS_1_Onnx) exposes a
    `phonemizer`; KittenTTS 2 uses its own multilingual text pipeline, so it
    is left alone. Returns the language actually in use.
    """
    wanted = (language or "en-us").strip()
    if not wanted or wanted.lower() == "en-us":
        return "en-us"

    import phonemizer

    target = getattr(model, "model", None)
    if target is None or not hasattr(target, "phonemizer"):
        print(
            f"[kitten/worker] KITTEN_LANGUAGE={wanted} ignored: this model has no swappable phonemizer",
            file=sys.stderr,
        )
        return "en-us"

    target.phonemizer = phonemizer.backend.EspeakBackend(
        language=wanted, preserve_punctuation=True, with_stress=True
    )
    return wanted


def main():
    from kittenml import KittenTTS

    model = KittenTTS(MODEL_NAME)
    voices = list(getattr(model, "available_voices", FALLBACK_VOICES))
    language = apply_phoneme_language(model, LANGUAGE)
    emit({
        "ready": True,
        "model": MODEL_NAME,
        "voices": voices,
        "sampleRate": SAMPLE_RATE,
        "language": language,
    })

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
            voice = request.get("voice") or (DEFAULT_VOICE if DEFAULT_VOICE in voices else voices[0])
            if voice not in voices:
                raise ValueError(f"unknown voice: {voice}")
            speed = clamp(request.get("speed"), 0.5, 2.0, 1.0)
            audio = model.generate(text, voice=voice, speed=speed)
            emit({
                "id": request_id,
                "ok": True,
                "wav": base64.b64encode(wav_bytes(audio, SAMPLE_RATE)).decode("ascii"),
            })
        except Exception as err:  # never let one bad line kill the worker
            print(f"[kitten/worker] {err}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            emit({"id": request_id, "ok": False, "error": str(err)})


if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        print(f"[kitten/worker] fatal: {err}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
