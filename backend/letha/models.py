"""
Esquemas Pydantic para la API de Letha.
"""

from __future__ import annotations

from typing import List, Optional
from pydantic import BaseModel, Field


class WordTiming(BaseModel):
    text: str
    start: float
    end: float


class SentenceItem(BaseModel):
    index: int
    text: str
    start: Optional[float] = None
    end: Optional[float] = None
    words: Optional[List[WordTiming]] = None


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
    loaded_parts: int = 0
    total_parts: int = 5
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
    language: str
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


class AppSettings(BaseModel):
    edge_base_speed: float = 0.85
    auto_advance_sentence: bool = True
    auto_advance_page: bool = True
    boundary_type: str = "SentenceBoundary"


class UpdateAppSettingsRequest(BaseModel):
    edge_base_speed: Optional[float] = Field(default=None, ge=0.5, le=1.5)
    auto_advance_sentence: Optional[bool] = None
    auto_advance_page: Optional[bool] = None
    boundary_type: Optional[str] = None


