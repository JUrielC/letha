"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  ApiError,
  BookDetail,
  ChapterDetail,
  getBaseUrl,
  VoiceItem,
  WordTiming,
} from "@/lib/api";
import { useOfflineMode } from "@/components/OfflineMode";
import { errorMessage, useI18n } from "@/lib/i18n";
import { savePreferences } from "@/lib/preferences";

export const TOTAL_PARTS = 5;

type Boundary = "SentenceBoundary" | "WordBoundary";

interface PlayerValue {
  bookId: string | null;
  book: BookDetail | null;
  chapter: ChapterDetail | null;
  chapterIdx: number | null;
  loadError: string | null;
  voices: VoiceItem[];
  voice: string | null;
  voiceUnavailable: boolean;
  speed: number;
  isPlaying: boolean;
  isSynthesizing: boolean;
  loadedParts: number;
  audioReady: boolean;
  activeSentenceIdx: number;
  duration: number;
  boundaryType: Boundary;
  followKey: number;
  openBook: (id: string, options?: { autoplay?: boolean }) => void;
  close: () => void;
  setReaderVisible: (visible: boolean) => void;
  refreshSettings: () => void;
  refreshVoices: () => void;
  togglePlay: () => void;
  seekRelative: (seconds: number) => void;
  seekTo: (time: number) => void;
  goToChapter: (idx: number) => void;
  playSentence: (idx: number) => void;
  playWord: (sentenceIdx: number, word: WordTiming) => void;
  changeVoice: (voice: string) => void;
  changeSpeed: (speed: number) => void;
}

const PlayerContext = createContext<PlayerValue | null>(null);
// El tiempo cambia varias veces por segundo: va aparte para no volver a dibujar la biblioteca mientras suena un libro
const PlayerTimeContext = createContext(0);

export function usePlayer(): PlayerValue {
  const value = useContext(PlayerContext);
  if (!value) throw new Error("usePlayer requiere PlayerProvider");
  return value;
}

export function usePlayerTime(): number {
  return useContext(PlayerTimeContext);
}

function useStableActions<T extends Record<string, (...args: any[]) => any>>(actions: T): T {
  const latest = useRef(actions);
  latest.current = actions;
  return useMemo(() => {
    const stable = {} as T;
    for (const key of Object.keys(actions) as (keyof T)[]) {
      stable[key] = ((...args: any[]) => latest.current[key](...args)) as T[keyof T];
    }
    return stable;
  }, []);
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const { offlineMode } = useOfflineMode();

  const [bookId, setBookId] = useState<string | null>(null);
  const [book, setBook] = useState<BookDetail | null>(null);
  const [chapter, setChapter] = useState<ChapterDetail | null>(null);
  const [chapterIdx, setChapterIdx] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [voices, setVoices] = useState<VoiceItem[]>([]);
  const [voice, setVoice] = useState<string | null>(null);
  const [voiceUnavailable, setVoiceUnavailable] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [loadedParts, setLoadedParts] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [activeSentenceIdx, setActiveSentenceIdx] = useState(-1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [followKey, setFollowKey] = useState(0);
  const [readerVisible, setReaderVisibleState] = useState(false);
  const [autoAdvanceSentence, setAutoAdvanceSentence] = useState(true);
  const [autoAdvancePage, setAutoAdvancePage] = useState(true);
  const [boundaryType, setBoundaryType] = useState<Boundary>("SentenceBoundary");
  const [retryKey, setRetryKey] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bookIdRef = useRef<string | null>(null);
  const pendingRestoreRef = useRef<{ chapterIdx: number; sentenceIdx: number } | null>(null);
  const pendingSeekTimeRef = useRef<number | null>(null);
  const resumePlayAfterSwapRef = useRef(false);
  const autoPlayNextChapterRef = useRef(false);
  const playWhenReadyRef = useRef(false);
  const restoreWaitingRef = useRef(false);
  const isPlayingRef = useRef(false);
  const isInitialLoadRef = useRef(true);
  const singleSentenceEndRef = useRef<number | null>(null);
  const audioFailedRef = useRef(false);
  const offlineModeSeenRef = useRef(offlineMode);

  // Fuera del lector el libro se escucha como audiolibro: de corrido y pasando de página
  const continuousSentence = autoAdvanceSentence || !readerVisible;
  const continuousPage = autoAdvancePage || !readerVisible;

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const refreshSettings = useCallback(() => {
    api
      .getAppSettings()
      .then((s) => {
        setAutoAdvanceSentence(s.auto_advance_sentence ?? true);
        setAutoAdvancePage(s.auto_advance_page ?? true);
        setBoundaryType(s.boundary_type === "WordBoundary" ? "WordBoundary" : "SentenceBoundary");
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    refreshSettings();
    api.getVoices().then(setVoices).catch(console.error);
  }, [refreshSettings]);

  const startPlaying = () => {
    audioRef.current?.play().catch(console.error);
    setIsPlaying(true);
    isPlayingRef.current = true;
  };

  const stopPlaying = () => {
    audioRef.current?.pause();
    setIsPlaying(false);
    isPlayingRef.current = false;
  };

  const resetPlayback = () => {
    stopPlaying();
    autoPlayNextChapterRef.current = false;
    resumePlayAfterSwapRef.current = false;
    singleSentenceEndRef.current = null;
    pendingSeekTimeRef.current = null;
    audioFailedRef.current = false;
    setAudioUrl(null);
    setChapter(null);
    setChapterIdx(null);
    setVoice(null);
    setBook(null);
    setLoadError(null);
    setActiveSentenceIdx(-1);
    setCurrentTime(0);
    setDuration(0);
    setLoadedParts(0);
  };

  const openBook = (id: string, options: { autoplay?: boolean } = {}) => {
    if (id === bookIdRef.current) {
      if (options.autoplay && !isPlayingRef.current) {
        if (audioUrl) togglePlay();
        else playWhenReadyRef.current = true;
      }
      return;
    }
    resetPlayback();
    bookIdRef.current = id;
    playWhenReadyRef.current = !!options.autoplay;
    setBookId(id);
  };

  const close = () => {
    resetPlayback();
    playWhenReadyRef.current = false;
    bookIdRef.current = null;
    setBookId(null);
  };

  const setReaderVisible = useCallback((visible: boolean) => {
    if (!visible) singleSentenceEndRef.current = null;
    setReaderVisibleState(visible);
  }, []);

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
          setLoadError(t.errors.pdf_without_text);
          return;
        }
        const targetChapter = b.current_chapter_idx ?? 0;
        pendingRestoreRef.current = { chapterIdx: targetChapter, sentenceIdx: b.current_sentence_idx || 0 };
        if (b.speed) setSpeed(b.speed);
        setVoice(b.voice || "es-MX-DaliaNeural");
        setChapterIdx(targetChapter);
      })
      .catch((err: any) => {
        if (!ignore) setLoadError(errorMessage(err, t, t.reader.loadFailed));
      });

    return () => {
      ignore = true;
    };
  }, [bookId]);

  useEffect(() => {
    if (!bookId || chapterIdx === null || !voice) return;
    let ignore = false;
    const controller = new AbortController();
    const currentBookId = bookId;
    const currentChapter = chapterIdx;
    const currentVoice = voice;
    setVoiceUnavailable(false);
    audioFailedRef.current = false;

    audioRef.current?.pause();
    if (!autoPlayNextChapterRef.current) {
      setIsPlaying(false);
      isPlayingRef.current = false;
    }
    setCurrentTime(0);
    pendingSeekTimeRef.current = null;
    resumePlayAfterSwapRef.current = false;
    setLoadError(null);

    let restoredSentence = -1;
    if (pendingRestoreRef.current?.chapterIdx === currentChapter) {
      restoredSentence = pendingRestoreRef.current.sentenceIdx;
      pendingRestoreRef.current = null;
    }
    restoreWaitingRef.current = restoredSentence > 0;
    setActiveSentenceIdx(restoredSentence >= 0 ? restoredSentence : autoPlayNextChapterRef.current ? 0 : -1);

    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
      savePreferences({ last_book_id: currentBookId });
    }
    api.updateProgress(currentBookId, currentChapter, Math.max(0, restoredSentence)).catch(console.error);

    const seekToRestored = (start: number | null | undefined) => {
      if (!restoreWaitingRef.current || typeof start !== "number") return;
      restoreWaitingRef.current = false;
      pendingSeekTimeRef.current = start;
      setCurrentTime(start);
    };

    const loadAndSynthesizeInParts = async () => {
      try {
        const c = await api.getChapter(currentBookId, currentChapter, currentVoice);
        if (ignore) return;
        setChapter(c);
        if (restoredSentence >= c.sentences.length) restoreWaitingRef.current = false;
        if (restoredSentence > 0 && restoredSentence < c.sentences.length) {
          seekToRestored(c.sentences[restoredSentence]?.start);
          setFollowKey((k) => k + 1);
        }

        const base = getBaseUrl();
        const audioPath = `${base}/api/books/${currentBookId}/chapters/${currentChapter}/audio?voice=${encodeURIComponent(currentVoice)}`;

        const preloadNextPageFirstPart = () => {
          if (ignore) return;
          const nextIdx = currentChapter + 1;
          if (!book || nextIdx < book.total_chapters) {
            api
              .synthesizeChapter(currentBookId, nextIdx, currentVoice, 0, TOTAL_PARTS, controller.signal)
              .catch(() => {});
          }
        };

        if (c.has_audio) {
          setLoadedParts(TOTAL_PARTS);
          setIsSynthesizing(false);
          setAudioUrl(`${audioPath}&t=${Date.now()}`);
          preloadNextPageFirstPart();
          return;
        }

        const startPart = Math.min(TOTAL_PARTS, Math.max(0, c.loaded_parts || 0));
        setLoadedParts(startPart);
        setIsSynthesizing(true);
        setAudioUrl(startPart > 0 ? `${audioPath}&part=${startPart}&t=${Date.now()}` : null);

        for (let p = startPart; p < TOTAL_PARTS; p++) {
          if (ignore) return;
          const res = await api.synthesizeChapter(
            currentBookId,
            currentChapter,
            currentVoice,
            p,
            TOTAL_PARTS,
            controller.signal
          );
          if (ignore) return;

          setLoadedParts(res.part);
          setChapter((prev) =>
            prev && prev.idx === currentChapter
              ? {
                  ...prev,
                  has_audio: res.is_complete,
                  loaded_parts: res.part,
                  duration_seconds: res.duration,
                  sentences: res.sentences,
                }
              : prev
          );
          if (restoredSentence > 0 && restoredSentence < res.sentences.length && !isPlayingRef.current) {
            seekToRestored(res.sentences[restoredSentence]?.start);
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
                      ch.idx === currentChapter ? { ...ch, has_audio: true, duration_seconds: res.duration } : ch
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
        audioFailedRef.current = true;
        if (err instanceof ApiError && err.code === "offline_voices_missing") setVoiceUnavailable(true);
        autoPlayNextChapterRef.current = false;
        playWhenReadyRef.current = false;
        setIsPlaying(false);
        isPlayingRef.current = false;
        console.error(err);
      } finally {
        if (!ignore) setIsSynthesizing(false);
      }
    };

    loadAndSynthesizeInParts();

    return () => {
      ignore = true;
      controller.abort();
    };
  }, [bookId, chapterIdx, voice, retryKey]);

  useEffect(() => {
    if (!isPlaying) return;
    if (continuousSentence && singleSentenceEndRef.current === null) return;

    const checkBoundary = () => {
      const audio = audioRef.current;
      if (!audio) return;
      const stopEnd =
        singleSentenceEndRef.current ??
        (!continuousSentence && activeSentenceIdx >= 0 ? chapter?.sentences[activeSentenceIdx]?.end ?? null : null);
      if (typeof stopEnd === "number" && audio.currentTime >= stopEnd - 0.02) {
        audio.pause();
        setIsPlaying(false);
        singleSentenceEndRef.current = null;
      }
    };

    const timer = window.setInterval(checkBoundary, 20);
    return () => window.clearInterval(timer);
  }, [isPlaying, continuousSentence, activeSentenceIdx, chapter]);

  useEffect(() => {
    if (
      !bookId ||
      !chapter?.sentences?.length ||
      chapterIdx === null ||
      chapter.idx !== chapterIdx ||
      pendingSeekTimeRef.current !== null
    ) {
      return;
    }
    if (!isPlaying && currentTime === 0 && activeSentenceIdx > 0) return;
    if (!continuousSentence && singleSentenceEndRef.current !== null) return;

    const idx = chapter.sentences.findIndex(
      (s) => typeof s.start === "number" && typeof s.end === "number" && currentTime >= s.start && currentTime < s.end
    );
    if (idx !== -1 && idx !== activeSentenceIdx) {
      setActiveSentenceIdx(idx);
      setFollowKey((k) => k + 1);
      api.updateProgress(bookId, chapterIdx, idx).catch(console.error);
    }
  }, [currentTime, chapter, activeSentenceIdx, isPlaying, bookId, chapterIdx, continuousSentence]);

  const playSentence = (idx: number) => {
    const sentence = chapter?.sentences[idx];
    if (!sentence || !bookId || chapterIdx === null) return;
    setActiveSentenceIdx(idx);
    api.updateProgress(bookId, chapterIdx, idx).catch(console.error);
    if (typeof sentence.start === "number" && audioRef.current) {
      singleSentenceEndRef.current = !continuousSentence && typeof sentence.end === "number" ? sentence.end : null;
      audioRef.current.currentTime = sentence.start;
      setCurrentTime(sentence.start);
      startPlaying();
    }
  };

  const playWord = (sentenceIdx: number, word: WordTiming) => {
    if (!bookId || chapterIdx === null) return;
    setActiveSentenceIdx(sentenceIdx);
    api.updateProgress(bookId, chapterIdx, sentenceIdx).catch(console.error);
    if (audioRef.current) {
      const startSec = Math.max(0, word.start - 0.02);
      singleSentenceEndRef.current = word.end + 0.04;
      audioRef.current.currentTime = startSec;
      setCurrentTime(startSec);
      startPlaying();
    }
  };

  // Las voces sin conexión pueden haberse descargado o la conexión haber vuelto desde que falló la página
  const refreshVoices = () => {
    api.getVoices().then(setVoices).catch(console.error);
    if (!audioFailedRef.current) return;
    if (chapterIdx !== null && activeSentenceIdx >= 0) {
      pendingRestoreRef.current = { chapterIdx, sentenceIdx: activeSentenceIdx };
    }
    setRetryKey((k) => k + 1);
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      stopPlaying();
      autoPlayNextChapterRef.current = false;
      singleSentenceEndRef.current = null;
      return;
    }
    if (!continuousSentence && chapter?.sentences?.length) {
      const targetIdx = activeSentenceIdx >= 0 ? activeSentenceIdx : 0;
      const target = chapter.sentences[targetIdx];
      if (target && typeof target.start === "number" && typeof target.end === "number") {
        if (activeSentenceIdx < 0) setActiveSentenceIdx(0);
        if (audioRef.current.currentTime < target.start || audioRef.current.currentTime >= target.end - 0.05) {
          audioRef.current.currentTime = target.start;
          setCurrentTime(target.start);
        }
        singleSentenceEndRef.current = target.end;
      }
    } else {
      singleSentenceEndRef.current = null;
    }
    startPlaying();
  };

  const seekTo = (time: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const seekRelative = (seconds: number) => {
    if (!audioRef.current) return;
    seekTo(Math.max(0, Math.min(duration, audioRef.current.currentTime + seconds)));
  };

  const goToChapter = (idx: number) => {
    autoPlayNextChapterRef.current = false;
    setChapterIdx(idx);
  };

  const applyVoice = (newVoice: string) => {
    stopPlaying();
    setAudioUrl(null);
    setChapter((prev) =>
      prev
        ? { ...prev, has_audio: false, sentences: prev.sentences.map((s) => ({ ...s, start: null, end: null })) }
        : null
    );
    setVoice(newVoice);
  };

  const changeVoice = (newVoice: string) => {
    if (newVoice === voice || !bookId) return;
    applyVoice(newVoice);
    api.updateSettings(bookId, newVoice, speed).catch(console.error);
  };

  const changeSpeed = (newSpeed: number) => {
    setSpeed(newSpeed);
    if (audioRef.current) audioRef.current.playbackRate = newSpeed;
    if (bookId && voice) api.updateSettings(bookId, voice, newSpeed).catch(console.error);
  };

  useEffect(() => {
    if (offlineModeSeenRef.current === offlineMode) return;
    offlineModeSeenRef.current = offlineMode;
    api.getVoices().then(setVoices).catch(console.error);
    if (!bookId) return;
    api
      .getBook(bookId)
      .then((b) => {
        if (!voice || b.voice === voice) return;
        // Al cambiar de modo se retoma la misma oración con la voz que corresponde
        if (chapterIdx !== null && activeSentenceIdx >= 0) {
          pendingRestoreRef.current = { chapterIdx, sentenceIdx: activeSentenceIdx };
        }
        if (isPlayingRef.current) playWhenReadyRef.current = true;
        applyVoice(b.voice);
      })
      .catch(console.error);
  }, [offlineMode]);

  const actions = useStableActions({
    openBook,
    close,
    setReaderVisible,
    refreshSettings,
    refreshVoices,
    togglePlay,
    seekRelative,
    seekTo,
    goToChapter,
    playSentence,
    playWord,
    changeVoice,
    changeSpeed,
  });

  const audioReady = !!audioUrl;
  const value = useMemo<PlayerValue>(
    () => ({
      bookId,
      book,
      chapter,
      chapterIdx,
      loadError,
      voices,
      voice,
      voiceUnavailable,
      speed,
      isPlaying,
      isSynthesizing,
      loadedParts,
      audioReady,
      activeSentenceIdx,
      duration,
      boundaryType,
      followKey,
      ...actions,
    }),
    [
      bookId,
      book,
      chapter,
      chapterIdx,
      loadError,
      voices,
      voice,
      voiceUnavailable,
      speed,
      isPlaying,
      isSynthesizing,
      loadedParts,
      audioReady,
      activeSentenceIdx,
      duration,
      boundaryType,
      followKey,
      actions,
    ]
  );

  return (
    <PlayerContext.Provider value={value}>
      <PlayerTimeContext.Provider value={currentTime}>{children}</PlayerTimeContext.Provider>
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onTimeUpdate={() => {
            if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
          }}
          onLoadedMetadata={() => {
            const audio = audioRef.current;
            if (!audio) return;
            setDuration(audio.duration);
            audio.playbackRate = speed;
            if (pendingSeekTimeRef.current !== null) {
              audio.currentTime = pendingSeekTimeRef.current;
              setCurrentTime(pendingSeekTimeRef.current);
              pendingSeekTimeRef.current = null;
            }
            if (autoPlayNextChapterRef.current) {
              autoPlayNextChapterRef.current = false;
              startPlaying();
            } else if (resumePlayAfterSwapRef.current) {
              resumePlayAfterSwapRef.current = false;
              startPlaying();
            } else if (playWhenReadyRef.current && !restoreWaitingRef.current) {
              playWhenReadyRef.current = false;
              singleSentenceEndRef.current = null;
              startPlaying();
            }
          }}
          onEnded={() => {
            if (continuousSentence && continuousPage && book && chapterIdx !== null && chapterIdx + 1 < book.total_chapters) {
              autoPlayNextChapterRef.current = true;
              setIsPlaying(true);
              isPlayingRef.current = true;
              setChapterIdx(chapterIdx + 1);
            } else {
              autoPlayNextChapterRef.current = false;
              setIsPlaying(false);
              isPlayingRef.current = false;
            }
          }}
          onError={() => {
            autoPlayNextChapterRef.current = false;
            setIsPlaying(false);
            isPlayingRef.current = false;
          }}
        />
      )}
    </PlayerContext.Provider>
  );
}
