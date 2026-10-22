"use client";

import React, { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Headphones,
  List,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Settings,
} from "lucide-react";
import {
  api,
  BookDetail,
  ChapterDetail,
  SentenceItem,
  VoiceItem,
  WordTiming,
  getBaseUrl,
} from "@/lib/api";
import { Theme, useTheme } from "@/lib/useTheme";

type FontSize = "sm" | "base" | "lg" | "xl";

const TOTAL_PARTS = 5;

const FONT_LABELS: Record<FontSize, string> = {
  sm: "Pequeño (18 px)",
  base: "Mediano (20 px)",
  lg: "Grande (22 px)",
  xl: "Muy grande (25 px)",
};

const FONT_STYLES: Record<FontSize, React.CSSProperties> = {
  sm: { fontSize: "18px", lineHeight: 1.7 },
  base: { fontSize: "20px", lineHeight: 1.74 },
  lg: { fontSize: "22px", lineHeight: 1.74 },
  xl: { fontSize: "25px", lineHeight: 1.72 },
};

function formatTime(sec: number) {
  if (isNaN(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function extractPersona(friendlyName?: string, shortName?: string): string {
  if (friendlyName) {
    const parts = friendlyName.split(/\s*[-—]\s*/);
    if (parts[0]) return parts[0].trim();
  }
  if (!shortName) return "Narrador";
  const parts = shortName.split("-");
  const last = parts[parts.length - 1] || "";
  return last.replace("Neural", "");
}

function ReaderContent() {
  const searchParams = useSearchParams();
  const bookId = searchParams.get("id") || "";

  const [book, setBook] = useState<BookDetail | null>(null);
  const [chapter, setChapter] = useState<ChapterDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentChapterIdx, setCurrentChapterIdx] = useState<number | null>(null);
  const [voices, setVoices] = useState<VoiceItem[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [loadedParts, setLoadedParts] = useState<number>(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [activeSentenceIdx, setActiveSentenceIdx] = useState<number>(-1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const { theme, setTheme } = useTheme();
  const [fontSize, setFontSize] = useState<FontSize>("base");
  const [isAaOpen, setIsAaOpen] = useState(false);
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [autoAdvanceSentence, setAutoAdvanceSentence] = useState<boolean>(true);
  const [boundaryType, setBoundaryType] = useState<"SentenceBoundary" | "WordBoundary">(
    "SentenceBoundary"
  );
  const [activeWordKey, setActiveWordKey] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sentenceRefs = useRef<{ [key: number]: HTMLSpanElement | null }>({});
  const pendingRestoreRef = useRef<{ chapterIdx: number; sentenceIdx: number } | null>(null);
  const pendingSeekTimeRef = useRef<number | null>(null);
  const resumePlayAfterSwapRef = useRef<boolean>(false);
  const isPlayingRef = useRef<boolean>(false);
  const isInitialLoadRef = useRef<boolean>(true);
  const singleSentenceEndRef = useRef<number | null>(null);

  const aaRef = useRef<HTMLDivElement>(null);
  const tocRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    try {
      const savedFont = (localStorage.getItem("letha_fontsize") as FontSize) || "base";
      setFontSize(savedFont);
    } catch {}

    api.getVoices().then(setVoices).catch(console.error);
    api
      .getAppSettings()
      .then((s) => {
        setAutoAdvanceSentence(s.auto_advance_sentence ?? true);
        setBoundaryType(
          s.boundary_type === "WordBoundary" ? "WordBoundary" : "SentenceBoundary"
        );
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!isAaOpen && !isTocOpen) return;
    const handleDown = (e: MouseEvent) => {
      if (isAaOpen && aaRef.current && !aaRef.current.contains(e.target as Node)) {
        setIsAaOpen(false);
      }
      if (isTocOpen && tocRef.current && !tocRef.current.contains(e.target as Node)) {
        setIsTocOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsAaOpen(false);
        setIsTocOpen(false);
      }
    };
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [isAaOpen, isTocOpen]);

  useEffect(() => {
    if (!bookId) return;
    let ignore = false;
    isInitialLoadRef.current = true;
    setLoadError(null);

    api
      .getBook(bookId)
      .then((b) => {
        if (ignore) return;
        setBook(b);
        if (b.total_chapters === 0) {
          setLoadError(
            "Este documento no contiene texto extraíble (parece ser un PDF escaneado)."
          );
          return;
        }
        const targetChapter = b.current_chapter_idx ?? 0;
        pendingRestoreRef.current = {
          chapterIdx: targetChapter,
          sentenceIdx: b.current_sentence_idx || 0,
        };
        if (b.speed) setPlaybackSpeed(b.speed);
        setSelectedVoice(b.voice || "es-MX-DaliaNeural");
        setCurrentChapterIdx(targetChapter);
      })
      .catch((err: any) => {
        if (ignore) return;
        setLoadError(err.message || "No se pudo cargar el libro.");
      });

    return () => {
      ignore = true;
    };
  }, [bookId]);
  useEffect(() => {
    if (!bookId || currentChapterIdx === null || !selectedVoice) return;
    let ignore = false;
    const controller = new AbortController();
    const chapterIdx = currentChapterIdx;
    const voice = selectedVoice;

    if (audioRef.current) {
      audioRef.current.pause();
    }
    setIsPlaying(false);
    isPlayingRef.current = false;
    setCurrentTime(0);
    pendingSeekTimeRef.current = null;
    resumePlayAfterSwapRef.current = false;
    setLoadError(null);

    let restoredSentence = -1;
    if (pendingRestoreRef.current?.chapterIdx === chapterIdx) {
      restoredSentence = pendingRestoreRef.current.sentenceIdx;
      pendingRestoreRef.current = null;
    }

    setActiveSentenceIdx(restoredSentence >= 0 ? restoredSentence : -1);

    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
    } else {
      api.updateProgress(bookId, chapterIdx, 0).catch(console.error);
    }

    const loadAndSynthesizeInParts = async () => {
      try {
        const c = await api.getChapter(bookId, chapterIdx, voice);
        if (ignore) return;
        setChapter(c);

        if (restoredSentence > 0 && restoredSentence < c.sentences.length) {
          const targetSentence = c.sentences[restoredSentence];
          if (typeof targetSentence?.start === "number") {
            pendingSeekTimeRef.current = targetSentence.start;
            setCurrentTime(targetSentence.start);
          }
          setTimeout(() => {
            if (ignore) return;
            sentenceRefs.current[restoredSentence]?.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
          }, 120);
        }

        const base = getBaseUrl();

        const preloadNextPageFirstPart = () => {
          if (ignore) return;
          const nextIdx = chapterIdx + 1;
          if (!book || nextIdx < book.total_chapters) {
            api
              .synthesizeChapter(
                bookId,
                nextIdx,
                voice,
                0,
                TOTAL_PARTS,
                controller.signal
              )
              .catch(() => {});
          }
        };

        if (c.has_audio) {
          setLoadedParts(TOTAL_PARTS);
          setIsSynthesizing(false);
          setAudioUrl(
            `${base}/api/books/${bookId}/chapters/${chapterIdx}/audio?voice=${encodeURIComponent(
              voice
            )}&t=${Date.now()}`
          );
          preloadNextPageFirstPart();
          return;
        }

        const startPart = Math.min(TOTAL_PARTS, Math.max(0, c.loaded_parts || 0));
        setLoadedParts(startPart);
        setIsSynthesizing(true);

        if (startPart > 0) {
          setAudioUrl(
            `${base}/api/books/${bookId}/chapters/${chapterIdx}/audio?voice=${encodeURIComponent(
              voice
            )}&part=${startPart}&t=${Date.now()}`
          );
        } else {
          setAudioUrl(null);
        }

        for (let p = startPart; p < TOTAL_PARTS; p++) {
          if (ignore) return;

          const res = await api.synthesizeChapter(
            bookId,
            chapterIdx,
            voice,
            p,
            TOTAL_PARTS,
            controller.signal
          );
          if (ignore) return;

          setLoadedParts(res.part);
          setChapter((prev) =>
            prev && prev.idx === chapterIdx
              ? {
                  ...prev,
                  has_audio: res.is_complete,
                  loaded_parts: res.part,
                  duration_seconds: res.duration,
                  sentences: res.sentences,
                }
              : prev
          );

          if (
            restoredSentence > 0 &&
            restoredSentence < res.sentences.length &&
            typeof res.sentences[restoredSentence]?.start === "number" &&
            !isPlayingRef.current &&
            currentTime === 0
          ) {
            const targetStart = res.sentences[restoredSentence].start as number;
            pendingSeekTimeRef.current = targetStart;
            setCurrentTime(targetStart);
          }

          const nextAudioUrl = `${base}${res.audio_url}&part=${res.part}&t=${Date.now()}`;

          if (p === 0 && startPart === 0) {
            setAudioUrl(nextAudioUrl);
          } else if (res.is_complete || !isPlayingRef.current) {
            if (isPlayingRef.current && audioRef.current) {
              pendingSeekTimeRef.current = audioRef.current.currentTime;
              resumePlayAfterSwapRef.current = true;
            }
            setAudioUrl(nextAudioUrl);
          }

          if (res.is_complete) {
            setBook((prev) =>
              prev
                ? {
                    ...prev,
                    chapters: prev.chapters.map((ch) =>
                      ch.idx === chapterIdx
                        ? { ...ch, has_audio: true, duration_seconds: res.duration }
                        : ch
                    ),
                  }
                : prev
            );
            preloadNextPageFirstPart();
            break;
          }
        }
      } catch (err: any) {
        if (ignore || err?.name === "AbortError") return;
        console.error(err);
      } finally {
        if (!ignore) {
          setIsSynthesizing(false);
        }
      }
    };

    loadAndSynthesizeInParts();

    return () => {
      ignore = true;
      controller.abort();
    };
  }, [bookId, currentChapterIdx, selectedVoice]);

  useEffect(() => {
    if (!isPlaying) return;
    if (autoAdvanceSentence && singleSentenceEndRef.current === null) return;

    const checkBoundary = () => {
      const audio = audioRef.current;
      if (!audio) return;
      const stopEnd =
        singleSentenceEndRef.current ??
        (!autoAdvanceSentence && activeSentenceIdx >= 0
          ? chapter?.sentences[activeSentenceIdx]?.end ?? null
          : null);
      if (typeof stopEnd === "number" && audio.currentTime >= stopEnd - 0.02) {
        audio.pause();
        setIsPlaying(false);
        singleSentenceEndRef.current = null;
      }
    };

    const timer = window.setInterval(checkBoundary, 20);
    return () => window.clearInterval(timer);
  }, [isPlaying, autoAdvanceSentence, activeSentenceIdx, chapter]);

  useEffect(() => {
    if (
      !chapter?.sentences ||
      chapter.sentences.length === 0 ||
      currentChapterIdx === null ||
      chapter.idx !== currentChapterIdx ||
      pendingSeekTimeRef.current !== null
    ) {
      return;
    }
    if (!isPlaying && currentTime === 0 && activeSentenceIdx > 0) {
      return;
    }
    if (!autoAdvanceSentence && singleSentenceEndRef.current !== null) {
      return;
    }

    const idx = chapter.sentences.findIndex(
      (s) =>
        typeof s.start === "number" &&
        typeof s.end === "number" &&
        currentTime >= s.start &&
        currentTime < s.end
    );

    if (idx !== -1 && idx !== activeSentenceIdx) {
      setActiveSentenceIdx(idx);
      if (bookId) {
        api.updateProgress(bookId, currentChapterIdx, idx).catch(console.error);
      }

      const elem = sentenceRefs.current[idx];
      if (elem) {
        elem.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [
    currentTime,
    chapter,
    activeSentenceIdx,
    isPlaying,
    bookId,
    currentChapterIdx,
    autoAdvanceSentence,
  ]);

  const handleSentenceClick = (sentence: SentenceItem, sIdx: number) => {
    setActiveSentenceIdx(sIdx);
    setActiveWordKey(null);
    if (bookId && currentChapterIdx !== null) {
      api.updateProgress(bookId, currentChapterIdx, sIdx).catch(console.error);
    }

    if (typeof sentence.start === "number" && audioRef.current) {
      singleSentenceEndRef.current =
        !autoAdvanceSentence && typeof sentence.end === "number"
          ? sentence.end
          : null;
      audioRef.current.currentTime = sentence.start;
      setCurrentTime(sentence.start);
      audioRef.current.play().catch(console.error);
      setIsPlaying(true);
    }
  };

  const handleWordClick = (
    sentence: SentenceItem,
    sIdx: number,
    word: WordTiming,
    wIdx: number,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    setActiveSentenceIdx(sIdx);
    setActiveWordKey(`${sIdx}:${wIdx}`);
    if (bookId && currentChapterIdx !== null) {
      api.updateProgress(bookId, currentChapterIdx, sIdx).catch(console.error);
    }

    if (audioRef.current) {
      const startSec = Math.max(0, word.start - 0.02);
      singleSentenceEndRef.current = word.end + 0.04;
      audioRef.current.currentTime = startSec;
      setCurrentTime(startSec);
      audioRef.current.play().catch(console.error);
      setIsPlaying(true);
    }
  };

  const renderSentenceContent = (s: SentenceItem, sentIdx: number) => {
    if (boundaryType !== "WordBoundary" || !s.words || s.words.length === 0) {
      return <>{s.text} </>;
    }

    const parts = s.text.split(/([A-Za-zÀ-ÖØ-öø-ÿ0-9'’]+)/);
    let wCursor = 0;
    const norm = (val: string) => val.toLowerCase().replace(/[^a-z0-9]/g, "");

    return (
      <>
        {parts.map((part, pIdx) => {
          if (pIdx % 2 === 0 || !norm(part)) {
            return <React.Fragment key={pIdx}>{part}</React.Fragment>;
          }

          let matchedIdx = -1;
          const nt = norm(part);
          for (let k = 0; k < Math.min(3, s.words!.length - wCursor); k++) {
            const nw = norm(s.words![wCursor + k].text);
            if (nw === nt || (nw && nt && (nw.includes(nt) || nt.includes(nw)))) {
              matchedIdx = wCursor + k;
              wCursor = matchedIdx + 1;
              break;
            }
          }
          if (matchedIdx === -1 && wCursor < s.words!.length) {
            matchedIdx = wCursor++;
          }

          if (matchedIdx === -1) {
            return <React.Fragment key={pIdx}>{part}</React.Fragment>;
          }

          const wordTiming = s.words![matchedIdx];
          const wordKey = `${sentIdx}:${matchedIdx}`;
          const isWordPlayingNow =
            isPlaying &&
            sentIdx === activeSentenceIdx &&
            currentTime >= wordTiming.start - 0.03 &&
            currentTime <= wordTiming.end + 0.04;
          const isWordSelected = activeWordKey === wordKey || isWordPlayingNow;

          return (
            <span
              key={pIdx}
              onClick={(e) => handleWordClick(s, sentIdx, wordTiming, matchedIdx, e)}
              className={`word-item cursor-pointer transition ${
                isWordSelected ? "word-active" : ""
              }`}
              title={`Escuchar "${wordTiming.text}" (${wordTiming.start.toFixed(2)}s)`}
            >
              {part}
            </span>
          );
        })}{" "}
      </>
    );
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      singleSentenceEndRef.current = null;
    } else {
      if (!autoAdvanceSentence && chapter?.sentences?.length) {
        const targetIdx = activeSentenceIdx >= 0 ? activeSentenceIdx : 0;
        const targetSentence = chapter.sentences[targetIdx];
        if (
          targetSentence &&
          typeof targetSentence.start === "number" &&
          typeof targetSentence.end === "number"
        ) {
          if (activeSentenceIdx < 0) {
            setActiveSentenceIdx(0);
          }
          if (
            audioRef.current.currentTime < targetSentence.start ||
            audioRef.current.currentTime >= targetSentence.end - 0.05
          ) {
            audioRef.current.currentTime = targetSentence.start;
            setCurrentTime(targetSentence.start);
          }
          singleSentenceEndRef.current = targetSentence.end;
        }
      } else {
        singleSentenceEndRef.current = null;
      }
      audioRef.current.play().catch(console.error);
      setIsPlaying(true);
    }
  };

  const seekRelative = (seconds: number) => {
    if (!audioRef.current) return;
    const nextTime = Math.max(
      0,
      Math.min(duration, audioRef.current.currentTime + seconds)
    );
    audioRef.current.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const bookVoices = book
    ? voices.filter(
        (v) =>
          v.locale.toLowerCase().startsWith(`${book.language}-`) ||
          v.short_name === selectedVoice
      )
    : [];

  const handleVoiceChange = async (newVoice: string) => {
    if (newVoice === selectedVoice) return;
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setIsPlaying(false);
    setAudioUrl(null);
    setChapter((prev) =>
      prev
        ? {
            ...prev,
            has_audio: false,
            sentences: prev.sentences.map((s) => ({ ...s, start: null, end: null })),
          }
        : null
    );
    setSelectedVoice(newVoice);
    if (bookId) {
      await api.updateSettings(bookId, newVoice, playbackSpeed).catch(console.error);
    }
  };

  const handleSpeedChange = async (newSpeed: number) => {
    setPlaybackSpeed(newSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = newSpeed;
    }
    if (bookId && selectedVoice) {
      await api.updateSettings(bookId, selectedVoice, newSpeed).catch(console.error);
    }
  };

  const stepFontSize = (delta: number) => {
    const order: FontSize[] = ["sm", "base", "lg", "xl"];
    const curIdx = order.indexOf(fontSize);
    const nextIdx = Math.max(0, Math.min(order.length - 1, curIdx + delta));
    const next = order[nextIdx];
    setFontSize(next);
    try {
      localStorage.setItem("letha_fontsize", next);
    } catch {}
  };

  const matchedVoice = voices.find((v) => v.short_name === selectedVoice);
  const personaName = extractPersona(matchedVoice?.friendly_name, selectedVoice || undefined);

  const bookProgressPct =
    book && book.total_chapters > 0 && currentChapterIdx !== null
      ? Math.min(100, Math.round(((currentChapterIdx + 1) / book.total_chapters) * 100))
      : 0;
  return (
    <div className="min-h-screen flex flex-col pb-36">
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onTimeUpdate={() => {
            if (audioRef.current) {
              setCurrentTime(audioRef.current.currentTime);
            }
          }}
          onLoadedMetadata={() => {
            if (audioRef.current) {
              setDuration(audioRef.current.duration);
              audioRef.current.playbackRate = playbackSpeed;
              if (pendingSeekTimeRef.current !== null) {
                audioRef.current.currentTime = pendingSeekTimeRef.current;
                setCurrentTime(pendingSeekTimeRef.current);
                pendingSeekTimeRef.current = null;
              }
              if (resumePlayAfterSwapRef.current) {
                resumePlayAfterSwapRef.current = false;
                audioRef.current.play().catch(console.error);
                setIsPlaying(true);
              }
            }
          }}
          onEnded={() => {
            setIsPlaying(false);
          }}
        />
      )}

      {/* Barra superior de lectura */}
      <div className="sticky top-0 z-30 p-4 pb-0 pointer-events-none">
        <header
          className="glass pointer-events-auto max-w-[1180px] mx-auto rounded-[22px] px-2.5 pt-0 pb-2 relative"
          style={{
            background: "var(--glass-bar)",
            boxShadow: "var(--ring-bar)",
          }}
        >
          <div className="h-14 flex items-center justify-between gap-2">
            <div className="flex-1 min-w-0 flex items-center gap-1">
              <Link
                href="/"
                className="quiet inline-flex items-center gap-1.5 h-10 px-3 pl-2 rounded-full text-sm no-underline"
                style={{ color: "var(--muted)" }}
              >
                <ChevronLeft className="w-[18px] h-[18px]" strokeWidth={1.6} />
                <span>Biblioteca</span>
              </Link>
              <button
                type="button"
                onClick={() => {
                  setIsTocOpen((prev) => !prev);
                  setIsAaOpen(false);
                }}
                aria-expanded={isTocOpen}
                className="quiet inline-flex items-center gap-2 h-10 px-3.5 pl-2.5 rounded-full border-0 text-sm cursor-pointer"
                style={{
                  background: isTocOpen ? "var(--hover)" : "transparent",
                  color: "var(--ink)",
                }}
              >
                <List className="w-[18px] h-[18px]" strokeWidth={1.6} />
                <span>Índice</span>
              </button>
            </div>

            <div className="flex-initial min-w-0 text-center px-2">
              <p className="m-0 text-sm font-medium truncate max-w-sm" style={{ color: "var(--ink)" }}>
                {book?.title || "Cargando..."}
              </p>
              <p className="m-0 text-xs tabular-nums truncate" style={{ color: "var(--muted)" }}>
                Pág. {currentChapterIdx !== null ? currentChapterIdx + 1 : 1} de{" "}
                {book?.total_chapters || 1}
                {chapter?.title ? ` · ${chapter.title}` : ""}
              </p>
            </div>

            <div className="flex-1 min-w-0 flex items-center justify-end gap-1">
              <button
                type="button"
                onClick={() => {
                  setIsAaOpen((prev) => !prev);
                  setIsTocOpen(false);
                }}
                aria-expanded={isAaOpen}
                aria-label="Apariencia del texto"
                className="quiet inline-flex items-center justify-center h-10 min-w-[48px] px-3 rounded-full border-0 font-serif text-[17px] cursor-pointer"
                style={{
                  background: isAaOpen ? "var(--hover)" : "transparent",
                  color: "var(--ink)",
                }}
              >
                Aa
              </button>

              <Link
                href={`/settings?bookId=${bookId}`}
                aria-label="Configuración"
                className="quiet inline-flex items-center justify-center w-10 h-10 rounded-full no-underline"
                style={{ color: "var(--muted)" }}
              >
                <Settings className="w-[18px] h-[18px]" strokeWidth={1.6} />
              </Link>
            </div>
          </div>

          <div
            role="progressbar"
            aria-label="Progreso en el libro"
            aria-valuenow={bookProgressPct}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-[2px] mx-4 rounded-full overflow-hidden"
            style={{ background: "var(--track)" }}
          >
            <div
              className="h-full transition-all duration-300"
              style={{ width: `${bookProgressPct}%`, background: "var(--fill)" }}
            />
          </div>
        </header>
      </div>

      {/* Popover Aa */}
      {isAaOpen && (
        <div
          ref={aaRef}
          role="dialog"
          aria-label="Apariencia del texto"
          className="glass-strong fixed z-40 top-20 right-8 w-80 max-w-[calc(100%-48px)] p-[18px] rounded-[24px] box-border flex flex-col gap-4"
          style={{
            background: "var(--glass-menu)",
            boxShadow: "var(--ring-menu)",
          }}
        >
          <div>
            <p className="m-0 mb-2.5 text-[13px] font-medium" style={{ color: "var(--muted)" }}>
              Tema
            </p>
            <div className="grid grid-cols-3 gap-2">
              {[
                {
                  id: "light" as Theme,
                  label: "Claro",
                  bg: "radial-gradient(60px 50px at 20% 20%, rgba(196, 128, 124, 0.5), rgba(196, 128, 124, 0)), radial-gradient(60px 50px at 90% 80%, rgba(150, 180, 205, 0.6), rgba(150, 180, 205, 0)), #f2efee",
                  ink: "#1f2227",
                },
                {
                  id: "sepia" as Theme,
                  label: "Sepia",
                  bg: "radial-gradient(60px 50px at 20% 20%, rgba(205, 150, 105, 0.5), rgba(205, 150, 105, 0)), #f4eadc",
                  ink: "#3a2f24",
                },
                {
                  id: "dark" as Theme,
                  label: "Oscuro",
                  bg: "radial-gradient(60px 50px at 20% 20%, rgba(138, 72, 78, 0.6), rgba(138, 72, 78, 0)), radial-gradient(60px 50px at 90% 80%, rgba(60, 92, 122, 0.6), rgba(60, 92, 122, 0)), #1a1b1f",
                  ink: "#ebe9e4",
                },
              ].map((t) => {
                const isActive = theme === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTheme(t.id)}
                    aria-pressed={isActive}
                    className="p-0 border-0 bg-transparent cursor-pointer flex flex-col gap-1.5 items-stretch"
                  >
                    <span
                      className="h-14 rounded-2xl flex items-center justify-center font-serif text-xl"
                      style={{
                        background: t.bg,
                        color: t.ink,
                        boxShadow: isActive
                          ? "inset 0 0 0 2px var(--ink)"
                          : "inset 0 0 0 1px var(--track)",
                      }}
                    >
                      Aa
                    </span>
                    <span className="text-[13px] text-center" style={{ color: "var(--ink)" }}>
                      {t.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="m-0 mb-2.5 text-[13px] font-medium" style={{ color: "var(--muted)" }}>
              Tamaño del texto
            </p>
            <div
              className="flex items-center gap-2 p-1 rounded-full"
              style={{ background: "var(--glass-seg)" }}
            >
              <button
                type="button"
                onClick={() => stepFontSize(-1)}
                aria-label="Texto más pequeño"
                className="quiet w-11 h-9 rounded-full border-0 font-serif text-sm cursor-pointer"
                style={{ color: "var(--ink)" }}
              >
                A−
              </button>
              <span className="flex-1 text-center text-[13px] font-medium tabular-nums" style={{ color: "var(--ink)" }}>
                {FONT_LABELS[fontSize]}
              </span>
              <button
                type="button"
                onClick={() => stepFontSize(1)}
                aria-label="Texto más grande"
                className="quiet w-11 h-9 rounded-full border-0 font-serif text-lg cursor-pointer"
                style={{ color: "var(--ink)" }}
              >
                A+
              </button>
            </div>
          </div>

          <Link
            href={`/settings?bookId=${bookId}`}
            onClick={() => setIsAaOpen(false)}
            className="text-[13px] underline underline-offset-4 decoration-[var(--dash)] hover:opacity-80 pt-1"
            style={{ color: "var(--ink)" }}
          >
            Modo de lectura y velocidad en Configuración
          </Link>
        </div>
      )}

      {/* Popover Índice */}
      {isTocOpen && (
        <nav
          ref={tocRef}
          aria-label="Índice del libro"
          className="glass-strong fixed z-40 top-20 left-8 w-[340px] max-w-[calc(100%-48px)] p-2.5 rounded-[24px] box-border max-h-[75vh] flex flex-col shadow-2xl"
          style={{
            background: "var(--glass-menu)",
            boxShadow: "var(--ring-menu)",
          }}
        >
          <div className="flex items-center justify-between p-2 pb-2.5">
            <h2 className="m-0 text-[15px] font-semibold" style={{ color: "var(--ink)" }}>
              Índice
            </h2>
            <span className="text-xs tabular-nums" style={{ color: "var(--muted)" }}>
              {book?.total_chapters || 0} págs.
            </span>
          </div>

          <div className="overflow-y-auto flex-1 space-y-1 pr-1">
            {book?.chapters.map((c) => {
              const isCurrent = c.idx === currentChapterIdx;
              return (
                <button
                  key={c.idx}
                  type="button"
                  onClick={() => {
                    setCurrentChapterIdx(c.idx);
                    setIsTocOpen(false);
                  }}
                  className="w-full min-h-[44px] flex items-center gap-2.5 px-3 py-2 border-0 rounded-2xl text-left cursor-pointer transition text-sm"
                  style={{
                    background: isCurrent ? "var(--hl)" : "transparent",
                    color: isCurrent ? "var(--hl-ink)" : "var(--ink)",
                    fontWeight: isCurrent ? 600 : 400,
                  }}
                >
                  <span className="flex-1 truncate">{c.title}</span>
                  {c.has_audio && (
                    <Headphones className="w-3.5 h-3.5 shrink-0 opacity-70" />
                  )}
                </button>
              );
            })}
          </div>
        </nav>
      )}

      {/* Hoja de lectura */}
      <main className="flex-1 w-full mx-auto px-5 py-9 flex flex-col items-center box-border">
        {loadError ? (
          <div className="glass-strong max-w-md p-8 rounded-[30px] flex flex-col items-center justify-center text-center gap-4 my-16" style={{ background: "var(--glass-sheet)", boxShadow: "var(--shadow-sheet)" }}>
            <p className="text-sm font-medium" style={{ color: "var(--danger)" }}>
              {loadError}
            </p>
            <Link
              href="/"
              className="glbtn inline-flex items-center h-10 px-5 rounded-full text-xs font-semibold no-underline"
              style={{
                background: "var(--btn-primary)",
                color: "var(--btn-primary-ink)",
                boxShadow: "var(--ring-primary)",
              }}
            >
              Volver a la biblioteca
            </Link>
          </div>
        ) : !chapter ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3" style={{ color: "var(--muted)" }}>
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--muted)" }} />
            <span className="text-sm">Cargando capítulo...</span>
          </div>
        ) : (
          <div
            className="glass-strong w-full max-w-[800px] rounded-[34px] px-[clamp(22px,6vw,76px)] pt-[60px] pb-[72px] box-border"
            style={{
              background: "var(--glass-sheet)",
              boxShadow: "var(--shadow-sheet)",
            }}
          >
            <article
              className="font-serif max-w-[33em] mx-auto text-left hyphens-auto select-text"
              style={FONT_STYLES[fontSize]}
            >
              <header className="mb-9 pb-4">
                <p className="m-0 font-sans text-[13px] tabular-nums" style={{ color: "var(--muted)" }}>
                  Páginas {chapter.start_page} – {chapter.end_page}
                </p>
                <h1 className="m-0 mt-1.5 font-serif text-[38px] leading-[1.15] font-normal tracking-[-0.012em]" style={{ color: "var(--ink)" }}>
                  {chapter.title}
                </h1>
              </header>

              <div className="space-y-4">
                {chapter.sentences.map((s, idx) => {
                  const isActive = idx === activeSentenceIdx;
                  const isVoiceReady =
                    typeof s.start === "number" && typeof s.end === "number";
                  return (
                    <span
                      key={idx}
                      ref={(el) => {
                        sentenceRefs.current[idx] = el;
                      }}
                      onClick={() => handleSentenceClick(s, idx)}
                      className={`sentence-item inline ${
                        isActive
                          ? "sentence-active-light opacity-100 cursor-pointer"
                          : isVoiceReady
                          ? "sentence-ready opacity-100 cursor-pointer"
                          : "opacity-35 cursor-wait"
                      }`}
                      title={
                        isVoiceReady
                          ? boundaryType === "WordBoundary"
                            ? "Haz clic en una palabra para escucharla o en la frase"
                            : `Escuchar desde ${(s.start as number).toFixed(1)}s`
                          : "Cargando voz para este fragmento..."
                      }
                    >
                      {renderSentenceContent(s, idx)}
                    </span>
                  );
                })}
              </div>
            </article>
          </div>
        )}
      </main>

      {/* Reproductor fijo abajo */}
      <footer className="fixed bottom-5 left-0 right-0 z-30 px-4 pointer-events-none flex justify-center">
        <div
          className="glass-strong pointer-events-auto w-full max-w-[760px] rounded-[30px] p-[10px] pl-2.5 pr-3.5 flex flex-wrap items-center gap-3"
          style={{
            background: "var(--glass-dock)",
            boxShadow: "var(--shadow-dock)",
            color: "var(--ink)",
          }}
        >
          {/* 1. Selector de Voz chip */}
          <div className="relative shrink-0">
            <div className="quiet inline-flex items-center gap-2 h-11 px-2.5 pl-1.5 rounded-full cursor-pointer pointer-events-none select-none">
              <span
                className="w-8 h-8 rounded-full flex items-center justify-center font-semibold text-[13px]"
                style={{ background: "var(--icon-chip)", color: "var(--ink)" }}
              >
                {personaName.charAt(0).toUpperCase()}
              </span>
              <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                {personaName}
              </span>
              <ChevronDown className="w-3.5 h-3.5 opacity-60" style={{ color: "var(--ink)" }} />
            </div>
            <select
              value={selectedVoice || "es-MX-DaliaNeural"}
              onChange={(e) => handleVoiceChange(e.target.value)}
              aria-label={`Narrador: ${personaName}. Cambiar narrador`}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            >
              {bookVoices.map((v) => (
                <option
                  key={v.short_name}
                  value={v.short_name}
                  className="bg-white text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  {v.friendly_name}
                </option>
              ))}
            </select>
          </div>

          {/* 2. Controles de transporte */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              disabled={currentChapterIdx === null || currentChapterIdx <= 0}
              onClick={() =>
                currentChapterIdx !== null && setCurrentChapterIdx(currentChapterIdx - 1)
              }
              aria-label="Página anterior"
              className="quiet w-11 h-11 rounded-full flex items-center justify-center border-0 disabled:opacity-30 cursor-pointer transition"
              style={{ color: "var(--ink)" }}
            >
              <ChevronLeft className="w-5 h-5" strokeWidth={1.7} />
            </button>

            <button
              type="button"
              disabled={!audioUrl}
              onClick={() => seekRelative(-10)}
              aria-label="Retroceder 10 segundos"
              className="quiet w-11 h-11 rounded-full flex items-center justify-center border-0 disabled:opacity-30 cursor-pointer transition relative"
              style={{ color: "var(--ink)" }}
            >
              <RotateCcw className="w-[22px] h-[22px]" strokeWidth={1.5} />
              <span className="absolute inset-0 flex items-center justify-center text-[7.5px] font-semibold font-sans pt-0.5 pointer-events-none tabular-nums">
                10
              </span>
            </button>

            <button
              type="button"
              disabled={!audioUrl}
              onClick={togglePlay}
              aria-label={isPlaying ? "Pausar" : "Reproducir"}
              className="w-[52px] h-[52px] rounded-full border-0 flex items-center justify-center cursor-pointer transition active:scale-95 disabled:opacity-40"
              style={{
                background: "var(--btn-primary)",
                boxShadow: "var(--ring-primary)",
                color: "var(--btn-primary-ink)",
              }}
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 fill-current" />
              ) : (
                <Play className="w-5 h-5 fill-current ml-0.5" />
              )}
            </button>

            <button
              type="button"
              disabled={!audioUrl}
              onClick={() => seekRelative(10)}
              aria-label="Adelantar 10 segundos"
              className="quiet w-11 h-11 rounded-full flex items-center justify-center border-0 disabled:opacity-30 cursor-pointer transition relative"
              style={{ color: "var(--ink)" }}
            >
              <RotateCw className="w-[22px] h-[22px]" strokeWidth={1.5} />
              <span className="absolute inset-0 flex items-center justify-center text-[7.5px] font-semibold font-sans pt-0.5 pointer-events-none tabular-nums">
                10
              </span>
            </button>

            <button
              type="button"
              disabled={
                !book ||
                currentChapterIdx === null ||
                currentChapterIdx + 1 >= book.total_chapters
              }
              onClick={() =>
                currentChapterIdx !== null && setCurrentChapterIdx(currentChapterIdx + 1)
              }
              aria-label="Siguiente página"
              className="quiet w-11 h-11 rounded-full flex items-center justify-center border-0 disabled:opacity-30 cursor-pointer transition"
              style={{ color: "var(--ink)" }}
            >
              <ChevronRight className="w-5 h-5" strokeWidth={1.7} />
            </button>
          </div>

          {/* 3. Línea de tiempo con 5 segmentos */}
          <div className="flex-1 min-w-[200px] flex flex-col gap-1.5 px-1">
            {!audioUrl && isSynthesizing ? (
              <div className="flex items-center justify-center gap-2 py-1 text-xs font-medium" style={{ color: "var(--muted)" }}>
                <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--muted)" }} />
                <span>
                  Cargando voz del fragmento {Math.max(1, loadedParts)} de {TOTAL_PARTS}...
                </span>
              </div>
            ) : (
              <>
                <div className="relative w-full py-1">
                  <div className="flex gap-[3px] h-1 w-full pointer-events-none" aria-hidden="true">
                    {[0, 1, 2, 3, 4].map((k) => {
                      const partDur = duration > 0 ? duration / TOTAL_PARTS : 1;
                      const a = k * partDur;
                      const b = (k + 1) * partDur;
                      const fill =
                        duration > 0
                          ? currentTime >= b
                            ? 100
                            : currentTime <= a
                            ? 0
                            : ((currentTime - a) / (b - a)) * 100
                          : 0;
                      const isOk = k < loadedParts;
                      return (
                        <span
                          key={k}
                          className="relative flex-1 h-1 rounded-full overflow-hidden block box-border"
                          style={{
                            background: isOk ? "var(--track)" : "transparent",
                            border: isOk ? "0" : "1px dashed var(--dash)",
                          }}
                        >
                          <span
                            className="block h-full rounded-full transition-all duration-150"
                            style={{
                              width: `${fill.toFixed(1)}%`,
                              background: "var(--fill)",
                            }}
                          />
                        </span>
                      );
                    })}
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={duration || 100}
                    step={0.1}
                    value={currentTime}
                    disabled={!audioUrl}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setCurrentTime(val);
                      if (audioRef.current) audioRef.current.currentTime = val;
                    }}
                    aria-label="Posición de reproducción"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed m-0 p-0"
                  />
                </div>

                <div
                  className="flex justify-between items-center gap-2 text-xs tabular-nums select-none"
                  style={{ color: "var(--muted)" }}
                >
                  <span>{formatTime(currentTime)}</span>
                  <span>
                    {isSynthesizing && loadedParts < TOTAL_PARTS
                      ? `Preparando la voz · parte ${Math.max(1, loadedParts)} de ${TOTAL_PARTS}`
                      : "Voz lista"}
                  </span>
                  <span>{formatTime(duration)}</span>
                </div>
              </>
            )}
          </div>

          {/* 4. Selector de Velocidad chip */}
          <div className="relative shrink-0">
            <div
              className="quiet inline-flex items-center justify-center h-10 min-w-[56px] px-2.5 rounded-full text-[13px] font-semibold tabular-nums cursor-pointer pointer-events-none select-none"
              style={{
                background: "var(--btn-ghost)",
                color: "var(--ink)",
              }}
            >
              {playbackSpeed === 1 ? "1.0×" : `${playbackSpeed}×`}
            </div>
            <select
              value={playbackSpeed}
              onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
              aria-label={`Velocidad de reproducción ${playbackSpeed}×`}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            >
              <option value={0.75} className="bg-white text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">0.75×</option>
              <option value={1.0} className="bg-white text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">1.0×</option>
              <option value={1.25} className="bg-white text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">1.25×</option>
              <option value={1.5} className="bg-white text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">1.5×</option>
              <option value={1.75} className="bg-white text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">1.75×</option>
              <option value={2.0} className="bg-white text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">2.0×</option>
            </select>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function ReaderPage() {
  return (
    <Suspense
      fallback={
        <div
          className="min-h-screen flex items-center justify-center gap-3"
          style={{ color: "var(--muted)" }}
        >
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--muted)" }} />
          <span className="text-sm" style={{ color: "var(--muted)" }}>
            Cargando lector...
          </span>
        </div>
      }
    >
      <ReaderContent />
    </Suspense>
  );
}
