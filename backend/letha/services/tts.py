"""
Síntesis de voz y extracción de marcas de tiempo con edge-tts para Letha
(aprendizaje de idiomas y mejora de pronunciación mediante lectura sincronizada en contexto).
Soporta carga progresiva dividiendo cada página en 5 solicitudes basadas en oraciones completas.
"""

from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import edge_tts

from letha.config import DEFAULT_SPEED, DEFAULT_VOICE

# edge-tts genera audio MP3 CBR a 24kHz 48kbps mono = 6000 bytes por segundo exactos
BYTES_PER_SECOND = 6000.0
MAX_CHUNK_CHARS = 450
MAX_CONCURRENCY = 8
DEFAULT_PAGE_PARTS = 5
# Velocidad base nativa para edge-tts (por defecto 85% de la velocidad estándar = -15%)
DEFAULT_EDGE_BASE_SPEED = 0.85
EDGE_BASE_SPEED = DEFAULT_EDGE_BASE_SPEED
DEFAULT_BOUNDARY_TYPE = "SentenceBoundary"
BOUNDARY_TYPE = DEFAULT_BOUNDARY_TYPE
AUDIO_CACHE_TAG = f"{EDGE_BASE_SPEED:.2f}"


def _refresh_cache_tag() -> str:
    global AUDIO_CACHE_TAG
    suffix = "_wb" if BOUNDARY_TYPE == "WordBoundary" else ""
    AUDIO_CACHE_TAG = f"{EDGE_BASE_SPEED:.2f}{suffix}"
    return AUDIO_CACHE_TAG


def get_edge_base_speed() -> float:
    return EDGE_BASE_SPEED


def set_edge_base_speed(speed: float) -> float:
    global EDGE_BASE_SPEED
    clamped = round(max(0.5, min(1.5, float(speed))), 2)
    EDGE_BASE_SPEED = clamped
    _refresh_cache_tag()
    return clamped


def get_boundary_type() -> str:
    return BOUNDARY_TYPE


def set_boundary_type(boundary: str) -> str:
    global BOUNDARY_TYPE
    BOUNDARY_TYPE = "WordBoundary" if boundary == "WordBoundary" else "SentenceBoundary"
    _refresh_cache_tag()
    return BOUNDARY_TYPE


def get_audio_cache_tag() -> str:
    return AUDIO_CACHE_TAG


# El orden define cómo se listan los idiomas; la variante indicada aparece primero en cada uno.
PRIMARY_LOCALES = {"es": "es-MX", "en": "en-US", "fr": "fr-FR", "it": "it-IT", "pt": "pt-BR"}
SUPPORTED_LANGUAGES = tuple(PRIMARY_LOCALES)


def voice_language(voice: str) -> str:
    return voice.split("-")[0].lower()


LOCALE_LABELS = {
    "es-MX": "Español (México)",
    "es-ES": "Español (España)",
    "es-AR": "Español (Argentina)",
    "es-CO": "Español (Colombia)",
    "es-CL": "Español (Chile)",
    "es-PE": "Español (Perú)",
    "es-VE": "Español (Venezuela)",
    "es-UY": "Español (Uruguay)",
    "es-EC": "Español (Ecuador)",
    "es-CR": "Español (Costa Rica)",
    "es-PA": "Español (Panamá)",
    "es-DO": "Español (Rep. Dominicana)",
    "es-GT": "Español (Guatemala)",
    "es-HN": "Español (Honduras)",
    "es-NI": "Español (Nicaragua)",
    "es-PR": "Español (Puerto Rico)",
    "es-PY": "Español (Paraguay)",
    "es-SV": "Español (El Salvador)",
    "es-BO": "Español (Bolivia)",
    "es-CU": "Español (Cuba)",
    "es-GQ": "Español (Guinea Ecuatorial)",
    "es-US": "Español (EE.UU.)",
    "en-US": "Inglés (EE.UU.)",
    "en-GB": "Inglés (Reino Unido)",
    "en-AU": "Inglés (Australia)",
    "en-CA": "Inglés (Canadá)",
    "en-IE": "Inglés (Irlanda)",
    "en-IN": "Inglés (India)",
    "en-NZ": "Inglés (Nueva Zelanda)",
    "en-ZA": "Inglés (Sudáfrica)",
    "en-SG": "Inglés (Singapur)",
    "en-HK": "Inglés (Hong Kong)",
    "en-PH": "Inglés (Filipinas)",
    "en-KE": "Inglés (Kenia)",
    "en-NG": "Inglés (Nigeria)",
    "en-TZ": "Inglés (Tanzania)",
    "fr-FR": "Francés (Francia)",
    "fr-CA": "Francés (Canadá)",
    "fr-BE": "Francés (Bélgica)",
    "fr-CH": "Francés (Suiza)",
    "it-IT": "Italiano (Italia)",
    "pt-BR": "Portugués (Brasil)",
    "pt-PT": "Portugués (Portugal)",
}


def _extract_persona_name(short_name: str) -> str:
    parts = short_name.split("-")
    raw = parts[2] if len(parts) >= 3 else short_name
    raw = re.sub(r"(Multilingual)?Neural$", "", raw)
    return raw or short_name


async def list_available_voices() -> List[Dict[str, str]]:
    """
    Lista las voces neurales de edge-tts de los idiomas soportados con nombres legibles
    de persona, idioma y género.
    """
    voices = await edge_tts.list_voices()
    formatted = []
    for v in voices:
        short_name = v.get("ShortName", "")
        locale = v.get("Locale", "")
        if voice_language(locale) not in SUPPORTED_LANGUAGES:
            continue
        gender = v.get("Gender", "")
        persona = _extract_persona_name(short_name)
        lang_label = LOCALE_LABELS.get(locale, locale)
        gender_label = "Mujer" if gender == "Female" else "Hombre" if gender == "Male" else gender
        friendly_name = f"{persona} — {lang_label} · {gender_label}"
        formatted.append(
            {
                "name": persona,
                "short_name": short_name,
                "gender": gender,
                "locale": locale,
                "friendly_name": friendly_name,
            }
        )

    def sort_key(item: Dict[str, str]):
        locale = item["locale"]
        language = voice_language(locale)
        return (
            SUPPORTED_LANGUAGES.index(language),
            locale != PRIMARY_LOCALES[language],
            locale,
            item["name"],
        )

    formatted.sort(key=sort_key)
    return formatted


def format_rate(speed: float = 1.0) -> str:
    """
    Convierte un factor de velocidad en el porcentaje de prosodia nativo para edge-tts,
    aplicando la velocidad base del 85% (EDGE_BASE_SPEED = 0.85 -> '-15%' cuando speed=1.0).
    """
    effective_speed = speed * EDGE_BASE_SPEED
    pct = int(round((effective_speed - 1.0) * 100))
    if pct >= 0:
        return f"+{pct}%"
    return f"{pct}%"


def partition_sentence_indices(total_sentences: int, total_parts: int = DEFAULT_PAGE_PARTS) -> List[List[int]]:
    """
    Divide los índices de las oraciones de una página en `total_parts` grupos contiguos
    sin cortar ninguna oración a la mitad, asignando primero los fragmentos iniciales.
    """
    if total_parts <= 0:
        total_parts = DEFAULT_PAGE_PARTS
    if total_sentences <= 0:
        return [[] for _ in range(total_parts)]

    base, rem = divmod(total_sentences, total_parts)
    groups: List[List[int]] = []
    cursor = 0
    for p in range(total_parts):
        count = base + (1 if p < rem else 0)
        groups.append(list(range(cursor, cursor + count)))
        cursor += count
    return groups


def _norm_token(token: str) -> str:
    return re.sub(r"[^\w]", "", token.lower())


def _align_words_to_sentences(
    sentence_texts: List[str],
    raw_boundaries: List[Dict[str, Any]],
    duration: float,
) -> List[Tuple[float, float, List[Dict[str, Any]]]]:
    n = len(sentence_texts)
    raw_end = raw_boundaries[-1]["end"] if raw_boundaries else 0.0
    scale = (duration / raw_end) if raw_end > duration and raw_end > 0 else 1.0

    scaled_words = [
        {
            "text": b["text"],
            "start": round(b["start"] * scale, 3),
            "end": round(max(b["start"], b["end"]) * scale, 3),
        }
        for b in raw_boundaries
    ]

    results: List[Tuple[float, float, List[Dict[str, Any]]]] = []
    cursor = 0
    total_w = len(scaled_words)

    for idx, s_text in enumerate(sentence_texts):
        if idx == n - 1:
            sent_words = scaled_words[cursor:]
            cursor = total_w
        else:
            start_cursor = cursor
            tokens = [t for t in re.findall(r"[\w'’]+", s_text) if _norm_token(t)]
            max_cursor = max(start_cursor, total_w - (n - 1 - idx))
            for t in tokens:
                if cursor >= max_cursor:
                    break
                nt = _norm_token(t)
                matched_offset = None
                for lookahead in range(min(4, max_cursor - cursor)):
                    nw = _norm_token(scaled_words[cursor + lookahead]["text"])
                    if nw == nt or (nw and nt and (nw in nt or nt in nw)):
                        matched_offset = lookahead
                        break
                if matched_offset is not None:
                    cursor += matched_offset + 1
                else:
                    cursor += 1
            sent_words = scaled_words[start_cursor:cursor]

        if sent_words:
            s_start = sent_words[0]["start"]
            s_end = sent_words[-1]["end"]
            if idx == n - 1 and duration > s_end:
                s_end = round(duration, 3)
            results.append((s_start, max(s_start, s_end), sent_words))
        else:
            prev_end = results[-1][1] if results else 0.0
            results.append((prev_end, prev_end, []))

    return results


async def synthesize_sentence_group(
    sentence_texts: List[str],
    voice: str = DEFAULT_VOICE,
    speed: float = 1.0,
) -> Tuple[bytes, float, List[Any]]:
    """
    Sintetiza un grupo de oraciones completas en una sola solicitud a edge-tts y
    devuelve (audio_bytes, duration_seconds, timings) alineado 1 a 1 con `sentence_texts`.
    En modo WordBoundary, cada elemento de `timings` incluye también la lista de palabras
    con sus tiempos `(start, end, words)`.
    """
    clean_texts = [s.strip() for s in sentence_texts if s.strip()]
    if not clean_texts:
        return b"", 0.0, [(0.0, 0.0) for _ in sentence_texts]

    joined_text = " ".join(clean_texts)
    rate_str = format_rate(speed)
    active_boundary = BOUNDARY_TYPE
    semaphore = asyncio.Semaphore(1)
    audio_bytes, raw_boundaries = await _synthesize_single_chunk(
        joined_text, voice, rate_str, semaphore, boundary=active_boundary
    )

    duration = len(audio_bytes) / BYTES_PER_SECOND
    if duration <= 0.0 and raw_boundaries:
        duration = raw_boundaries[-1]["end"]

    if active_boundary == "WordBoundary" and raw_boundaries:
        word_timings = _align_words_to_sentences(sentence_texts, raw_boundaries, duration)
        return bytes(audio_bytes), round(duration, 3), word_timings

    n = len(sentence_texts)
    timings: List[Tuple[float, float]] = []

    if len(raw_boundaries) == n and duration > 0:
        raw_end = raw_boundaries[-1]["end"]
        scale = (duration / raw_end) if raw_end > duration and raw_end > 0 else 1.0
        for idx, b in enumerate(raw_boundaries):
            s_start = round(b["start"] * scale, 3)
            s_end = round(b["end"] * scale, 3)
            if idx == n - 1 and duration > s_end:
                s_end = round(duration, 3)
            timings.append((s_start, max(s_start, s_end)))
    else:
        # Si edge-tts subdividió o fusionó alguna pausa interna, distribuimos la duración
        # exacta del fragmento proporcionalmente a la longitud en caracteres de cada oración,
        # garantizando correspondencia exacta 1 a 1 con las oraciones de la página.
        weights = [max(1, len(s.strip())) for s in sentence_texts]
        total_weight = sum(weights) or 1
        cursor = 0.0
        for idx, w in enumerate(weights):
            seg_dur = (w / total_weight) * duration
            s_start = round(cursor, 3)
            cursor += seg_dur
            s_end = round(duration if idx == n - 1 else cursor, 3)
            timings.append((s_start, max(s_start, s_end)))

    return bytes(audio_bytes), round(duration, 3), timings


def _split_text_into_chunks(text: str, max_chars: int = MAX_CHUNK_CHARS) -> List[str]:
    """
    Divide el texto en fragmentos de hasta `max_chars` caracteres respetando límites de oración.
    """
    raw_parts = re.split(r"(?<=[.!?…])\s+|\n+", text.strip())
    chunks: List[str] = []
    current: List[str] = []
    current_len = 0

    for part in raw_parts:
        part = part.strip()
        if not part:
            continue
        if current_len + len(part) + 1 > max_chars and current:
            chunks.append(" ".join(current))
            current = [part]
            current_len = len(part)
        else:
            current.append(part)
            current_len += len(part) + 1

    if current:
        chunks.append(" ".join(current))

    return chunks


async def _synthesize_single_chunk(
    chunk_text: str,
    voice: str,
    rate_str: str,
    semaphore: asyncio.Semaphore,
    boundary: str = "SentenceBoundary",
) -> Tuple[bytearray, List[Dict[str, Any]]]:
    """
    Sintetiza un fragmento individual con reintentos automáticos ante fallos de red.
    """
    boundary_arg = "WordBoundary" if boundary == "WordBoundary" else "SentenceBoundary"
    async with semaphore:
        last_err = None
        for attempt in range(3):
            try:
                communicate = edge_tts.Communicate(
                    chunk_text, voice, rate=rate_str, boundary=boundary_arg
                )
                audio_bytes = bytearray()
                sentences: List[Dict[str, Any]] = []

                async for chunk in communicate.stream():
                    c_type = chunk.get("type")
                    if c_type == "audio":
                        audio_bytes.extend(chunk.get("data", b""))
                    elif c_type in ("SentenceBoundary", "WordBoundary"):
                        raw_offset = chunk.get("offset", 0)
                        raw_duration = chunk.get("duration", 0)
                        sentence_text = chunk.get("text", "").strip()

                        start_sec = raw_offset / 10_000_000.0
                        end_sec = (raw_offset + raw_duration) / 10_000_000.0

                        sentences.append(
                            {
                                "text": sentence_text,
                                "start": start_sec,
                                "end": end_sec,
                            }
                        )
                return audio_bytes, sentences
            except Exception as e:
                last_err = e
                await asyncio.sleep(0.4 * (attempt + 1))
        raise RuntimeError(f"Error sintetizando fragmento tras 3 intentos: {last_err}")


async def synthesize_text_to_audio(
    text: str,
    voice: str = DEFAULT_VOICE,
    speed: float = DEFAULT_SPEED,
    output_audio_path: Path = None,
    output_alignment_path: Path = None,
) -> Tuple[float, List[Dict[str, Any]]]:
    """
    Sintetiza texto a archivo MP3 en paralelo por fragmentos y unifica los tiempos de cada oración.
    """
    if not text.strip():
        return 0.0, []

    rate_str = format_rate(speed)
    chunks = _split_text_into_chunks(text, MAX_CHUNK_CHARS)
    semaphore = asyncio.Semaphore(MAX_CONCURRENCY)

    tasks = [
        _synthesize_single_chunk(chunk_text, voice, rate_str, semaphore)
        for chunk_text in chunks
    ]
    results = await asyncio.gather(*tasks)

    total_audio_bytes = bytearray()
    sentences_alignment: List[Dict[str, Any]] = []
    time_offset = 0.0

    for chunk_audio, chunk_sentences in results:
        for s in chunk_sentences:
            sentences_alignment.append(
                {
                    "index": len(sentences_alignment),
                    "text": s["text"],
                    "start": round(time_offset + s["start"], 3),
                    "end": round(time_offset + s["end"], 3),
                }
            )
        total_audio_bytes.extend(chunk_audio)
        chunk_duration = len(chunk_audio) / BYTES_PER_SECOND
        time_offset += chunk_duration

    if output_audio_path is not None:
        output_audio_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_audio_path, "wb") as f:
            f.write(total_audio_bytes)

    total_duration = round(time_offset, 3)
    if sentences_alignment and sentences_alignment[-1]["end"] > total_duration:
        total_duration = sentences_alignment[-1]["end"]

    if output_alignment_path is not None:
        output_alignment_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_alignment_path, "w", encoding="utf-8") as f:
            json.dump(sentences_alignment, f, ensure_ascii=False, indent=2)

    return total_duration, sentences_alignment
