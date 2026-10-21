"""
Síntesis de voz y extracción de marcas de tiempo con edge-tts.
Soporta síntesis paralela por fragmentos para que capítulos largos se generen en pocos segundos.
"""

from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Tuple
import edge_tts

from letha.config import DEFAULT_SPEED, DEFAULT_VOICE

# edge-tts genera audio MP3 CBR a 24kHz 48kbps mono = 6000 bytes por segundo exactos
BYTES_PER_SECOND = 6000.0
MAX_CHUNK_CHARS = 450
MAX_CONCURRENCY = 8


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
    parts = short_name.split("-")
    raw = parts[2] if len(parts) >= 3 else short_name
    raw = re.sub(r"(Multilingual)?Neural$", "", raw)
    return raw or short_name


async def list_available_voices() -> List[Dict[str, str]]:
    """
    Lista las voces neurales de edge-tts con nombres legibles de persona, idioma y género.
    """
    voices = await edge_tts.list_voices()
    formatted = []
    for v in voices:
        short_name = v.get("ShortName", "")
        locale = v.get("Locale", "")
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
        loc = item["locale"].lower()
        if loc.startswith("es-mx"):
            return (0, loc, item["name"])
        elif loc.startswith("es-"):
            return (1, loc, item["name"])
        elif loc.startswith("en-"):
            return (2, loc, item["name"])
        return (3, loc, item["name"])

    formatted.sort(key=sort_key)
    return formatted


def format_rate(speed: float) -> str:
    """Convierte un factor como 1.25 en '+25%' o 0.9 en '-10%' para edge-tts."""
    pct = int(round((speed - 1.0) * 100))
    if pct >= 0:
        return f"+{pct}%"
    return f"{pct}%"


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
