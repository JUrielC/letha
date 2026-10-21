"""
Síntesis de voz y extracción de marcas de tiempo con edge-tts.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Tuple
import edge_tts

from letha.config import DEFAULT_SPEED, DEFAULT_VOICE


async def list_available_voices() -> List[Dict[str, str]]:
    """
    Lista las voces neurales de edge-tts, priorizando español y luego inglés y otros idiomas.
    """
    voices = await edge_tts.list_voices()
    formatted = []
    for v in voices:
        short_name = v.get("ShortName", "")
        locale = v.get("Locale", "")
        gender = v.get("Gender", "")
        friendly_name = f"{short_name} ({gender}, {locale})"
        formatted.append(
            {
                "name": short_name,
                "short_name": short_name,
                "gender": gender,
                "locale": locale,
                "friendly_name": friendly_name,
            }
        )

    # Ordenar: primero 'es-', luego 'en-', luego el resto alfabético
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


async def synthesize_text_to_audio(
    text: str,
    voice: str = DEFAULT_VOICE,
    speed: float = DEFAULT_SPEED,
    output_audio_path: Path = None,
    output_alignment_path: Path = None,
) -> Tuple[float, List[Dict[str, Any]]]:
    """
    Sintetiza texto a archivo MP3 y captura los límites de cada oración con sus tiempos de inicio y fin.
    """
    if not text.strip():
        return 0.0, []

    rate_str = format_rate(speed)
    communicate = edge_tts.Communicate(text, voice, rate=rate_str)

    sentences_alignment: List[Dict[str, Any]] = []
    audio_bytes = bytearray()

    async for chunk in communicate.stream():
        c_type = chunk.get("type")
        if c_type == "audio":
            audio_bytes.extend(chunk.get("data", b""))
        elif c_type == "SentenceBoundary":
            # offset y duration vienen en unidades de 100ns (1 segundo = 10,000,000 unidades)
            raw_offset = chunk.get("offset", 0)
            raw_duration = chunk.get("duration", 0)
            sentence_text = chunk.get("text", "").strip()

            start_sec = round(raw_offset / 10_000_000.0, 3)
            end_sec = round((raw_offset + raw_duration) / 10_000_000.0, 3)

            sentences_alignment.append(
                {
                    "index": len(sentences_alignment),
                    "text": sentence_text,
                    "start": start_sec,
                    "end": end_sec,
                }
            )

    # Escribir el audio MP3
    output_audio_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_audio_path, "wb") as f:
        f.write(audio_bytes)

    # Si hay oraciones sincronizadas, la duración total es el final de la última oración
    total_duration = sentences_alignment[-1]["end"] if sentences_alignment else 0.0

    # Guardar archivo de alineación JSON
    output_alignment_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_alignment_path, "w", encoding="utf-8") as f:
        json.dump(sentences_alignment, f, ensure_ascii=False, indent=2)

    return total_duration, sentences_alignment
