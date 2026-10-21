"""
Procesamiento, limpieza y segmentación estructurada de PDFs usando PyMuPDF.
"""

from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Any, Dict, List, Tuple
import pymupdf


def split_sentences(text: str) -> List[str]:
    """
    Divide un texto en oraciones lógicas, respetando abreviaturas comunes y signos de puntuación.
    """
    if not text:
        return []

    # Proteger abreviaturas comunes en español e inglés
    abbrevs = [
        "Sr", "Sra", "Srta", "Dr", "Dra", "Prof", "Cap", "Art", "Vol", "Núm", "Pág",
        "pág", "etc", "vs", "Mr", "Mrs", "Ms", "e.g", "i.e",
    ]
    protected = text
    for i, abb in enumerate(abbrevs):
        pattern = rf"\b{re.escape(abb)}\."
        protected = re.sub(pattern, f"__ABB_{i}__", protected, flags=re.IGNORECASE)

    # Dividir por punto, exclamación, interrogación o saltos de párrafo dobles
    # preservando el delimitador
    raw_sentences = re.split(r"(?<=[.!?…])\s+|\n{2,}", protected)

    sentences = []
    for s in raw_sentences:
        s = s.strip()
        if not s:
            continue
        # Restaurar abreviaturas
        for i, abb in enumerate(abbrevs):
            s = s.replace(f"__ABB_{i}__", f"{abb}.")

        # Reemplazar saltos de línea internos por espacios
        s = re.sub(r"\s+", " ", s).strip()
        if len(s) > 1:
            sentences.append(s)

    return sentences


def clean_page_text(page: pymupdf.Page) -> str:
    """
    Extrae el texto de la página descartando márgenes superiores (encabezados)
    e inferiores (pies de página / números de página) y uniendo saltos de línea con guiones.
    """
    rect = page.rect
    page_height = rect.height

    # Filtrar texto que esté en el 7% superior o 7% inferior (márgenes típicos)
    top_margin = page_height * 0.07
    bottom_margin = page_height * 0.93

    blocks = page.get_text("blocks")
    # Formato de block: (x0, y0, x1, y1, text, block_no, block_type)
    # block_type 0 = texto, 1 = imagen

    page_text_pieces = []
    for b in blocks:
        if b[6] != 0:
            continue
        y0, y1 = b[1], b[3]
        text = b[4].strip()

        if not text:
            continue

        # Si el bloque está completamente en el margen superior o inferior, se descarta
        if y1 <= top_margin or y0 >= bottom_margin:
            # Comprobar si parece un número de página suelto o encabezado corto
            if len(text) < 40 or text.isdigit():
                continue

        page_text_pieces.append(text)

    full_page_text = "\n\n".join(page_text_pieces)

    # Arreglar palabras partidas al final de línea: ej. "cons-\ntrucción" -> "construcción"
    full_page_text = re.sub(r"(\w+)-\n(\w+)", r"\1\2", full_page_text)
    # Reemplazar saltos simples por espacios, conservando saltos dobles para párrafos
    full_page_text = re.sub(r"(?<!\n)\n(?!\n)", " ", full_page_text)

    return full_page_text.strip()


def extract_pdf_data(
    pdf_path: Path, covers_dir: Path
) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """
    Abre el PDF, genera la portada si es posible, y extrae los capítulos segmentados.
    """
    doc = pymupdf.open(str(pdf_path))
    total_pages = len(doc)
    meta = doc.metadata or {}

    title = meta.get("title") or pdf_path.stem
    author = meta.get("author") or "Autor Desconocido"

    # Generar portada renderizando la primera página a imagen
    cover_path = None
    if total_pages > 0:
        first_page = doc[0]
        pix = first_page.get_pixmap(dpi=150)
        cover_filename = f"{uuid.uuid4().hex[:12]}.png"
        full_cover_path = covers_dir / cover_filename
        pix.save(str(full_cover_path))
        cover_path = str(full_cover_path)

    # Mapa opcional de títulos desde el índice (TOC) por página (0-indexed)
    toc = doc.get_toc()  # [[lvl, title, page], ...]
    page_toc_titles: Dict[int, str] = {}
    for item in toc:
        if len(item) >= 3 and 1 <= item[2] <= total_pages:
            p_idx = item[2] - 1
            t = item[1].strip()
            if t and p_idx not in page_toc_titles:
                page_toc_titles[p_idx] = t

    chapters_data: List[Dict[str, Any]] = []
    current_section_title = ""
    chunk_idx = 0

    # Dividir página por página para que la síntesis de voz sea casi instantánea (1-2s por página)
    for p_num in range(total_pages):
        if p_num in page_toc_titles:
            current_section_title = page_toc_titles[p_num]

        p_text = clean_page_text(doc[p_num])
        if not p_text:
            continue

        sentences = split_sentences(p_text)
        if not sentences:
            continue

        if current_section_title:
            chap_title = f"Pág. {p_num + 1} — {current_section_title}"
        else:
            chap_title = f"Página {p_num + 1}"

        chapters_data.append(
            {
                "idx": chunk_idx,
                "title": chap_title,
                "start_page": p_num + 1,
                "end_page": p_num + 1,
                "text_content": p_text,
                "sentences": [
                    {"index": s_idx, "text": s_txt, "start": None, "end": None}
                    for s_idx, s_txt in enumerate(sentences)
                ],
            }
        )
        chunk_idx += 1

    doc.close()

    book_info = {
        "title": title,
        "author": author,
        "total_pages": total_pages,
        "cover_path": cover_path,
    }

    return book_info, chapters_data
