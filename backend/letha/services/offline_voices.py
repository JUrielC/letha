"""
Voces sin conexión con el modelo Kokoro-82M (Apache 2.0) a través de kokoro-onnx. El modelo y sus voces se descargan
una sola vez desde un release de GitHub, se verifican con su huella SHA-256 y se guardan en la caché del usuario.
"""

from __future__ import annotations

import hashlib
import shutil
import threading
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from letha import __version__, config

FILES_URL = "https://github.com/JUrielC/letha/releases/download/voces-kokoro-1"

# Tamaño en bytes y huella SHA-256 de cada archivo publicado
FILES: Dict[str, Dict[str, Any]] = {
    "kokoro-v1.0.onnx": {"size": 325505369, "sha256": "beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a"},
    "voices-v1.0.bin": {"size": 28214398, "sha256": "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d"},
}
MODEL_FILE = "kokoro-v1.0.onnx"
VOICES_FILE = "voices-v1.0.bin"

VOICE_PREFIX = "kokoro-"
SAMPLE_RATE = 24000
# La primera letra de cada voz indica su idioma: idioma del libro, variante regional y pronunciación de espeak-ng
VOICE_LANGUAGES = {
    "a": ("en", "en-US", "en-us"),
    "b": ("en", "en-GB", "en-gb"),
    "e": ("es", "es-419", "es-419"),
    "f": ("fr", "fr-FR", "fr-fr"),
    "i": ("it", "it-IT", "it"),
    "p": ("pt", "pt-BR", "pt-br"),
}
VOICES = [
    "af_heart", "af_bella", "af_nicole", "af_sarah", "am_michael", "am_fenrir", "am_puck", "bf_emma", "bm_george",
    "ef_dora", "em_alex", "em_santa",
    "ff_siwis",
    "if_sara", "im_nicola",
    "pf_dora", "pm_alex", "pm_santa",
]
# espeak-ng no encuentra sus datos si la ruta pasa de unos 160 caracteres
MAX_ESPEAK_DATA_PATH = 150

_download: Optional[Dict[str, Any]] = None
_download_lock = threading.Lock()
_synth_lock = threading.Lock()
_kokoro: Any = None


def is_voice(voice: str) -> bool:
    return voice.startswith(VOICE_PREFIX) and voice[len(VOICE_PREFIX):] in VOICES


def _voice_id(voice: str) -> str:
    return voice[len(VOICE_PREFIX):]


def language_of(voice: str) -> str:
    return VOICE_LANGUAGES[_voice_id(voice)[0]][0]


def persona(voice: str) -> str:
    return _voice_id(voice).split("_", 1)[1].capitalize()


def _models_dir() -> Path:
    return config.CACHE_DIR / "voice-models"


def _installed_dir() -> Path:
    return _models_dir() / "kokoro"


def is_installed() -> bool:
    return all((_installed_dir() / name).is_file() for name in FILES)


def total_size() -> int:
    return sum(f["size"] for f in FILES.values())


def status() -> Dict[str, Any]:
    result: Dict[str, Any] = {"size": total_size(), "progress": 0.0, "error": None}
    download = _download
    if is_installed():
        result["status"] = "installed"
    elif download and download["error"]:
        result.update(status="error", error=download["error"])
    elif download:
        result.update(status="downloading", progress=download["downloaded"] / total_size())
    else:
        result["status"] = "missing"
    return result


def start_download() -> None:
    global _download
    with _download_lock:
        if is_installed() or (_download and not _download["error"]):
            return
        _download = {"downloaded": 0, "error": None}
        threading.Thread(target=_download_files, args=(_download,), daemon=True).start()


def _download_files(progress: Dict[str, Any]) -> None:
    global _download
    unpacked = _models_dir() / "kokoro.part"
    try:
        shutil.rmtree(unpacked, ignore_errors=True)
        unpacked.mkdir(parents=True)
        for name, expected in FILES.items():
            digest = hashlib.sha256()
            request = urllib.request.Request(f"{FILES_URL}/{name}", headers={"User-Agent": f"letha/{__version__}"})
            with urllib.request.urlopen(request, timeout=60) as response, open(unpacked / name, "wb") as f:
                while chunk := response.read(1 << 20):
                    f.write(chunk)
                    digest.update(chunk)
                    progress["downloaded"] += len(chunk)
            if digest.hexdigest() != expected["sha256"]:
                progress["error"] = "checksum_mismatch"
                return
        # Se renombra al final para que una descarga a medias nunca cuente como instalada
        unpacked.rename(_installed_dir())
        if _download is progress:
            _download = None
    except OSError:
        progress["error"] = "download_failed"
    finally:
        shutil.rmtree(unpacked, ignore_errors=True)


def delete() -> None:
    global _download, _kokoro
    with _synth_lock:
        _kokoro = None
        shutil.rmtree(_installed_dir(), ignore_errors=True)
    _download = None


def list_voices() -> List[Dict[str, Any]]:
    if not is_installed():
        return []
    return [
        {
            "name": persona(VOICE_PREFIX + voice_id),
            "short_name": VOICE_PREFIX + voice_id,
            "gender": "Female" if voice_id[1] == "f" else "Male",
            "locale": VOICE_LANGUAGES[voice_id[0]][1],
            "offline": True,
        }
        for voice_id in VOICES
    ]


def _espeak_data_path() -> str:
    import espeakng_loader

    data = Path(espeakng_loader.get_data_path())
    if len(str(data)) <= MAX_ESPEAK_DATA_PATH:
        return str(data)
    short = config.CACHE_DIR / "espeak-ng-data"
    if not short.is_dir():
        shutil.copytree(data, short)
    return str(short)


def _load() -> Any:
    global _kokoro
    if _kokoro is None:
        from kokoro_onnx import Kokoro
        from kokoro_onnx.config import EspeakConfig

        _kokoro = Kokoro(
            str(_installed_dir() / MODEL_FILE),
            str(_installed_dir() / VOICES_FILE),
            espeak_config=EspeakConfig(data_path=_espeak_data_path()),
        )
    return _kokoro


def _encode_mp3(samples: Any) -> bytes:
    import lameenc
    import numpy as np

    # Mismo formato que edge-tts (MP3 a 48 kbps): las partes de una página se unen y se miden igual
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    encoder = lameenc.Encoder()
    encoder.set_in_sample_rate(SAMPLE_RATE)
    encoder.set_out_sample_rate(SAMPLE_RATE)
    encoder.set_channels(1)
    encoder.set_bit_rate(48)
    encoder.set_quality(2)
    return bytes(encoder.encode(pcm) + encoder.flush())


def synthesize(texts: List[str], voice: str, speed: float) -> Tuple[bytes, float, List[Tuple[float, float]]]:
    """
    Genera las oraciones una por una y devuelve (audio MP3, duración, (inicio, fin) de cada oración).
    Es bloqueante: se llama desde un hilo para no detener el servidor.
    """
    import numpy as np

    if not is_installed():
        raise LookupError("Las voces sin conexión no están descargadas")
    voice_id = _voice_id(voice)
    lang = VOICE_LANGUAGES[voice_id[0]][2]
    chunks = []
    timings: List[Tuple[float, float]] = []
    cursor = 0
    with _synth_lock:
        kokoro = _load()
        for text in texts:
            start = cursor
            if text.strip():
                samples, _ = kokoro.create(text, voice=voice_id, speed=speed, lang=lang)
                chunks.append(samples)
                cursor += len(samples)
            timings.append((round(start / SAMPLE_RATE, 3), round(cursor / SAMPLE_RATE, 3)))
    audio = np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)
    return _encode_mp3(audio), round(cursor / SAMPLE_RATE, 3), timings
