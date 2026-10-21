"""
API REST de Letha con FastAPI.
"""

from __future__ import annotations

import os
import shutil
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, File, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response

from letha import database
from letha.config import AUDIO_DIR, BOOKS_DIR, COVERS_DIR, DEFAULT_SPEED, DEFAULT_VOICE
from letha.models import (
    BookDetail,
    BookSummary,
    ChapterDetail,
    UpdateBookSettingsRequest,
    UpdateProgressRequest,
    VoiceItem,
)
from letha.services import pdf as pdf_service
from letha.services import tts as tts_service

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    database.init_db()
    yield

app = FastAPI(title="Letha API", version="0.1.0", lifespan=lifespan)

# Permitir CORS para desarrollo con Next.js (localhost:3000, 127.0.0.1, etc.)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok", "app": "letha"}


@app.get("/api/voices", response_model=List[VoiceItem])
async def get_voices():
    voices = await tts_service.list_available_voices()
    return voices


@app.get("/api/books", response_model=List[BookSummary])
def get_books():
    return database.list_books()


@app.post("/api/books/upload", response_model=BookDetail)
async def upload_book(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Solo se admiten archivos PDF.",
        )

    book_id = uuid.uuid4().hex[:12]
    saved_pdf_path = BOOKS_DIR / f"{book_id}.pdf"

    # Guardar PDF subido
    with open(saved_pdf_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # Extraer metadatos, portada y capítulos
    try:
        book_info, chapters_data = pdf_service.extract_pdf_data(
            saved_pdf_path, COVERS_DIR
        )
    except Exception as e:
        if saved_pdf_path.exists():
            saved_pdf_path.unlink()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al procesar el PDF: {str(e)}",
        )

    # Si el título extraído no está en los metadatos o es el ID, usar el nombre original del archivo
    orig_name = Path(file.filename or "Libro").stem
    meta_title = book_info.get("title")
    title = orig_name
    if meta_title and meta_title != book_id and meta_title.lower() != "untitled":
        title = meta_title

    database.insert_book(
        book_id=book_id,
        title=title,
        author=book_info["author"],
        file_path=str(saved_pdf_path),
        cover_path=book_info["cover_path"],
        total_pages=book_info["total_pages"],
        chapters_data=chapters_data,
        voice=DEFAULT_VOICE,
        speed=DEFAULT_SPEED,
    )

    detail = database.get_book(book_id)
    if not detail:
        raise HTTPException(status_code=500, detail="No se pudo registrar el libro.")
    return detail


@app.get("/api/books/{book_id}", response_model=BookDetail)
def get_book_detail(book_id: str):
    book = database.get_book(book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Libro no encontrado.")
    return book


@app.get("/api/books/{book_id}/cover")
def get_book_cover(book_id: str):
    book = database.get_book(book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Libro no encontrado.")

    with database.get_connection() as conn:
        row = conn.execute("SELECT cover_path FROM books WHERE id = ?", (book_id,)).fetchone()
        if not row or not row["cover_path"] or not Path(row["cover_path"]).exists():
            raise HTTPException(status_code=404, detail="Portada no disponible.")
        return FileResponse(row["cover_path"], media_type="image/png")


@app.get("/api/books/{book_id}/chapters/{chapter_idx}", response_model=ChapterDetail)
def get_chapter(book_id: str, chapter_idx: int):
    chapter = database.get_chapter(book_id, chapter_idx)
    if not chapter:
        raise HTTPException(status_code=404, detail="Capítulo no encontrado.")
    return chapter


@app.post("/api/books/{book_id}/chapters/{chapter_idx}/synthesize")
async def synthesize_chapter(
    book_id: str,
    chapter_idx: int,
    voice: Optional[str] = None,
    speed: Optional[float] = None,
):
    book = database.get_book(book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Libro no encontrado.")

    chapter = database.get_chapter(book_id, chapter_idx)
    if not chapter:
        raise HTTPException(status_code=404, detail="Capítulo no encontrado.")

    target_voice = voice or book.voice or DEFAULT_VOICE
    target_speed = speed if speed is not None else (book.speed or DEFAULT_SPEED)

    audio_filename = f"{book_id}_c{chapter_idx}_{target_voice}_{target_speed:.2f}.mp3"
    alignment_filename = f"{book_id}_c{chapter_idx}_{target_voice}_{target_speed:.2f}.json"

    audio_path = AUDIO_DIR / audio_filename
    alignment_path = AUDIO_DIR / alignment_filename

    # Si ya existe en caché, reutilizarlo
    if audio_path.exists() and alignment_path.exists():
        import json
        with open(alignment_path, "r", encoding="utf-8") as f:
            sentences_data = json.load(f)
        total_duration = sentences_data[-1]["end"] if sentences_data else 0.0
        database.update_chapter_audio(
            book_id=book_id,
            chapter_idx=chapter_idx,
            audio_path=str(audio_path),
            alignment_path=str(alignment_path),
            duration_seconds=total_duration,
            sentences=sentences_data,
        )
        return {
            "status": "cached",
            "audio_url": f"/api/books/{book_id}/chapters/{chapter_idx}/audio",
            "duration": total_duration,
            "sentences": sentences_data,
        }

    # Si no, sintetizar de nuevo con edge-tts
    duration, sentences_alignment = await tts_service.synthesize_text_to_audio(
        text=chapter.text_content,
        voice=target_voice,
        speed=target_speed,
        output_audio_path=audio_path,
        output_alignment_path=alignment_path,
    )

    database.update_chapter_audio(
        book_id=book_id,
        chapter_idx=chapter_idx,
        audio_path=str(audio_path),
        alignment_path=str(alignment_path),
        duration_seconds=duration,
        sentences=sentences_alignment,
    )

    return {
        "status": "synthesized",
        "audio_url": f"/api/books/{book_id}/chapters/{chapter_idx}/audio",
        "duration": duration,
        "sentences": sentences_alignment,
    }


@app.get("/api/books/{book_id}/chapters/{chapter_idx}/audio")
def get_chapter_audio(book_id: str, chapter_idx: int):
    with database.get_connection() as conn:
        row = conn.execute(
            "SELECT audio_path FROM chapters WHERE book_id = ? AND idx = ?",
            (book_id, chapter_idx),
        ).fetchone()
        if not row or not row["audio_path"] or not Path(row["audio_path"]).exists():
            raise HTTPException(
                status_code=404,
                detail="El audio de este capítulo aún no ha sido sintetizado.",
            )
        return FileResponse(row["audio_path"], media_type="audio/mpeg")


@app.put("/api/books/{book_id}/progress")
def update_progress(book_id: str, payload: UpdateProgressRequest):
    book = database.get_book(book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Libro no encontrado.")
    database.update_progress(book_id, payload.chapter_idx, payload.sentence_idx)
    return {"status": "ok"}


@app.put("/api/books/{book_id}/settings")
def update_settings(book_id: str, payload: UpdateBookSettingsRequest):
    book = database.get_book(book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Libro no encontrado.")
    database.update_book_settings(book_id, voice=payload.voice, speed=payload.speed)
    return {"status": "ok"}


@app.delete("/api/books/{book_id}")
def delete_book(book_id: str):
    info = database.delete_book(book_id)
    if not info:
        raise HTTPException(status_code=404, detail="Libro no encontrado.")

    # Eliminar archivos del disco si existen
    for key in ("file_path", "cover_path"):
        if info.get(key):
            p = Path(info[key])
            if p.exists():
                p.unlink()

    # Eliminar audios generados para este libro
    for audio_file in AUDIO_DIR.glob(f"{book_id}_*"):
        try:
            audio_file.unlink()
        except OSError:
            pass

    return {"status": "ok"}


def run():
    """Ejecutor para pruebas o desarrollo independiente."""
    import uvicorn
    uvicorn.run("letha.api:app", host="127.0.0.1", port=47830, reload=True)


if __name__ == "__main__":
    run()
