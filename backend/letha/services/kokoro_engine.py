"""
Motor de síntesis local con Kokoro-82M para voces en inglés, sin conexión a internet.
Es opcional: requiere instalar el extra `letha[kokoro]`.
"""

from __future__ import annotations

import importlib.util
import threading
from typing import Any, Dict, List, Tuple

VOICE_PREFIX = "kokoro-"
REPO_ID = "hexgrad/Kokoro-82M"
SAMPLE_RATE = 24000
# Debe producir los 6000 bytes/s que asume tts.BYTES_PER_SECOND al ensamblar las partes de una página.
MP3_BITRATE_KBPS = 48
# Kokoro deja ~0.3 s de silencio al inicio y ~0.5 s al final de cada oración; sin recortar, las pausas entre oraciones casi duplican lo natural.
SILENCE_THRESHOLD = 0.02
MAX_LEADING_SILENCE = 0.12
MAX_TRAILING_SILENCE = 0.3

VOICE_IDS = (
    "af_heart",
    "af_bella",
    "af_aoede",
    "af_kore",
    "af_sarah",
    "am_michael",
    "am_fenrir",
    "am_puck",
    "bf_emma",
    "bf_isabella",
    "bm_george",
    "bm_fable",
)

_lock = threading.Lock()
_model = None
_pipelines: Dict[str, Any] = {}


def is_available() -> bool:
    return all(
        importlib.util.find_spec(name) is not None
        for name in ("kokoro", "lameenc", "en_core_web_sm")
    )


def is_kokoro_voice(voice: str) -> bool:
    return voice.startswith(VOICE_PREFIX)


def list_voices() -> List[str]:
    return [f"{VOICE_PREFIX}{voice_id}" for voice_id in VOICE_IDS]


def _voice_id(voice: str) -> str:
    voice_id = voice[len(VOICE_PREFIX):]
    if voice_id not in VOICE_IDS:
        raise ValueError(f"Voz de Kokoro desconocida: {voice}")
    return voice_id


def persona_name(voice: str) -> str:
    return _voice_id(voice)[3:].capitalize()


def voice_locale(voice: str) -> str:
    return "en-GB" if _voice_id(voice).startswith("b") else "en-US"


def voice_gender(voice: str) -> str:
    return "Female" if _voice_id(voice)[1] == "f" else "Male"


def _get_pipeline(lang_code: str):
    global _model
    from kokoro import KModel, KPipeline

    if _model is None:
        _model = KModel(repo_id=REPO_ID).eval()
    if lang_code not in _pipelines:
        _pipelines[lang_code] = KPipeline(lang_code=lang_code, repo_id=REPO_ID, model=_model)
    return _pipelines[lang_code]


def _trim_pauses(audio):
    import numpy as np

    loud = np.flatnonzero(np.abs(audio) > SILENCE_THRESHOLD)
    if loud.size == 0:
        return audio
    start = max(0, loud[0] - int(MAX_LEADING_SILENCE * SAMPLE_RATE))
    end = min(len(audio), loud[-1] + int(MAX_TRAILING_SILENCE * SAMPLE_RATE))
    return audio[start:end]


def _encode_mp3(samples) -> bytes:
    import lameenc
    import numpy as np

    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype(np.int16).tobytes()
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(MP3_BITRATE_KBPS)
    encoder.set_in_sample_rate(SAMPLE_RATE)
    encoder.set_channels(1)
    encoder.set_quality(2)
    return bytes(encoder.encode(pcm) + encoder.flush())


def synthesize_sentences(
    sentence_texts: List[str], voice: str, speed: float = 1.0
) -> Tuple[bytes, float, List[Tuple[float, float]]]:
    """
    Sintetiza cada oración por separado y devuelve (audio_mp3, duración, [(inicio, fin), ...])
    alineado 1 a 1 con `sentence_texts`, con el mismo contrato que `tts.synthesize_sentence_group`.
    """
    import numpy as np

    voice_id = _voice_id(voice)
    pieces = []
    timings: List[Tuple[float, float]] = []
    cursor = 0

    with _lock:
        pipeline = _get_pipeline(voice_id[0])
        for text in sentence_texts:
            start = cursor
            if text.strip():
                chunks = [
                    result.audio.numpy()
                    for result in pipeline(text.strip(), voice=voice_id, speed=speed, split_pattern=None)
                    if result.audio is not None
                ]
                if chunks:
                    audio = _trim_pauses(np.concatenate(chunks))
                    pieces.append(audio)
                    cursor += len(audio)
            timings.append((round(start / SAMPLE_RATE, 3), round(cursor / SAMPLE_RATE, 3)))

    if not pieces:
        return b"", 0.0, timings

    mp3 = _encode_mp3(np.concatenate(pieces))
    return mp3, round(len(mp3) * 8 / (MP3_BITRATE_KBPS * 1000), 3), timings
