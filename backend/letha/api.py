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
    AppSettings,
    BookDetail,
    BookSummary,
    ChapterDetail,
    UpdateAppSettingsRequest,
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


app = FastAPI(title="Letha API", version="0.1.1", lifespan=lifespan)

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


@app.get("/api/settings", response_model=AppSettings)
def get_app_settings():
    return AppSettings(
        edge_base_speed=database.get_edge_base_speed(),
        auto_advance_sentence=database.get_auto_advance_sentence(),
        boundary_type=database.get_boundary_type(),
    )


@app.put("/api/settings", response_model=AppSettings)
def update_app_settings(payload: UpdateAppSettingsRequest):
    speed = (
        database.set_edge_base_speed(payload.edge_base_speed)
        if payload.edge_base_speed is not None
        else database.get_edge_base_speed()
    )
    auto_adv = (
        database.set_auto_advance_sentence(payload.auto_advance_sentence)
        if payload.auto_advance_sentence is not None
        else database.get_auto_advance_sentence()
    )
    b_type = (
        database.set_boundary_type(payload.boundary_type)
        if payload.boundary_type is not None
        else database.get_boundary_type()
    )
    return AppSettings(
        edge_base_speed=speed,
        auto_advance_sentence=auto_adv,
        boundary_type=b_type,
    )


@app.get("/api/voices", response_model=List[VoiceItem])
async def get_voices():
    voices = await tts_service.list_available_voices()
    return voices


@app.get("/api/voices/preview")
async def preview_voice(voice: str = DEFAULT_VOICE):
    global _active_jobs
    voice = _validate_voice_name(voice)
    preview_file = config.AUDIO_DIR / f"preview_{voice}_{tts_service.AUDIO_CACHE_TAG}.mp3"
    preview_align = config.AUDIO_DIR / f"preview_{voice}_{tts_service.AUDIO_CACHE_TAG}.json"
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
def get_chapter(book_id: str, chapter_idx: int, voice: Optional[str] = None):
    validated_voice = _validate_voice_name(voice) if voice else None
    chapter = database.get_chapter(book_id, chapter_idx, voice=validated_voice)
    if not chapter:
        raise HTTPException(status_code=404, detail="Capítulo no encontrado.")
    return chapter


@app.post("/api/books/{book_id}/chapters/{chapter_idx}/synthesize")
async def synthesize_chapter(
    book_id: str,
    chapter_idx: int,
    voice: Optional[str] = None,
    part: Optional[int] = None,
    total_parts: int = tts_service.DEFAULT_PAGE_PARTS,
):
    global _active_jobs
    book = database.get_book(book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Libro no encontrado.")

    target_voice = _validate_voice_name(voice or book.voice or DEFAULT_VOICE)

    chapter = database.get_chapter(book_id, chapter_idx, voice=target_voice)
    if not chapter:
        raise HTTPException(status_code=404, detail="Capítulo no encontrado.")

    if total_parts < 1 or total_parts > 20:
        total_parts = tts_service.DEFAULT_PAGE_PARTS

    # Si no se especifica `part`, se sintetiza hasta el último fragmento (página completa)
    target_part = (total_parts - 1) if part is None else max(0, min(total_parts - 1, part))

    base_texts = pdf_service.split_sentences(chapter.text_content)
    if not base_texts:
        base_texts = [s.text for s in chapter.sentences if s.text]

    # Sintetizamos a velocidad base nativa del 85% en edge-tts (-15%); el cambio de velocidad
    # adicional elegido por el usuario se aplica mediante playbackRate en el reproductor HTML5.
    base_prefix = f"{book_id}_c{chapter_idx}_{target_voice}_{tts_service.AUDIO_CACHE_TAG}"
    audio_path = config.AUDIO_DIR / f"{base_prefix}.mp3"
    alignment_path = config.AUDIO_DIR / f"{base_prefix}.json"
    partial_audio_path = config.AUDIO_DIR / f"{base_prefix}.partial.mp3"

    groups = tts_service.partition_sentence_indices(len(base_texts), total_parts)

    # Si ya existe el archivo final completo para esta voz y coincide el número de oraciones,
    # podemos devolver el estado progresivo (o completo) desde caché sin volver a llamar a edge-tts.
    if audio_path.exists() and alignment_path.exists():
        try:
            cached_sentences = json.loads(alignment_path.read_text(encoding="utf-8"))
            if len(cached_sentences) == len(base_texts) and all(
                isinstance(s.get("start"), (int, float)) for s in cached_sentences
            ):
                total_duration = float(cached_sentences[-1]["end"]) if cached_sentences else 0.0
                database.update_chapter_audio(
                    book_id=book_id,
                    chapter_idx=chapter_idx,
                    audio_path=str(audio_path),
                    alignment_path=str(alignment_path),
                    duration_seconds=total_duration,
                    sentences=cached_sentences,
                )
                return {
                    "status": "cached",
                    "part": total_parts,
                    "total_parts": total_parts,
                    "is_complete": True,
                    "audio_url": f"/api/books/{book_id}/chapters/{chapter_idx}/audio?voice={target_voice}",
                    "duration": total_duration,
                    "sentences": cached_sentences,
                }
        except Exception:
            pass

    _active_jobs += 1
    try:
        for p in range(target_part + 1):
            part_audio_file = config.AUDIO_DIR / f"{base_prefix}.p{p}of{total_parts}.mp3"
            part_meta_file = config.AUDIO_DIR / f"{base_prefix}.p{p}of{total_parts}.json"
            if not (part_audio_file.exists() and part_meta_file.exists()):
                p_indices = groups[p]
                p_texts = [base_texts[i] for i in p_indices]
                p_bytes, p_dur, p_timings = await tts_service.synthesize_sentence_group(
                    p_texts, voice=target_voice, speed=1.0
                )
                part_audio_file.parent.mkdir(parents=True, exist_ok=True)
                part_audio_file.write_bytes(p_bytes)
                part_meta_file.write_text(
                    json.dumps({"duration": p_dur, "timings": p_timings}),
                    encoding="utf-8",
                )
    finally:
        _active_jobs -= 1

    # Ensamblar los fragmentos 0..target_part ya cargados
    combined_audio = bytearray()
    time_offset = 0.0
    progressive_sentences = [
        {"index": i, "text": txt, "start": None, "end": None}
        for i, txt in enumerate(base_texts)
    ]

    for p in range(target_part + 1):
        part_audio_file = config.AUDIO_DIR / f"{base_prefix}.p{p}of{total_parts}.mp3"
        part_meta_file = config.AUDIO_DIR / f"{base_prefix}.p{p}of{total_parts}.json"
        p_bytes = part_audio_file.read_bytes()
        meta = json.loads(part_meta_file.read_text(encoding="utf-8"))
        p_indices = groups[p]
        p_timings = meta.get("timings", [])

        for idx_in_group, sent_idx in enumerate(p_indices):
            if idx_in_group < len(p_timings):
                t_item = p_timings[idx_in_group]
                rel_start, rel_end = t_item[0], t_item[1]
                progressive_sentences[sent_idx]["start"] = round(time_offset + rel_start, 3)
                progressive_sentences[sent_idx]["end"] = round(time_offset + rel_end, 3)
                if len(t_item) > 2 and t_item[2]:
                    progressive_sentences[sent_idx]["words"] = [
                        {
                            "text": w["text"],
                            "start": round(time_offset + w["start"], 3),
                            "end": round(time_offset + w["end"], 3),
                        }
                        for w in t_item[2]
                    ]

        combined_audio.extend(p_bytes)
        time_offset += len(p_bytes) / tts_service.BYTES_PER_SECOND

    total_duration = round(time_offset, 3)
    is_complete = target_part >= total_parts - 1

    if is_complete:
        audio_path.write_bytes(bytes(combined_audio))
        alignment_path.write_text(
            json.dumps(progressive_sentences, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        database.update_chapter_audio(
            book_id=book_id,
            chapter_idx=chapter_idx,
            audio_path=str(audio_path),
            alignment_path=str(alignment_path),
            duration_seconds=total_duration,
            sentences=progressive_sentences,
        )
        # Limpiar archivos parciales temporales
        if partial_audio_path.exists():
            try:
                partial_audio_path.unlink()
            except OSError:
                pass
        for p in range(total_parts):
            for ext in ("mp3", "json"):
                tmp_f = config.AUDIO_DIR / f"{base_prefix}.p{p}of{total_parts}.{ext}"
                if tmp_f.exists():
                    try:
                        tmp_f.unlink()
                    except OSError:
                        pass
    else:
        partial_audio_path.write_bytes(bytes(combined_audio))

    return {
        "status": "synthesized" if is_complete else "partial",
        "part": target_part + 1,
        "total_parts": total_parts,
        "is_complete": is_complete,
        "audio_url": f"/api/books/{book_id}/chapters/{chapter_idx}/audio?voice={target_voice}",
        "duration": total_duration,
        "sentences": progressive_sentences,
    }


@app.get("/api/books/{book_id}/chapters/{chapter_idx}/audio")
def get_chapter_audio(book_id: str, chapter_idx: int, voice: Optional[str] = None):
    book = database.get_book(book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Libro no encontrado.")

    target_voice = _validate_voice_name(voice or book.voice or DEFAULT_VOICE)
    base_prefix = f"{book_id}_c{chapter_idx}_{target_voice}_{tts_service.AUDIO_CACHE_TAG}"
    full_path = config.AUDIO_DIR / f"{base_prefix}.mp3"
    partial_path = config.AUDIO_DIR / f"{base_prefix}.partial.mp3"

    if full_path.exists():
        return FileResponse(
            full_path,
            media_type="audio/mpeg",
            headers={"Cache-Control": "no-store"},
        )
    if partial_path.exists():
        return FileResponse(
            partial_path,
            media_type="audio/mpeg",
            headers={"Cache-Control": "no-store"},
        )

    raise HTTPException(
        status_code=404,
        detail="El audio de este capítulo aún no ha sido sintetizado para la voz seleccionada.",
    )


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
