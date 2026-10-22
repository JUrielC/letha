"""
Síntesis de voz y extracción de marcas de tiempo con edge-tts (en línea) o Kokoro (local) para Letha
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
from letha.services import kokoro_engine
from letha.services.pdf import split_sentences

# edge-tts genera audio MP3 CBR a 24kHz 48kbps mono = 6000 bytes por segundo exactos
BYTES_PER_SECOND = 6000.0
MAX_CHUNK_CHARS = 450
MAX_CONCURRENCY = 8
DEFAULT_PAGE_PARTS = 5


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
    "fr-FR": "Francés (Francia)",
    "pt-BR": "Portugués (Brasil)",
    "pt-PT": "Portugués (Portugal)",
    "de-DE": "Alemán (Alemania)",
    "it-IT": "Italiano (Italia)",
}


def _extract_persona_name(short_name: str) -> str:
    if kokoro_engine.is_kokoro_voice(short_name):
        return kokoro_engine.persona_name(short_name)
    parts = short_name.split("-")
    raw = parts[2] if len(parts) >= 3 else short_name
    raw = re.sub(r"(Multilingual)?Neural$", "", raw)
    return raw or short_name


def voice_locale(voice: str) -> str:
    if kokoro_engine.is_kokoro_voice(voice):
        return kokoro_engine.voice_locale(voice)
    return "-".join(voice.split("-")[:2])


def _format_voice(short_name: str, locale: str, gender: str, engine_label: str = "") -> Dict[str, str]:
    persona = _extract_persona_name(short_name)
    lang_label = LOCALE_LABELS.get(locale, locale)
    gender_label = "Mujer" if gender == "Female" else "Hombre" if gender == "Male" else gender
    return {
        "name": persona,
        "short_name": short_name,
        "gender": gender,
        "locale": locale,
        "friendly_name": f"{persona} — {lang_label} · {gender_label}{engine_label}",
    }


async def list_available_voices() -> List[Dict[str, str]]:
    """
    Lista las voces locales de Kokoro (si está instalado) y las voces neurales de edge-tts
    con nombres legibles de persona, idioma y género.
    """
    formatted = []
    if kokoro_engine.is_available():
        formatted = [
            _format_voice(
                v,
                kokoro_engine.voice_locale(v),
                kokoro_engine.voice_gender(v),
                " · Kokoro (local)",
            )
            for v in kokoro_engine.list_voices()
        ]

    try:
        edge_voices = await edge_tts.list_voices()
    except Exception:
        if not formatted:
            raise
        edge_voices = []

    formatted.extend(
        _format_voice(v.get("ShortName", ""), v.get("Locale", ""), v.get("Gender", ""))
        for v in edge_voices
    )

    def sort_key(item: Dict[str, str]):
        loc = item["locale"].lower()
        engine_rank = 0 if kokoro_engine.is_kokoro_voice(item["short_name"]) else 1
        if loc.startswith("es-mx"):
            group = 0
        elif loc.startswith("es-"):
            group = 1
        elif loc.startswith("en-"):
            group = 2
        else:
            group = 3
        return (group, engine_rank, loc, item["name"])

    formatted.sort(key=sort_key)
    return formatted


def format_rate(speed: float) -> str:
    """Convierte un factor como 1.25 en '+25%' o 0.9 en '-10%' para edge-tts."""
    pct = int(round((speed - 1.0) * 100))
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


async def synthesize_sentence_group(
    sentence_texts: List[str],
    voice: str = DEFAULT_VOICE,
    speed: float = 1.0,
) -> Tuple[bytes, float, List[Tuple[float, float]]]:
    """
    Sintetiza un grupo de oraciones completas en una sola solicitud a edge-tts (o localmente
    con Kokoro) y devuelve (audio_bytes, duration_seconds, [(start, end), ...]) alineado 1 a 1
    con `sentence_texts`.
    """
    if kokoro_engine.is_kokoro_voice(voice):
        return await asyncio.to_thread(
            kokoro_engine.synthesize_sentences, sentence_texts, voice, speed
        )

    clean_texts = [s.strip() for s in sentence_texts if s.strip()]
    if not clean_texts:
        return b"", 0.0, [(0.0, 0.0) for _ in sentence_texts]

    joined_text = " ".join(clean_texts)
    rate_str = format_rate(speed)
    semaphore = asyncio.Semaphore(1)
    audio_bytes, raw_boundaries = await _synthesize_single_chunk(
        joined_text, voice, rate_str, semaphore
    )

    duration = len(audio_bytes) / BYTES_PER_SECOND
    if duration <= 0.0 and raw_boundaries:
        duration = raw_boundaries[-1]["end"]

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
) -> Tuple[bytearray, List[Dict[str, Any]]]:
    """
    Sintetiza un fragmento individual con reintentos automáticos ante fallos de red.
    """
    async with semaphore:
        last_err = None
        for attempt in range(3):
            try:
                communicate = edge_tts.Communicate(chunk_text, voice, rate=rate_str)
                audio_bytes = bytearray()
                sentences: List[Dict[str, Any]] = []

                async for chunk in communicate.stream():
                    c_type = chunk.get("type")
                    if c_type == "audio":
                        audio_bytes.extend(chunk.get("data", b""))
                    elif c_type == "SentenceBoundary":
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

    if kokoro_engine.is_kokoro_voice(voice):
        sentence_texts = split_sentences(text)
        audio_bytes, total_duration, timings = await synthesize_sentence_group(
            sentence_texts, voice, speed
        )
        sentences_alignment = [
            {"index": i, "text": sentence, "start": start, "end": end}
            for i, (sentence, (start, end)) in enumerate(zip(sentence_texts, timings, strict=True))
        ]
        _write_outputs(audio_bytes, sentences_alignment, output_audio_path, output_alignment_path)
        return total_duration, sentences_alignment

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

    total_duration = round(time_offset, 3)
    if sentences_alignment and sentences_alignment[-1]["end"] > total_duration:
        total_duration = sentences_alignment[-1]["end"]

    _write_outputs(total_audio_bytes, sentences_alignment, output_audio_path, output_alignment_path)
    return total_duration, sentences_alignment


def _write_outputs(
    audio_bytes: bytes,
    sentences_alignment: List[Dict[str, Any]],
    output_audio_path: Optional[Path],
    output_alignment_path: Optional[Path],
) -> None:
    if output_audio_path is not None:
        output_audio_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_audio_path, "wb") as f:
            f.write(audio_bytes)

    if output_alignment_path is not None:
        output_alignment_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_alignment_path, "w", encoding="utf-8") as f:
            json.dump(sentences_alignment, f, ensure_ascii=False, indent=2)
