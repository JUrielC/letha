"use client";

import React, { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Headphones,
  Loader2,
  Moon,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Sun,
  Coffee,
  Type,
  Volume2,
  List,
  Settings,
} from "lucide-react";
import {
  api,
  BookDetail,
  ChapterDetail,
  SentenceItem,
  VoiceItem,
  getBaseUrl,
} from "@/lib/api";

type Theme = "light" | "sepia" | "dark";
type FontSize = "sm" | "base" | "lg" | "xl";

const TOTAL_PARTS = 5;

function ReaderContent() {
  const searchParams = useSearchParams();
  const bookId = searchParams.get("id") || "";

  // Estados de datos
  const [book, setBook] = useState<BookDetail | null>(null);
  const [chapter, setChapter] = useState<ChapterDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentChapterIdx, setCurrentChapterIdx] = useState<number | null>(null);
  const [voices, setVoices] = useState<VoiceItem[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);

  // Estados de reproducción y carga progresiva por fragmentos (1..5)
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [loadedParts, setLoadedParts] = useState<number>(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [activeSentenceIdx, setActiveSentenceIdx] = useState<number>(-1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // UI preferences
  const [theme, setTheme] = useState<Theme>("light");
  const [fontSize, setFontSize] = useState<FontSize>("base");
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [autoAdvanceSentence, setAutoAdvanceSentence] = useState<boolean>(true);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sentenceRefs = useRef<{ [key: number]: HTMLSpanElement | null }>({});
  const pendingRestoreRef = useRef<{ chapterIdx: number; sentenceIdx: number } | null>(null);
  const pendingSeekTimeRef = useRef<number | null>(null);
  const resumePlayAfterSwapRef = useRef<boolean>(false);
  const isPlayingRef = useRef<boolean>(false);
  const isInitialLoadRef = useRef<boolean>(true);
  const singleSentenceEndRef = useRef<number | null>(null);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Cargar preferencias guardadas y tema
  useEffect(() => {
    const savedTheme = (localStorage.getItem("letha_theme") as Theme) || "light";
    setTheme(savedTheme);
    applyTheme(savedTheme);

    const savedFont = (localStorage.getItem("letha_fontsize") as FontSize) || "base";
    setFontSize(savedFont);

    // Cargar voces y configuración de la app
    api.getVoices().then(setVoices).catch(console.error);
    api
      .getAppSettings()
      .then((s) => setAutoAdvanceSentence(s.auto_advance_sentence ?? true))
      .catch(console.error);
  }, []);

  const applyTheme = (t: Theme) => {
    document.body.classList.remove("theme-sepia", "theme-dark");
    if (t === "sepia") document.body.classList.add("theme-sepia");
    if (t === "dark") document.body.classList.add("theme-dark");
    localStorage.setItem("letha_theme", t);
  };

  const cycleTheme = () => {
    const next: Theme = theme === "light" ? "sepia" : theme === "sepia" ? "dark" : "light";
    setTheme(next);
    applyTheme(next);
  };

  // Cargar libro inicial (incluyendo la voz previamente guardada antes de cargar el capítulo)
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

  // Cargar capítulo y sintetizar en 5 partes cuando cambie currentChapterIdx o selectedVoice
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

        // Si la página ya está completamente sintetizada en caché para esta voz
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

        // Determinar cuántos fragmentos iniciales (ej. el fragmento 1 precargado desde la página anterior)
        // ya están listos en disco para no volver a pedirlos y empezar desde el siguiente fragmento.
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

          // Si había una oración restaurada y su fragmento acaba de cargarse, preparar su posición
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
            // Al completar las 5 partes (o si está en pausa), actualizar el audio combinado final
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

  // En modo "Solo al clickear", pausar con precisión al terminar la oración actual
  useEffect(() => {
    if (!isPlaying || autoAdvanceSentence) return;

    const checkBoundary = () => {
      const audio = audioRef.current;
      if (!audio) return;
      const stopEnd =
        singleSentenceEndRef.current ??
        (activeSentenceIdx >= 0
          ? chapter?.sentences[activeSentenceIdx]?.end ?? null
          : null);
      if (typeof stopEnd === "number" && audio.currentTime >= stopEnd - 0.03) {
        audio.pause();
        setIsPlaying(false);
        singleSentenceEndRef.current = null;
      }
    };

    const timer = window.setInterval(checkBoundary, 25);
    return () => window.clearInterval(timer);
  }, [isPlaying, autoAdvanceSentence, activeSentenceIdx, chapter]);

  // Sincronización Karaoke: Detectar oración activa según currentTime
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
    // Evitar que currentTime=0 al montar en pausa pise la oración restaurada
    if (!isPlaying && currentTime === 0 && activeSentenceIdx > 0) {
      return;
    }
    // En modo "Solo al clickear", mientras se reproduce la oración elegida, mantener el foco en ella
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

      // Auto-scroll suave hacia la oración activa
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

  // Clic en una oración: saltar audio a esa posición si su fragmento ya está cargado
  const handleSentenceClick = (sentence: SentenceItem, sIdx: number) => {
    setActiveSentenceIdx(sIdx);
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

  // Controles de reproducción
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

  const handleVoiceChange = async (newVoice: string) => {
    if (newVoice === selectedVoice) return;
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setIsPlaying(false);
    setAudioUrl(null);
    // Mostrar las oraciones actuales en tono opaco mientras se carga la nueva voz
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

  const cycleFontSize = () => {
    const sizes: FontSize[] = ["sm", "base", "lg", "xl"];
    const next = sizes[(sizes.indexOf(fontSize) + 1) % sizes.length];
    setFontSize(next);
    localStorage.setItem("letha_fontsize", next);
  };

  const fontClass = {
    sm: "text-base leading-relaxed max-w-2xl",
    base: "text-lg leading-loose max-w-3xl",
    lg: "text-xl leading-loose max-w-3xl",
    xl: "text-2xl leading-loose max-w-4xl",
  }[fontSize];

  const getActiveSentenceClass = () => {
    if (theme === "sepia") return "sentence-active-sepia";
    if (theme === "dark") return "sentence-active-dark";
    return "sentence-active-light";
  };

  return (
    <div className="min-h-screen flex flex-col pb-32">
      {/* Elemento de audio nativo */}
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
      <header className="sticky top-0 z-30 border-b backdrop-blur-md bg-white/80 dark:bg-zinc-950/80 border-zinc-200 dark:border-zinc-800">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="p-2 rounded-xl text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
              title="Volver a la biblioteca"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>

            <button
              onClick={() => setIsTocOpen(!isTocOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
            >
              <List className="w-4 h-4" />
              <span className="hidden sm:inline">Índice</span>
            </button>
          </div>

          <div className="flex-1 text-center truncate px-2">
            <h2 className="text-xs font-bold truncate">{book?.title || "Cargando..."}</h2>
            <p className="text-[11px] text-zinc-400 truncate">{chapter?.title}</p>
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={cycleFontSize}
              className="p-2 rounded-xl text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition flex items-center gap-1"
              title="Cambiar tamaño de texto"
            >
              <Type className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase">{fontSize}</span>
            </button>

            <button
              onClick={cycleTheme}
              className="p-2 rounded-xl text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
              title="Cambiar tema de color"
            >
              {theme === "light" && <Sun className="w-4 h-4 text-amber-500" />}
              {theme === "sepia" && <Coffee className="w-4 h-4 text-amber-700" />}
              {theme === "dark" && <Moon className="w-4 h-4 text-indigo-400" />}
            </button>

            <Link
              href={`/settings?bookId=${bookId}`}
              className="p-2 rounded-xl text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
              title="Configuración de la app"
            >
              <Settings className="w-4 h-4" />
            </Link>

            <select
              value={selectedVoice || "es-MX-DaliaNeural"}
              onChange={(e) => handleVoiceChange(e.target.value)}
              className="max-w-[160px] sm:max-w-[240px] text-xs font-medium bg-transparent border border-zinc-200 dark:border-zinc-800 rounded-xl px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer truncate"
              title="Cambiar persona que narra"
            >
              {voices.map((v) => (
                <option
                  key={v.short_name}
                  value={v.short_name}
                  className="bg-white dark:bg-zinc-900"
                >
                  {v.friendly_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Barra superior de progreso de fragmentos de voz (1 de 5 .. 5 de 5) */}
        {isSynthesizing && (
          <div className="border-t border-amber-500/20 bg-amber-500/5 px-4 py-1.5">
            <div className="max-w-3xl mx-auto flex items-center gap-3">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500 shrink-0" />
              <div className="flex-1 h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 transition-all duration-300 rounded-full"
                  style={{
                    width: `${Math.max(10, (loadedParts / TOTAL_PARTS) * 100)}%`,
                  }}
                />
              </div>
              <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 tabular-nums shrink-0">
                {Math.max(1, loadedParts)} de {TOTAL_PARTS}
              </span>
            </div>
          </div>
        )}
      </header>

      {/* Drawer / Menú lateral de Capítulos */}
      {isTocOpen && (
        <div className="fixed inset-0 z-40 flex">
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setIsTocOpen(false)}
          />
          <div className="relative w-80 max-w-full bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 h-full p-6 overflow-y-auto shadow-2xl flex flex-col z-50">
            <h3 className="font-bold text-base mb-4 flex items-center gap-2">
              <List className="w-4 h-4 text-amber-500" />
              <span>Contenido del libro</span>
            </h3>
            <div className="space-y-1 flex-1">
              {book?.chapters.map((c) => (
                <button
                  key={c.idx}
                  onClick={() => {
                    setCurrentChapterIdx(c.idx);
                    setIsTocOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition flex items-center justify-between ${
                    c.idx === currentChapterIdx
                      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold"
                      : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60 text-zinc-600 dark:text-zinc-300"
                  }`}
                >
                  <span className="truncate pr-2">{c.title}</span>
                  {c.has_audio && (
                    <Headphones className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Área de lectura del texto */}
      <main className="flex-1 w-full mx-auto px-6 sm:px-12 py-12 flex flex-col items-center">
        {loadError ? (
          <div className="flex flex-col items-center justify-center py-24 text-center max-w-md gap-4">
            <p className="text-sm font-medium text-red-500">{loadError}</p>
            <Link
              href="/"
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition"
            >
              Volver a la biblioteca
            </Link>
          </div>
        ) : !chapter ? (
          <div className="flex flex-col items-center justify-center py-24 text-zinc-400 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
            <span className="text-sm">Cargando capítulo...</span>
          </div>
        ) : (
          <article className={`font-serif ${fontClass} tracking-normal text-justify select-text`}>
            <header className="mb-8 text-center border-b border-zinc-200 dark:border-zinc-800 pb-6">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight font-sans">
                {chapter.title}
              </h1>
              <p className="text-xs text-zinc-400 mt-2 font-sans">
                Páginas {chapter.start_page} – {chapter.end_page}
              </p>
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
                    className={`sentence-item inline transition-opacity duration-300 ${
                      isActive
                        ? `${getActiveSentenceClass()} opacity-100 cursor-pointer`
                        : isVoiceReady
                        ? "opacity-100 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
                        : "opacity-35 cursor-wait"
                    }`}
                    title={
                      isVoiceReady
                        ? `Escuchar desde ${(s.start as number).toFixed(1)}s`
                        : "Cargando voz para este fragmento..."
                    }
                  >
                    {s.text}{" "}
                  </span>
                );
              })}
            </div>
          </article>
        )}
      </main>

      {/* Barra de Transporte Flotante de Audio */}
      <footer className="fixed bottom-0 left-0 right-0 z-30 border-t backdrop-blur-xl bg-white/95 dark:bg-zinc-950/95 border-zinc-200 dark:border-zinc-800 shadow-2xl px-4 py-3">
        <div className="max-w-3xl mx-auto flex flex-col gap-2">
          {!audioUrl && isSynthesizing ? (
            <div className="flex items-center justify-center gap-2 py-2 text-xs font-medium text-amber-600 dark:text-amber-400">
              <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
              <span>
                Cargando voz del fragmento {Math.max(1, loadedParts)} de {TOTAL_PARTS}...
              </span>
            </div>
          ) : (
            <>
              {/* Barra de progreso / Scrubber */}
              <div className="flex items-center gap-3 text-xs text-zinc-400 font-mono">
                <span>
                  {Math.floor(currentTime / 60)}:
                  {Math.floor(currentTime % 60)
                    .toString()
                    .padStart(2, "0")}
                </span>
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
                  className="flex-1 h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500 disabled:opacity-40"
                />
                <span>
                  {Math.floor(duration / 60)}:
                  {Math.floor(duration % 60)
                    .toString()
                    .padStart(2, "0")}
                </span>
              </div>

              {/* Botones de control */}
              <div className="flex items-center justify-between">
                <button
                  disabled={currentChapterIdx === null || currentChapterIdx <= 0}
                  onClick={() =>
                    currentChapterIdx !== null && setCurrentChapterIdx(currentChapterIdx - 1)
                  }
                  className="p-2 rounded-xl text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-30 transition"
                  title="Página anterior"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>

                <div className="flex items-center gap-3">
                  <button
                    disabled={!audioUrl}
                    onClick={() => seekRelative(-10)}
                    className="p-2 rounded-xl text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 disabled:opacity-30 transition"
                    title="Retroceder 10 segundos"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>

                  <button
                    disabled={!audioUrl}
                    onClick={togglePlay}
                    className="w-12 h-12 rounded-2xl bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white flex items-center justify-center shadow-md transition active:scale-95"
                    title={isPlaying ? "Pausar" : "Reproducir"}
                  >
                    {isPlaying ? (
                      <Pause className="w-6 h-6 fill-current" />
                    ) : (
                      <Play className="w-6 h-6 fill-current ml-0.5" />
                    )}
                  </button>

                  <button
                    disabled={!audioUrl}
                    onClick={() => seekRelative(10)}
                    className="p-2 rounded-xl text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 disabled:opacity-30 transition"
                    title="Adelantar 10 segundos"
                  >
                    <RotateCw className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  <select
                    value={playbackSpeed}
                    onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
                    className="text-xs font-bold bg-zinc-100 dark:bg-zinc-800 rounded-xl px-2 py-1 border border-zinc-200 dark:border-zinc-700 focus:outline-none cursor-pointer"
                  >
                    <option value={0.75}>0.75x</option>
                    <option value={1.0}>1.0x</option>
                    <option value={1.25}>1.25x</option>
                    <option value={1.5}>1.5x</option>
                    <option value={1.75}>1.75x</option>
                    <option value={2.0}>2.0x</option>
                  </select>

                  <button
                    disabled={
                      !book ||
                      currentChapterIdx === null ||
                      currentChapterIdx + 1 >= book.total_chapters
                    }
                    onClick={() =>
                      currentChapterIdx !== null && setCurrentChapterIdx(currentChapterIdx + 1)
                    }
                    className="p-2 rounded-xl text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-30 transition"
                    title="Siguiente página"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}

export default function ReaderPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-zinc-400 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
          <span className="text-sm">Cargando lector...</span>
        </div>
      }
    >
      <ReaderContent />
    </Suspense>
  );
}
