"""
Traducción sin conexión con modelos Opus-MT (tc-big) de la Universidad de Helsinki, convertidos a
CTranslate2 en int8 (licencias CC BY 4.0 y Apache 2.0). Cada modelo se descarga una sola vez desde un release de GitHub, se verifica
con su huella SHA-256 y se guarda en la caché del usuario.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import threading
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from letha import __version__, config
from letha.services import model_catalog

# Respaldo para cuando el catálogo de letha.jurielc.com no responde
MODELS_URL = "https://github.com/JUrielC/letha/releases/download/modelos-traduccion-1"

# Tamaño en bytes y huella SHA-256 del .zip publicado de cada modelo
MODELS: Dict[str, Dict[str, Any]] = {
    "opus-mt-tc-big-en-es": {"size": 238571974, "sha256": "22b11b820faa46987ac4aef0ce3477d500bb991cfd39420dd5c87cf2e636f29e"},
    "opus-mt-tc-big-en-fr": {"size": 236461732, "sha256": "a204e0fa946891f250dafb1e71af58da5d41d358851c6f3613ff8ef1e6aad07b"},
    "opus-mt-tc-big-en-it": {"size": 237908713, "sha256": "389ecd6cdfa8bc749514e5879d0ac773367c7a841158d8f91f68392760282934"},
    "opus-mt-tc-big-en-pt": {"size": 238316935, "sha256": "d53e09997434246ca702787edff817adff06c3ed31571f9238c724f7a0b4f176"},
    "opus-mt-tc-big-itc-itc": {"size": 217841720, "sha256": "bde6c34e8323da37e496d2bc63b97d91f1868e94e31daed81b87081e4c075417"},
    "opus-mt-tc-bible-big-roa-en": {"size": 241653772, "sha256": "62b1d65acfa312eaa9f187c0fe25f3fa50b8f7ccc03230f17ebd0c1a0b1020c5"},
}

# Los modelos multilingües eligen el idioma de destino con una etiqueta al inicio del texto
TARGET_LABELS = {"es": ">>spa<<", "fr": ">>fra<<", "it": ">>ita<<", "pt": ">>pob<<"}
FROM_ENGLISH = {
    "es": "opus-mt-tc-big-en-es",
    "fr": "opus-mt-tc-big-en-fr",
    "it": "opus-mt-tc-big-en-it",
    "pt": "opus-mt-tc-big-en-pt",
}
# Un solo modelo de las lenguas romances al inglés: el tc-big de español a inglés publicado está roto
ENGLISH_MODEL = "opus-mt-tc-bible-big-roa-en"
ROMANCE_MODEL = "opus-mt-tc-big-itc-itc"
LABELED_MODELS = {ROMANCE_MODEL, FROM_ENGLISH["pt"]}

_downloads: Dict[str, Dict[str, Any]] = {}
_downloads_lock = threading.Lock()
_translate_lock = threading.Lock()
_loaded: Optional[Tuple[str, Any, Any, Any]] = None


def model_for(source: str, target: str) -> Optional[str]:
    if source == "en":
        return FROM_ENGLISH.get(target)
    if target == "en":
        return ENGLISH_MODEL if source in TARGET_LABELS else None
    if source != target and source in TARGET_LABELS and target in TARGET_LABELS:
        return ROMANCE_MODEL
    return None


def _models_dir() -> Path:
    return config.CACHE_DIR / "translation-models"


def is_installed(model: str) -> bool:
    return (_models_dir() / model / "model.bin").is_file()


def is_available(source: str, target: str) -> bool:
    model = model_for(source, target)
    return model is not None and is_installed(model)


def model_status(model: str) -> Dict[str, Any]:
    status: Dict[str, Any] = {"model": model, "size": MODELS[model]["size"], "progress": 0.0, "error": None}
    download = _downloads.get(model)
    if is_installed(model):
        status["status"] = "installed"
    elif download and download["error"]:
        status.update(status="error", error=download["error"])
    elif download:
        status.update(status="downloading", progress=download["downloaded"] / MODELS[model]["size"])
    else:
        status["status"] = "missing"
    return status


def start_download(model: str) -> None:
    with _downloads_lock:
        download = _downloads.get(model)
        if is_installed(model) or (download and not download["error"]):
            return
        _downloads[model] = {"downloaded": 0, "error": None}
    threading.Thread(target=_download, args=(model,), daemon=True).start()


def _download(model: str) -> None:
    directory = _models_dir()
    archive = directory / f"{model}.zip.part"
    unpacked = directory / f"{model}.part"
    try:
        directory.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256()
        url = model_catalog.resolve("translation", {model: f"{MODELS_URL}/{model}.zip"})[model]
        request = urllib.request.Request(url, headers={"User-Agent": f"letha/{__version__}"})
        with urllib.request.urlopen(request, timeout=60) as response, open(archive, "wb") as f:
            while chunk := response.read(1 << 20):
                f.write(chunk)
                digest.update(chunk)
                _downloads[model]["downloaded"] += len(chunk)
        if digest.hexdigest() != MODELS[model]["sha256"]:
            _downloads[model]["error"] = "checksum_mismatch"
            return
        shutil.rmtree(unpacked, ignore_errors=True)
        with zipfile.ZipFile(archive) as z:
            z.extractall(unpacked)
        # Se renombra al final para que un modelo a medio extraer nunca cuente como instalado
        unpacked.rename(directory / model)
        del _downloads[model]
    except (OSError, zipfile.BadZipFile):
        _downloads[model]["error"] = "download_failed"
    finally:
        archive.unlink(missing_ok=True)
        shutil.rmtree(unpacked, ignore_errors=True)


def delete_model(model: str) -> None:
    global _loaded
    with _translate_lock:
        if _loaded and _loaded[0] == model:
            _loaded = None
        shutil.rmtree(_models_dir() / model, ignore_errors=True)
    _downloads.pop(model, None)


def _load(model: str) -> Tuple[Any, Any, Any]:
    global _loaded
    if not _loaded or _loaded[0] != model:
        import ctranslate2
        import sentencepiece

        path = _models_dir() / model
        # Solo un modelo en memoria a la vez: cada uno ocupa unos 300 MB de RAM
        _loaded = None
        _loaded = (
            model,
            ctranslate2.Translator(
                str(path), device="cpu", compute_type="int8", intra_threads=min(4, os.cpu_count() or 1)
            ),
            sentencepiece.SentencePieceProcessor(model_file=str(path / "source.spm")),
            sentencepiece.SentencePieceProcessor(model_file=str(path / "target.spm")),
        )
    return _loaded[1], _loaded[2], _loaded[3]


def translate(texts: List[str], source: str, target: str) -> List[str]:
    model = model_for(source, target)
    if model is None or not is_installed(model):
        raise LookupError(f"No hay un modelo descargado para {source}->{target}")
    label = [TARGET_LABELS[target]] if model in LABELED_MODELS else []
    with _translate_lock:
        translator, source_sp, target_sp = _load(model)
        batch = [label + source_sp.encode(text, out_type=str) + ["</s>"] for text in texts]
        results = translator.translate_batch(batch, beam_size=4, max_decoding_length=512)
    return [target_sp.decode(result.hypotheses[0]) for result in results]
