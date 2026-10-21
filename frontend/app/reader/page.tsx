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
} from "lucide-react";
import {
  api,
  BookDetail,
  ChapterDetail,
  SentenceItem,
  VoiceItem,
  getBaseUrl,
  withTokenUrl,
} from "@/lib/api";

type Theme = "light" | "sepia" | "dark";
type FontSize = "sm" | "base" | "lg" | "xl";

function ReaderContent() {
  const searchParams = useSearchParams();
  const bookId = searchParams.get("id") || "";

  // Estados de datos
  const [book, setBook] = useState<BookDetail | null>(null);
  const [chapter, setChapter] = useState<ChapterDetail | null>(null);
  const [currentChapterIdx, setCurrentChapterIdx] = useState<number | null>(null);
  const [voices, setVoices] = useState<VoiceItem[]>([]);
  const [selectedVoice, setSelectedVoice] = useState("es-MX-DaliaNeural");
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);

  // Estados de reproducción
  const [isPlaying, setIsPlaying] = useState(false);
  const [autoContinue, setAutoContinue] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [activeSentenceIdx, setActiveSentenceIdx] = useState<number>(-1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // UI preferences
  const [theme, setTheme] = useState<Theme>("light");
  const [fontSize, setFontSize] = useState<FontSize>("base");
  const [isTocOpen, setIsTocOpen] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sentenceRefs = useRef<{ [key: number]: HTMLSpanElement | null }>({});
  const pendingSentenceIdxRef = useRef<number | null>(null);
  const pendingSeekTimeRef = useRef<number | null>(null);
  const isInitialLoadRef = useRef<boolean>(true);

  // Cargar preferencias guardadas y tema
  useEffect(() => {
    const savedTheme = (localStorage.getItem("letha_theme") as Theme) || "light";
    setTheme(savedTheme);
    applyTheme(savedTheme);

    const savedFont = (localStorage.getItem("letha_fontsize") as FontSize) || "base";
    setFontSize(savedFont);

    // Cargar voces
    api.getVoices().then(setVoices).catch(console.error);
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

  // Cargar libro inicial
  useEffect(() => {
    if (!bookId) return;
    isInitialLoadRef.current = true;
    api
      .getBook(bookId)
      .then((b) => {
        setBook(b);
        pendingSentenceIdxRef.current = b.current_sentence_idx || 0;
        setCurrentChapterIdx(b.current_chapter_idx ?? 0);
        if (b.voice) setSelectedVoice(b.voice);
        if (b.speed) setPlaybackSpeed(b.speed);
      })
      .catch(console.error);
  }, [bookId]);

  // Precarga en segundo plano de la siguiente página para transición instantánea
  const prefetchNextChapter = (nextIdx: number) => {
    if (!bookId || !book || nextIdx >= book.total_chapters) return;
    api.synthesizeChapter(bookId, nextIdx, selectedVoice).catch(() => {});
  };

  // Cargar capítulo cuando cambie currentChapterIdx (solo después de cargar el libro)
  useEffect(() => {
    if (!bookId || currentChapterIdx === null) return;
    const chapterIdx = currentChapterIdx;

    setIsPlaying(false);
    setCurrentTime(0);
    pendingSeekTimeRef.current = null;

    const restoredSentence =
      pendingSentenceIdxRef.current !== null ? pendingSentenceIdxRef.current : -1;
    pendingSentenceIdxRef.current = null;

    setActiveSentenceIdx(restoredSentence >= 0 ? restoredSentence : -1);

    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
    } else {
      api.updateProgress(bookId, chapterIdx, 0).catch(console.error);
    }

    api
      .getChapter(bookId, chapterIdx)
      .then((c) => {
        setChapter(c);

        if (restoredSentence > 0 && restoredSentence < c.sentences.length) {
          const targetSentence = c.sentences[restoredSentence];
          if (typeof targetSentence?.start === "number") {
            pendingSeekTimeRef.current = targetSentence.start;
            setCurrentTime(targetSentence.start);
          }
          setTimeout(() => {
            sentenceRefs.current[restoredSentence]?.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
          }, 120);
        }

        if (c.has_audio) {
          const base = getBaseUrl();
          setAudioUrl(
            withTokenUrl(
              `${base}/api/books/${bookId}/chapters/${chapterIdx}/audio?t=${Date.now()}`
            )
          );
          if (autoContinue) {
            setTimeout(() => {
              if (audioRef.current) {
                audioRef.current.play().catch(console.error);
                setIsPlaying(true);
              }
            }, 150);
            prefetchNextChapter(chapterIdx + 1);
          }
        } else {
          setAudioUrl(null);
          if (autoContinue) {
            // Sintetizar automáticamente al pasar de página en reproducción continua
            setIsSynthesizing(true);
            api
              .synthesizeChapter(bookId, chapterIdx, selectedVoice)
              .then((res) => {
                setChapter((prev) =>
                  prev
                    ? {
                        ...prev,
                        has_audio: true,
                        duration_seconds: res.duration,
                        sentences: res.sentences,
                      }
                    : null
                );
                const base = getBaseUrl();
                setAudioUrl(withTokenUrl(`${base}${res.audio_url}?t=${Date.now()}`));
                setTimeout(() => {
                  if (audioRef.current) {
                    audioRef.current.play().catch(console.error);
                    setIsPlaying(true);
                  }
                }, 150);
                prefetchNextChapter(chapterIdx + 1);
              })
              .catch(console.error)
              .finally(() => setIsSynthesizing(false));
          }
        }
      })
      .catch(console.error);
  }, [bookId, currentChapterIdx]);

  // Sincronización Karaoke: Detectar oración activa según currentTime
  useEffect(() => {
    if (!chapter?.sentences || chapter.sentences.length === 0 || !isPlaying) return;

    const idx = chapter.sentences.findIndex(
      (s) =>
        typeof s.start === "number" &&
        typeof s.end === "number" &&
        currentTime >= s.start &&
        currentTime < s.end
    );

    if (idx !== -1 && idx !== activeSentenceIdx) {
      setActiveSentenceIdx(idx);
      if (bookId && currentChapterIdx !== null) {
        api.updateProgress(bookId, currentChapterIdx, idx).catch(console.error);
      }

      // Auto-scroll suave hacia la oración activa
      const elem = sentenceRefs.current[idx];
      if (elem) {
        elem.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [currentTime, chapter, activeSentenceIdx, isPlaying, bookId, currentChapterIdx]);

  // Generar o re-generar audio para el capítulo
  const handleSynthesize = async () => {
    if (!chapter || !bookId || currentChapterIdx === null) return;
    setIsSynthesizing(true);
    try {
      const res = await api.synthesizeChapter(
        bookId,
        currentChapterIdx,
        selectedVoice
      );

      // Actualizar datos del capítulo con los timestamps generados
      setChapter((prev) =>
        prev
          ? {
              ...prev,
              has_audio: true,
              duration_seconds: res.duration,
              sentences: res.sentences,
            }
          : null
      );

      const base = getBaseUrl();
      const newUrl = withTokenUrl(`${base}${res.audio_url}?t=${Date.now()}`);
      setAudioUrl(newUrl);

      // Comenzar reproducción automáticamente y precargar la siguiente página
      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.play().catch(console.error);
          setIsPlaying(true);
        }
      }, 200);
      prefetchNextChapter(currentChapterIdx + 1);
    } catch (err: any) {
      alert(`Error al generar audio: ${err.message}`);
    } finally {
      setIsSynthesizing(false);
    }
  };

  // Clic en una oración: saltar audio a esa posición
  const handleSentenceClick = (sentence: SentenceItem, sIdx: number) => {
    setActiveSentenceIdx(sIdx);
    if (bookId && currentChapterIdx !== null) {
      api.updateProgress(bookId, currentChapterIdx, sIdx).catch(console.error);
    }

    if (!audioUrl) {
      // Si aún no hay audio, sugerir generarlo
      handleSynthesize();
      return;
    }

    if (typeof sentence.start === "number" && audioRef.current) {
      audioRef.current.currentTime = sentence.start;
      setCurrentTime(sentence.start);
      if (!isPlaying) {
        audioRef.current.play().catch(console.error);
        setIsPlaying(true);
      }
    }
  };

  // Controles de reproducción
  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch(console.error);
      setIsPlaying(true);
    }
  };

  const seekRelative = (seconds: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(
      0,
      Math.min(duration, audioRef.current.currentTime + seconds)
    );
  };

  const handleVoiceChange = async (newVoice: string) => {
    setSelectedVoice(newVoice);
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setIsPlaying(false);
    setAudioUrl(null);
    if (bookId) {
      await api.updateSettings(bookId, newVoice, playbackSpeed).catch(console.error);
    }
  };

  const handleSpeedChange = async (newSpeed: number) => {
    setPlaybackSpeed(newSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = newSpeed;
    }
    if (bookId) {
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
            }
          }}
          onEnded={() => {
            setIsPlaying(false);
            if (book && currentChapterIdx !== null && currentChapterIdx + 1 < book.total_chapters) {
              setAutoContinue(true);
              setCurrentChapterIdx(currentChapterIdx + 1);
            }
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

            <select
              value={selectedVoice}
              onChange={(e) => handleVoiceChange(e.target.value)}
              className="hidden md:block max-w-[240px] text-xs font-medium bg-transparent border border-zinc-200 dark:border-zinc-800 rounded-xl px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer truncate"
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
        {!chapter ? (
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
                return (
                  <span
                    key={idx}
                    ref={(el) => {
                      sentenceRefs.current[idx] = el;
                    }}
                    onClick={() => handleSentenceClick(s, idx)}
                    className={`sentence-item cursor-pointer inline ${
                      isActive
                        ? getActiveSentenceClass()
                        : "hover:bg-black/5 dark:hover:bg-white/5"
                    }`}
                    title={
                      typeof s.start === "number"
                        ? `Saltar a ${s.start.toFixed(1)}s`
                        : "Haz clic para escuchar"
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
          {!audioUrl && !isSynthesizing ? (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-amber-500/10 border border-amber-500/20 rounded-2xl px-4 py-2.5">
              <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300 font-medium">
                <Volume2 className="w-4 h-4 text-amber-500 shrink-0" />
                <span>Elige quién narra y escucha esta página:</span>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={selectedVoice}
                  onChange={(e) => handleVoiceChange(e.target.value)}
                  className="flex-1 sm:max-w-[230px] text-xs font-medium bg-white dark:bg-zinc-900 border border-amber-500/30 rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer truncate"
                >
                  {voices.map((v) => (
                    <option key={v.short_name} value={v.short_name}>
                      {v.friendly_name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleSynthesize}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl shadow-sm transition shrink-0"
                >
                  <Headphones className="w-3.5 h-3.5" />
                  <span>Narrar</span>
                </button>
              </div>
            </div>
          ) : isSynthesizing ? (
            <div className="flex items-center justify-center gap-2 py-2 text-xs font-medium text-amber-600 dark:text-amber-400">
              <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
              <span>Sintetizando voz y generando marcas de sincronización con Microsoft Edge...</span>
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
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setCurrentTime(val);
                    if (audioRef.current) audioRef.current.currentTime = val;
                  }}
                  className="flex-1 h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
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
                  title="Capítulo anterior"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => seekRelative(-10)}
                    className="p-2 rounded-xl text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition"
                    title="Retroceder 10 segundos"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>

                  <button
                    onClick={togglePlay}
                    className="w-12 h-12 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white flex items-center justify-center shadow-md transition active:scale-95"
                    title={isPlaying ? "Pausar" : "Reproducir"}
                  >
                    {isPlaying ? (
                      <Pause className="w-6 h-6 fill-current" />
                    ) : (
                      <Play className="w-6 h-6 fill-current ml-0.5" />
                    )}
                  </button>

                  <button
                    onClick={() => seekRelative(10)}
                    className="p-2 rounded-xl text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition"
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
                    title="Siguiente capítulo"
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
