"""
Base de datos SQLite local para gestionar la biblioteca, capítulos y progreso de lectura.
"""

from __future__ import annotations

import json
from pathlib import Path
import sqlite3
import time
from typing import Any, Dict, List, Optional

from letha import config
from letha.config import DEFAULT_SPEED, DEFAULT_VOICE
from letha.models import BookDetail, BookSummary, ChapterDetail, ChapterSummary, SentenceItem
from letha.services import pdf as pdf_service
from letha.services import tts as tts_service


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Inicializa las tablas de la base de datos si no existen."""
    with get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS books (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                author TEXT NOT NULL,
                file_path TEXT NOT NULL,
                cover_path TEXT,
                total_pages INTEGER NOT NULL,
                total_chapters INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                last_read_at INTEGER NOT NULL,
                current_chapter_idx INTEGER DEFAULT 0,
                current_sentence_idx INTEGER DEFAULT 0,
                voice TEXT NOT NULL,
                speed REAL DEFAULT 1.0
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS chapters (
                id TEXT PRIMARY KEY,
                book_id TEXT NOT NULL,
                idx INTEGER NOT NULL,
                title TEXT NOT NULL,
                start_page INTEGER NOT NULL,
                end_page INTEGER NOT NULL,
                text_content TEXT NOT NULL,
                sentences_json TEXT NOT NULL,
                audio_path TEXT,
                alignment_path TEXT,
                duration_seconds REAL,
                FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_chapters_book_id ON chapters (book_id, idx)")
        # Limpiar audios antiguos generados a velocidades distintas de 1.00x
        # para evitar que suenen acelerados al combinarse con playbackRate.
        conn.execute(
            """
            UPDATE chapters
            SET audio_path = NULL, alignment_path = NULL, duration_seconds = NULL
            WHERE audio_path IS NOT NULL AND audio_path NOT LIKE '%_1.00.mp3'
            """
        )
        _migrate_reassemble_existing_books(conn)
        conn.commit()


def _migrate_reassemble_existing_books(conn: sqlite3.Connection) -> None:
    """
    Rearma las páginas de los libros ya existentes en la base de datos si alguna
    página terminaba con una oración incompleta (ej. 'It was' al final de página).
    Es idempotente: una vez rearmadas, no vuelve a modificar los capítulos.
    """
    book_rows = conn.execute("SELECT id FROM books").fetchall()
    for b_row in book_rows:
        book_id = b_row["id"]
        chap_rows = conn.execute(
            "SELECT id, idx, title, start_page, end_page, text_content FROM chapters WHERE book_id = ? ORDER BY idx ASC",
            (book_id,),
        ).fetchall()
        if not chap_rows:
            continue

        raw_chaps = [dict(r) for r in chap_rows]
        assembled = pdf_service.reassemble_chapters_data(raw_chaps)
        if len(assembled) != len(raw_chaps):
            continue

        for old_c, new_c in zip(raw_chaps, assembled):
            if old_c["text_content"].strip() != new_c["text_content"].strip():
                c_idx = old_c["idx"]
                conn.execute(
                    """
                    UPDATE chapters
                    SET text_content = ?, sentences_json = ?, audio_path = NULL, alignment_path = NULL, duration_seconds = NULL
                    WHERE id = ?
                    """,
                    (
                        new_c["text_content"],
                        json.dumps(new_c["sentences"]),
                        old_c["id"],
                    ),
                )
                for stale_file in config.AUDIO_DIR.glob(f"{book_id}_c{c_idx}_*"):
                    try:
                        stale_file.unlink()
                    except OSError:
                        pass


def list_books() -> List[BookSummary]:
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM books ORDER BY last_read_at DESC").fetchall()
        result = []
        for r in rows:
            cover_url = f"/api/books/{r['id']}/cover" if r["cover_path"] else None
            result.append(
                BookSummary(
                    id=r["id"],
                    title=r["title"],
                    author=r["author"],
                    total_pages=r["total_pages"],
                    total_chapters=r["total_chapters"],
                    cover_url=cover_url,
                    current_chapter_idx=r["current_chapter_idx"],
                    current_sentence_idx=r["current_sentence_idx"],
                    voice=r["voice"],
                    speed=r["speed"],
                    created_at=r["created_at"],
                    last_read_at=r["last_read_at"],
                )
            )
        return result


def _chapter_voice_files(book_id: str, chapter_idx: int, voice: str) -> tuple[Path, Path]:
    audio_file = config.AUDIO_DIR / f"{book_id}_c{chapter_idx}_{voice}_1.00.mp3"
    align_file = config.AUDIO_DIR / f"{book_id}_c{chapter_idx}_{voice}_1.00.json"
    return audio_file, align_file


def get_book(book_id: str) -> Optional[BookDetail]:
    with get_connection() as conn:
        r = conn.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
        if not r:
            return None

        active_voice = r["voice"] or DEFAULT_VOICE

        chapters_rows = conn.execute(
            "SELECT idx, title, start_page, end_page, audio_path, duration_seconds FROM chapters WHERE book_id = ? ORDER BY idx ASC",
            (book_id,),
        ).fetchall()

        chapters = []
        for c in chapters_rows:
            audio_file, align_file = _chapter_voice_files(book_id, c["idx"], active_voice)
            has_voice_audio = audio_file.exists() and align_file.exists()
            chapters.append(
                ChapterSummary(
                    idx=c["idx"],
                    title=c["title"],
                    start_page=c["start_page"],
                    end_page=c["end_page"],
                    has_audio=has_voice_audio,
                    duration_seconds=c["duration_seconds"] if has_voice_audio else None,
                )
            )

        cover_url = f"/api/books/{r['id']}/cover" if r["cover_path"] else None
        return BookDetail(
            id=r["id"],
            title=r["title"],
            author=r["author"],
            total_pages=r["total_pages"],
            total_chapters=r["total_chapters"],
            cover_url=cover_url,
            current_chapter_idx=r["current_chapter_idx"],
            current_sentence_idx=r["current_sentence_idx"],
            voice=active_voice,
            speed=r["speed"],
            created_at=r["created_at"],
            last_read_at=r["last_read_at"],
            chapters=chapters,
        )


def get_chapter(
    book_id: str, chapter_idx: int, voice: Optional[str] = None
) -> Optional[ChapterDetail]:
    with get_connection() as conn:
        book_row = conn.execute("SELECT voice FROM books WHERE id = ?", (book_id,)).fetchone()
        if not book_row:
            return None
        active_voice = voice or book_row["voice"] or DEFAULT_VOICE

        r = conn.execute(
            "SELECT * FROM chapters WHERE book_id = ? AND idx = ?",
            (book_id, chapter_idx),
        ).fetchone()
        if not r:
            return None

        base_texts = pdf_service.split_sentences(r["text_content"])
        if not base_texts:
            try:
                raw_saved = json.loads(r["sentences_json"])
                base_texts = [s["text"] for s in raw_saved if s.get("text")]
            except Exception:
                base_texts = []

        audio_file, align_file = _chapter_voice_files(book_id, chapter_idx, active_voice)
        total_parts = tts_service.DEFAULT_PAGE_PARTS
        loaded_parts = 0
        has_voice_audio = False
        duration_seconds: Optional[float] = None
        sentences: List[SentenceItem] = []

        if audio_file.exists() and align_file.exists():
            try:
                cached_data = json.loads(align_file.read_text(encoding="utf-8"))
                if len(cached_data) == len(base_texts) and all(
                    isinstance(item.get("start"), (int, float)) for item in cached_data
                ):
                    sentences = [SentenceItem(**item) for item in cached_data]
                    has_voice_audio = True
                    loaded_parts = total_parts
                    duration_seconds = (
                        float(cached_data[-1]["end"]) if cached_data else 0.0
                    )
            except Exception:
                has_voice_audio = False

        if not sentences:
            base_prefix = f"{book_id}_c{chapter_idx}_{active_voice}_1.00"
            groups = tts_service.partition_sentence_indices(len(base_texts), total_parts)

            # Comprobar cuántos fragmentos iniciales (0, 1, ...) ya fueron precargados
            contiguous_parts = 0
            for p in range(total_parts):
                p_audio = config.AUDIO_DIR / f"{base_prefix}.p{p}of{total_parts}.mp3"
                p_meta = config.AUDIO_DIR / f"{base_prefix}.p{p}of{total_parts}.json"
                if p_audio.exists() and p_meta.exists():
                    contiguous_parts = p + 1
                else:
                    break

            raw_items = [
                {"index": i, "text": txt, "start": None, "end": None}
                for i, txt in enumerate(base_texts)
            ]

            if contiguous_parts > 0:
                combined_audio = bytearray()
                time_offset = 0.0
                try:
                    for p in range(contiguous_parts):
                        p_audio = config.AUDIO_DIR / f"{base_prefix}.p{p}of{total_parts}.mp3"
                        p_meta = config.AUDIO_DIR / f"{base_prefix}.p{p}of{total_parts}.json"
                        p_bytes = p_audio.read_bytes()
                        meta = json.loads(p_meta.read_text(encoding="utf-8"))
                        p_indices = groups[p]
                        p_timings = meta.get("timings", [])
                        for idx_in_group, sent_idx in enumerate(p_indices):
                            if idx_in_group < len(p_timings):
                                rel_start, rel_end = p_timings[idx_in_group]
                                raw_items[sent_idx]["start"] = round(time_offset + rel_start, 3)
                                raw_items[sent_idx]["end"] = round(time_offset + rel_end, 3)
                        combined_audio.extend(p_bytes)
                        time_offset += len(p_bytes) / tts_service.BYTES_PER_SECOND

                    partial_audio_path = config.AUDIO_DIR / f"{base_prefix}.partial.mp3"
                    if not partial_audio_path.exists():
                        partial_audio_path.write_bytes(bytes(combined_audio))

                    loaded_parts = contiguous_parts
                    duration_seconds = round(time_offset, 3)
                except Exception:
                    loaded_parts = 0

            sentences = [SentenceItem(**item) for item in raw_items]

        return ChapterDetail(
            idx=r["idx"],
            book_id=r["book_id"],
            title=r["title"],
            start_page=r["start_page"],
            end_page=r["end_page"],
            text_content=r["text_content"],
            sentences=sentences,
            has_audio=has_voice_audio,
            loaded_parts=loaded_parts,
            total_parts=total_parts,
            duration_seconds=duration_seconds,
        )


def insert_book(
    book_id: str,
    title: str,
    author: str,
    file_path: str,
    cover_path: Optional[str],
    total_pages: int,
    chapters_data: List[Dict[str, Any]],
    voice: str = DEFAULT_VOICE,
    speed: float = DEFAULT_SPEED,
):
    now = int(time.time())
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO books (
                id, title, author, file_path, cover_path, total_pages,
                total_chapters, created_at, last_read_at, current_chapter_idx,
                current_sentence_idx, voice, speed
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
            """,
            (
                book_id,
                title,
                author,
                file_path,
                cover_path,
                total_pages,
                len(chapters_data),
                now,
                now,
                voice,
                speed,
            ),
        )

        for c in chapters_data:
            chapter_id = f"{book_id}_c{c['idx']}"
            conn.execute(
                """
                INSERT INTO chapters (
                    id, book_id, idx, title, start_page, end_page,
                    text_content, sentences_json, audio_path, alignment_path, duration_seconds
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
                """,
                (
                    chapter_id,
                    book_id,
                    c["idx"],
                    c["title"],
                    c["start_page"],
                    c["end_page"],
                    c["text_content"],
                    json.dumps(c["sentences"]),
                ),
            )
        conn.commit()


def update_progress(book_id: str, chapter_idx: int, sentence_idx: int):
    now = int(time.time())
    with get_connection() as conn:
        conn.execute(
            """
            UPDATE books
            SET current_chapter_idx = ?, current_sentence_idx = ?, last_read_at = ?
            WHERE id = ?
            """,
            (chapter_idx, sentence_idx, now, book_id),
        )
        conn.commit()


def update_book_settings(
    book_id: str, voice: Optional[str] = None, speed: Optional[float] = None
):
    with get_connection() as conn:
        if voice is not None:
            conn.execute("UPDATE books SET voice = ? WHERE id = ?", (voice, book_id))
            # Sincronizar el estado de audio de cada capítulo con la nueva voz seleccionada:
            # si ya existe el caché 1.00x para esta voz en disco, vincularlo; si no, limpiar audio_path
            # para que no se reproduzca el audio de la voz anterior.
            rows = conn.execute(
                "SELECT idx, sentences_json FROM chapters WHERE book_id = ?", (book_id,)
            ).fetchall()
            for row in rows:
                c_idx = row["idx"]
                target_audio = config.AUDIO_DIR / f"{book_id}_c{c_idx}_{voice}_1.00.mp3"
                target_align = config.AUDIO_DIR / f"{book_id}_c{c_idx}_{voice}_1.00.json"
                if target_audio.exists() and target_align.exists():
                    try:
                        sentences_data = json.loads(target_align.read_text(encoding="utf-8"))
                        duration = sentences_data[-1]["end"] if sentences_data else 0.0
                        conn.execute(
                            """
                            UPDATE chapters
                            SET audio_path = ?, alignment_path = ?, duration_seconds = ?, sentences_json = ?
                            WHERE book_id = ? AND idx = ?
                            """,
                            (
                                str(target_audio),
                                str(target_align),
                                duration,
                                json.dumps(sentences_data),
                                book_id,
                                c_idx,
                            ),
                        )
                        continue
                    except (OSError, ValueError, KeyError):
                        pass

                try:
                    raw_sentences = json.loads(row["sentences_json"])
                    reset_sentences = [
                        {"index": s["index"], "text": s["text"], "start": None, "end": None}
                        for s in raw_sentences
                    ]
                    reset_json = json.dumps(reset_sentences)
                except (ValueError, KeyError, TypeError):
                    reset_json = row["sentences_json"]

                conn.execute(
                    """
                    UPDATE chapters
                    SET audio_path = NULL, alignment_path = NULL, duration_seconds = NULL, sentences_json = ?
                    WHERE book_id = ? AND idx = ?
                    """,
                    (reset_json, book_id, c_idx),
                )
        if speed is not None:
            conn.execute("UPDATE books SET speed = ? WHERE id = ?", (speed, book_id))
        conn.commit()


def update_chapter_audio(
    book_id: str,
    chapter_idx: int,
    audio_path: str,
    alignment_path: str,
    duration_seconds: float,
    sentences: List[Dict[str, Any]],
):
    with get_connection() as conn:
        conn.execute(
            """
            UPDATE chapters
            SET audio_path = ?, alignment_path = ?, duration_seconds = ?, sentences_json = ?
            WHERE book_id = ? AND idx = ?
            """,
            (
                audio_path,
                alignment_path,
                duration_seconds,
                json.dumps(sentences),
                book_id,
                chapter_idx,
            ),
        )
        conn.commit()


def delete_book(book_id: str) -> Optional[Dict[str, Any]]:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
        if not row:
            return None
        book_info = dict(row)
        conn.execute("DELETE FROM chapters WHERE book_id = ?", (book_id,))
        conn.execute("DELETE FROM books WHERE id = ?", (book_id,))
        conn.commit()
        return book_info
