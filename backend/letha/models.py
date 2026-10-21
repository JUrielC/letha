"""
Esquemas Pydantic para la API de Letha.
"""

from __future__ import annotations

from typing import List, Optional
from pydantic import BaseModel, Field


class SentenceItem(BaseModel):
    index: int
    text: str
    start: Optional[float] = None
    end: Optional[float] = None


class ChapterSummary(BaseModel):
    idx: int
    title: str
    start_page: int
    end_page: int
    has_audio: bool = False
    duration_seconds: Optional[float] = None


class ChapterDetail(BaseModel):
    idx: int
    book_id: str
    title: str
    start_page: int
    end_page: int
    text_content: str
    sentences: List[SentenceItem] = []
    has_audio: bool = False
    duration_seconds: Optional[float] = None


class BookSummary(BaseModel):
    id: str
    title: str
    author: str
    total_pages: int
    total_chapters: int
    cover_url: Optional[str] = None
    current_chapter_idx: int = 0
    current_sentence_idx: int = 0
    voice: str
    speed: float
    created_at: int
    last_read_at: int


class BookDetail(BookSummary):
    chapters: List[ChapterSummary] = []


class UpdateProgressRequest(BaseModel):
    chapter_idx: int
    sentence_idx: int = 0


class UpdateBookSettingsRequest(BaseModel):
    voice: Optional[str] = None
    speed: Optional[float] = None


class SynthesizeRequest(BaseModel):
    voice: Optional[str] = None
    speed: Optional[float] = None


class VoiceItem(BaseModel):
    name: str
    short_name: str
    gender: str
    locale: str
    friendly_name: str
