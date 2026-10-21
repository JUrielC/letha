"""
API REST de Letha con FastAPI.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
import json
import os
import re
import shutil
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from letha import config, database
from letha.config import DEFAULT_SPEED, DEFAULT_VOICE
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

_required_token: Optional[str] = os.environ.get("LETHA_TOKEN") or None
_active_jobs: int = 0
_VOICE_RE = re.compile(r"^[a-zA-Z0-9_-]{3,80}$")


def set_token(token: Optional[str]) -> None:
    """Establece el token de sesión requerido por la aplicación empaquetada."""
    global _required_token
    _required_token = token


def busy() -> bool:
    """Indica si hay alguna tarea de síntesis activa para evitar apagado por inactividad."""
    return _active_jobs > 0


def _validate_voice_name(voice: str) -> str:
    """Valida que el nombre de voz tenga un formato seguro antes de usarlo en nombres de archivo."""
    if not _VOICE_RE.fullmatch(voice):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nombre de voz inválido.",
        )
    return voice


@asynccontextmanager
async def lifespan(app: FastAPI):
    database.init_db()
    yield


app = FastAPI(title="Letha API", version="0.1.0", lifespan=lifespan)

# CORS restringido exclusivamente al entorno de desarrollo local (Next.js en puerto 3000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Letha-Token"],
)


@app.middleware("http")
async def verify_token_middleware(request: Request, call_next):
    if _required_token and request.method != "OPTIONS":
        path = request.url.path
        if path.startswith("/api/") and path != "/api/health":
            header_token = request.headers.get("X-Letha-Token")
            cookie_token = request.cookies.get("letha_token")
            if header_token != _required_token and cookie_token != _required_token:
                return JSONResponse(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    content={"detail": "Token de sesión inválido o ausente."},
                )
    return await call_next(request)


@app.get("/api/health")
def health():
    return {"status": "ok", "app": "letha"}


@app.get("/api/voices", response_model=List[VoiceItem])
async def get_voices():
    voices = await tts_service.list_available_voices()
    return voices


@app.get("/api/voices/preview")
async def preview_voice(voice: str = DEFAULT_VOICE):
    global _active_jobs
    voice = _validate_voice_name(voice)
    preview_file = config.AUDIO_DIR / f"preview_{voice}.mp3"
    preview_align = config.AUDIO_DIR / f"preview_{voice}.json"
    if not preview_file.exists():
        persona = tts_service._extract_persona_name(voice)
        sample_text = (
            f"Hello, I am {persona}. I will read this book for you."
            if voice.lower().startswith("en-")
            else f"Hola, soy {persona}. Te acompañaré en la lectura de este libro."
        )
        _active_jobs += 1
        try:
            await tts_service.synthesize_text_to_audio(
                text=sample_text,
                voice=voice,
                speed=1.0,
                output_audio_path=preview_file,
                output_alignment_path=preview_align,
            )
        finally:
            _active_jobs -= 1
    return FileResponse(preview_file, media_type="audio/mpeg")


@app.get("/api/books", response_model=List[BookSummary])
def get_books():
    return database.list_books()


@app.post("/api/books/upload", response_model=BookDetail)
def upload_book(
    file: UploadFile = File(...),
    voice: Optional[str] = Form(None),
):
    """
    Definida como función síncrona (`def`) para que FastAPI la ejecute en su threadpool
    sin bloquear el event loop mientras PyMuPDF analiza el documento y renderiza la portada.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Solo se admiten archivos PDF.",
        )

    chosen_voice = _validate_voice_name(voice) if voice else DEFAULT_VOICE

    book_id = uuid.uuid4().hex[:12]
    saved_pdf_path = config.BOOKS_DIR / f"{book_id}.pdf"

    with open(saved_pdf_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        book_info, chapters_data = pdf_service.extract_pdf_data(
            saved_pdf_path, config.COVERS_DIR
        )
    except Exception as e:
        if saved_pdf_path.exists():
            saved_pdf_path.unlink()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al procesar el PDF: {str(e)}",
        )

    if not chapters_data:
        if saved_pdf_path.exists():
            saved_pdf_path.unlink()
        cover_file = book_info.get("cover_path")
        if cover_file and Path(cover_file).exists():
            Path(cover_file).unlink()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El PDF no contiene texto extraíble (parece ser un documento escaneado).",
        )

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
        voice=chosen_voice,
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
        row = conn.execute(
            "SELECT cover_path FROM books WHERE id = ?", (book_id,)
        ).fetchone()
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
):
    global _active_jobs
    book = database.get_book(book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Libro no encontrado.")

    chapter = database.get_chapter(book_id, chapter_idx)
    if not chapter:
        raise HTTPException(status_code=404, detail="Capítulo no encontrado.")

    target_voice = _validate_voice_name(voice or book.voice or DEFAULT_VOICE)

    # Siempre sintetizamos a velocidad base 1.0x; el cambio de velocidad se aplica
    # mediante playbackRate en el reproductor HTML5 para evitar duplicar el factor
    # y permitir cambiar la velocidad al instante sin re-sintetizar.
    audio_filename = f"{book_id}_c{chapter_idx}_{target_voice}_1.00.mp3"
    alignment_filename = f"{book_id}_c{chapter_idx}_{target_voice}_1.00.json"

    audio_path = config.AUDIO_DIR / audio_filename
    alignment_path = config.AUDIO_DIR / alignment_filename

    if audio_path.exists() and alignment_path.exists():
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

    _active_jobs += 1
    try:
        duration, sentences_alignment = await tts_service.synthesize_text_to_audio(
            text=chapter.text_content,
            voice=target_voice,
            speed=1.0,
            output_audio_path=audio_path,
            output_alignment_path=alignment_path,
        )
    finally:
        _active_jobs -= 1

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
    validated_voice = _validate_voice_name(payload.voice) if payload.voice is not None else None
    database.update_book_settings(book_id, voice=validated_voice, speed=payload.speed)
    return {"status": "ok"}


@app.delete("/api/books/{book_id}")
def delete_book(book_id: str):
    info = database.delete_book(book_id)
    if not info:
        raise HTTPException(status_code=404, detail="Libro no encontrado.")

    for key in ("file_path", "cover_path"):
        if info.get(key):
            p = Path(info[key])
            if p.exists():
                p.unlink()

    for audio_file in config.AUDIO_DIR.glob(f"{book_id}_*"):
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
