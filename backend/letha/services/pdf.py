"""
Procesamiento, limpieza y segmentación estructurada de PDFs usando PyMuPDF.
"""

from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import pymupdf


# Palabras frecuentes que solo aparecen en un idioma; las compartidas ("de", "que", "il"...) no distinguen.
LANGUAGE_MARKERS = {
    "en": {
        "the", "and", "of", "to", "is", "was", "he", "she", "it", "that", "with", "for", "you",
        "his", "her", "not", "had", "but", "at", "this", "they", "have", "be", "which", "from",
        "what", "there", "were", "would", "been",
    },
    "es": {
        "el", "los", "las", "y", "pero", "muy", "fue", "ella", "él", "sus", "también", "cuando",
        "sin", "hasta", "eso", "había", "ya", "aquí", "entonces", "después", "dijo",
    },
    "fr": {
        "les", "des", "et", "est", "du", "pas", "dans", "pour", "elle", "avec", "sur", "au", "aux",
        "ce", "cette", "ont", "était", "sont", "nous", "vous", "je", "avait", "comme", "tout",
    },
    "it": {
        "di", "che", "è", "gli", "della", "delle", "sono", "per", "nel", "nella", "alla", "anche",
        "questo", "questa", "lei", "loro", "dei", "degli", "però", "aveva", "molto", "cosa",
    },
    "pt": {
        "os", "das", "não", "em", "um", "uma", "com", "ao", "foi", "ele", "ela", "seu", "sua",
        "muito", "também", "isso", "mas", "você", "então", "depois", "já", "até", "eu",
    },
}


def detect_language(text: str) -> Optional[str]:
    """Devuelve el idioma dominante del texto, o None si no es concluyente."""
    words = re.findall(r"[^\W\d_]+", text.lower())
    scores = sorted(
        ((sum(1 for w in words if w in markers), lang) for lang, markers in LANGUAGE_MARKERS.items()),
        reverse=True,
    )
    (best_score, best_lang), (second_score, _) = scores[0], scores[1]
    if best_score < 10 or best_score < 1.5 * second_score:
        return None
    return best_lang


ABBREVS = [
    "Sr", "Sra", "Srta", "Dr", "Dra", "Prof", "Cap", "Art", "Vol", "Núm", "Pág",
    "pág", "etc", "vs", "Mr", "Mrs", "Ms", "St", "Jr", "Inc", "Ltd", "Co",
    "e.g", "i.e", "U.S", "U.K",
]


def _protect_abbrevs(text: str) -> str:
    protected = text
    for i, abb in enumerate(ABBREVS):
        pattern = rf"\b{re.escape(abb)}\."
        protected = re.sub(pattern, f"__ABB_{i}__", protected, flags=re.IGNORECASE)
    return protected


def _restore_abbrevs(text: str) -> str:
    restored = text
    for i, abb in enumerate(ABBREVS):
        restored = restored.replace(f"__ABB_{i}__", f"{abb}.")
    return restored


def is_complete_sentence(sentence: str) -> bool:
    """
    Determina si un fragmento termina como una oración completa (. ! ? …),
    incluyendo cuando cierra con comillas o paréntesis (ej. '."', '?"', '!”'),
    descartando abreviaturas como 'Mr.' o 'Dr.'.
    """
    s = sentence.strip()
    if not s:
        return False
    protected = _protect_abbrevs(s).strip()
    return bool(re.search(r'[.!?…]["”’\'»)\]]*$', protected))


def split_sentences(text: str) -> List[str]:
    """
    Divide un texto en oraciones lógicas, respetando abreviaturas comunes,
    signos de puntuación y comillas de cierre.
    """
    if not text or not text.strip():
        return []

    protected = _protect_abbrevs(text)

    # Dividir tras signo terminal (. ! ? …) seguido opcionalmente de comillas/paréntesis de cierre
    protected = re.sub(
        r'([.!?…]["”’\'»)\]]*)\s+',
        r"\1\n\n",
        protected,
    )
    raw_sentences = re.split(r"\n{2,}", protected)

    sentences = []
    for s in raw_sentences:
        s = s.strip()
        if not s:
            continue
        s = _restore_abbrevs(s)
        s = re.sub(r"\s+", " ", s).strip()
        if s:
            sentences.append(s)

    return sentences


def _join_carryover(carryover: str, next_text: str) -> str:
    """Une una oración incompleta de la página anterior con el inicio de la página siguiente."""
    c = carryover.strip()
    n = next_text.strip()
    if not c:
        return n
    if not n:
        return c
    if c.endswith(("-", "‐", "­")):
        return f"{c[:-1]}{n}"
    return f"{c} {n}"


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


def reassemble_chapters_data(raw_chapters: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Rearma el texto entre páginas consecutivas: si una página termina con una
    oración incompleta (ej. 'It was'), termina la página en la última oración
    completa y pasa el fragmento incompleto al inicio de la página siguiente.
    """
    if not raw_chapters:
        return []

    assembled: List[Dict[str, Any]] = []
    carryover = ""
    total = len(raw_chapters)

    for i, chap in enumerate(raw_chapters):
        combined_text = _join_carryover(carryover, chap["text_content"])
        carryover = ""

        sentences = split_sentences(combined_text)
        if not sentences:
            continue

        is_last_page = i == total - 1
        can_carry = len(sentences) > 1 or len(sentences[0]) > 120
        if not is_last_page and can_carry and not is_complete_sentence(sentences[-1]):
            carryover = sentences.pop()

        if not sentences:
            continue

        final_text = " ".join(sentences)
        assembled.append(
            {
                "idx": len(assembled),
                "title": chap["title"],
                "start_page": chap["start_page"],
                "end_page": chap["end_page"],
                "text_content": final_text,
                "sentences": [
                    {"index": s_idx, "text": s_txt, "start": None, "end": None}
                    for s_idx, s_txt in enumerate(sentences)
                ],
            }
        )

    if carryover and assembled:
        last = assembled[-1]
        merged_text = _join_carryover(last["text_content"], carryover)
        merged_sentences = split_sentences(merged_text)
        last["text_content"] = " ".join(merged_sentences)
        last["sentences"] = [
            {"index": s_idx, "text": s_txt, "start": None, "end": None}
            for s_idx, s_txt in enumerate(merged_sentences)
        ]

    return assembled


def extract_pdf_data(
    pdf_path: Path, covers_dir: Path
) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """
    Abre el PDF, genera la portada si es posible, y extrae los capítulos segmentados
    rearmando oraciones que queden cortadas entre páginas.
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

    raw_chapters: List[Dict[str, Any]] = []
    current_section_title = ""

    for p_num in range(total_pages):
        if p_num in page_toc_titles:
            current_section_title = page_toc_titles[p_num]

        p_text = clean_page_text(doc[p_num])
        if not p_text:
            continue

        if current_section_title:
            chap_title = f"Pág. {p_num + 1} — {current_section_title}"
        else:
            chap_title = f"Página {p_num + 1}"

        raw_chapters.append(
            {
                "title": chap_title,
                "start_page": p_num + 1,
                "end_page": p_num + 1,
                "text_content": p_text,
            }
        )

    doc.close()

    chapters_data = reassemble_chapters_data(raw_chapters)

    book_info = {
        "title": title,
        "author": author,
        "total_pages": total_pages,
        "cover_path": cover_path,
    }

    return book_info, chapters_data
