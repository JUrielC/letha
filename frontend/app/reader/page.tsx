"use client";

import React, { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Headphones,
  Languages,
  List,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Settings,
} from "lucide-react";
import { api, SentenceItem, WordTiming } from "@/lib/api";
import { OfflineBadge, useOfflineMode } from "@/components/OfflineMode";
import { TOTAL_PARTS, usePlayer, usePlayerTime } from "@/components/Player";
import { languageName, useI18n } from "@/lib/i18n";
import { NATIVE_LANGUAGE_EVENT } from "@/lib/nativeLanguage";
import { savedSettings, savePreferences } from "@/lib/preferences";
import { Theme, useTheme } from "@/lib/useTheme";
import { personaName, voiceLabel } from "@/lib/voices";

type FontSize = "sm" | "base" | "lg" | "xl";

const FONT_PX: Record<FontSize, number> = { sm: 18, base: 20, lg: 22, xl: 25 };

const FONT_STYLES: Record<FontSize, React.CSSProperties> = {
  sm: { fontSize: FONT_PX.sm, lineHeight: 1.7 },
  base: { fontSize: FONT_PX.base, lineHeight: 1.74 },
  lg: { fontSize: FONT_PX.lg, lineHeight: 1.74 },
  xl: { fontSize: FONT_PX.xl, lineHeight: 1.72 },
};

function formatTime(sec: number) {
  if (isNaN(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function groupParagraphs(sentences: SentenceItem[]): number[][] {
  const paragraphs: number[][] = [];
  sentences.forEach((s, idx) => {
    if (idx === 0 || s.paragraph_start) paragraphs.push([idx]);
    else paragraphs[paragraphs.length - 1].push(idx);
  });
  return paragraphs;
}

function ReaderContent() {
  const searchParams = useSearchParams();
  const bookId = searchParams.get("id") || "";
  const player = usePlayer();
  const currentTime = usePlayerTime();
  const { offlineMode } = useOfflineMode();
  const offlineModeSeenRef = useRef(offlineMode);

  const isCurrent = player.bookId === bookId;
  const book = isCurrent ? player.book : null;
  const chapter = isCurrent ? player.chapter : null;
  const currentChapterIdx = isCurrent ? player.chapterIdx : null;
  const loadError = isCurrent ? player.loadError : null;
  const {
    voices,
    voiceUnavailable,
    isPlaying,
    isSynthesizing,
    loadedParts,
    activeSentenceIdx,
    duration,
    boundaryType,
    togglePlay,
    seekRelative,
  } = player;
  const selectedVoice = player.voice;
  const playbackSpeed = player.speed;
  const audioUrl = isCurrent && player.audioReady;

  const { theme, setTheme } = useTheme();
  const { t, locale } = useI18n();
  const [fontSize, setFontSize] = useState<FontSize>("base");
  const [isAaOpen, setIsAaOpen] = useState(false);
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [activeWordKey, setActiveWordKey] = useState<string | null>(null);
  const [nativeLanguage, setNativeLanguage] = useState<string | null>(null);
  const [translations, setTranslations] = useState<Record<number, (string | null)[]>>({});
  const [translationFailed, setTranslationFailed] = useState<Record<number, boolean>>({});
  const [showTranslation, setShowTranslation] = useState<boolean>(true);

  const sentenceRefs = useRef<{ [key: number]: HTMLSpanElement | null }>({});
  const aaRef = useRef<HTMLDivElement>(null);
  const tocRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!bookId) return;
    player.openBook(bookId);
    player.setReaderVisible(true);
    player.refreshSettings();
    player.refreshVoices();
    return () => player.setReaderVisible(false);
  }, [bookId]);

  useEffect(() => {
    const saved = savedSettings();
    setFontSize(saved.font_size ?? "base");
    setShowTranslation(saved.show_translation ?? true);

    api
      .getAppSettings()
      .then((s) => {
        setFontSize(s.font_size);
        setShowTranslation(s.show_translation);
        setNativeLanguage(s.native_language ?? null);
      })
      .catch(console.error);

    const onNativeLanguage = (e: Event) => {
      setNativeLanguage((e as CustomEvent<string>).detail);
      setTranslations({});
      setTranslationFailed({});
    };
    window.addEventListener(NATIVE_LANGUAGE_EVENT, onNativeLanguage);
    return () => window.removeEventListener(NATIVE_LANGUAGE_EVENT, onNativeLanguage);
  }, []);

  useEffect(() => {
    if (offlineModeSeenRef.current === offlineMode) return;
    offlineModeSeenRef.current = offlineMode;
    setTranslations({});
    setTranslationFailed({});
  }, [offlineMode]);

  useEffect(() => {
    if (currentChapterIdx !== null) window.scrollTo({ top: 0, behavior: "smooth" });
  }, [currentChapterIdx]);

  useEffect(() => {
    if (!isCurrent || activeSentenceIdx < 0) return;
    const timer = setTimeout(() => {
      sentenceRefs.current[activeSentenceIdx]?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    return () => clearTimeout(timer);
  }, [player.followKey, isCurrent, chapter?.idx]);

  const translationEnabled = !!nativeLanguage && !!book && book.language !== nativeLanguage;

  useEffect(() => {
    if (!translationEnabled || !bookId || !book || currentChapterIdx === null) return;
    let ignore = false;
    const load = (idx: number) =>
      api.getChapterTranslations(bookId, idx).then((res) => {
        if (!ignore) setTranslations((prev) => ({ ...prev, [idx]: res.translations }));
        return res;
      });

    load(currentChapterIdx)
      .then(() => {
        if (currentChapterIdx + 1 < book.chapters.length) load(currentChapterIdx + 1).catch(() => {});
      })
      .catch(() => {
        if (!ignore) setTranslationFailed((prev) => ({ ...prev, [currentChapterIdx]: true }));
      });
    return () => {
      ignore = true;
    };
  }, [translationEnabled, bookId, book?.id, currentChapterIdx, nativeLanguage]);

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

  const handleSentenceClick = (_sentence: SentenceItem, sIdx: number) => {
    setActiveWordKey(null);
    player.playSentence(sIdx);
  };

  const handleWordClick = (
    _sentence: SentenceItem,
    sIdx: number,
    word: WordTiming,
    wIdx: number,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    setActiveWordKey(`${sIdx}:${wIdx}`);
    player.playWord(sIdx, word);
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
              title={t.reader.listenToWord(wordTiming.text, wordTiming.start.toFixed(2))}
            >
              {part}
            </span>
          );
        })}{" "}
      </>
    );
  };

  const bookVoices = book
    ? voices.filter(
        (v) =>
          v.locale.toLowerCase().startsWith(`${book.language}-`) ||
          v.short_name === selectedVoice
      )
    : [];

  const stepFontSize = (delta: number) => {
    const order: FontSize[] = ["sm", "base", "lg", "xl"];
    const curIdx = order.indexOf(fontSize);
    const nextIdx = Math.max(0, Math.min(order.length - 1, curIdx + delta));
    const next = order[nextIdx];
    setFontSize(next);
    savePreferences({ font_size: next });
  };

  const narrator = personaName(selectedVoice, voices, t);

  const bookProgressPct =
    book && book.total_chapters > 0 && currentChapterIdx !== null
      ? Math.min(100, Math.round(((currentChapterIdx + 1) / book.total_chapters) * 100))
      : 0;

  const toggleTranslation = () => {
    const next = !showTranslation;
    setShowTranslation(next);
    savePreferences({ show_translation: next });
  };

  const translationPanelVisible = translationEnabled && showTranslation && !!chapter;
  const chapterTranslations = currentChapterIdx !== null ? translations[currentChapterIdx] : undefined;
  const activeTranslation =
    activeSentenceIdx >= 0 ? chapterTranslations?.[activeSentenceIdx] ?? null : null;
  let translationMessage: string | null = null;
  if (!chapterTranslations) {
    translationMessage =
      currentChapterIdx !== null && translationFailed[currentChapterIdx]
        ? offlineMode
          ? t.reader.offlineTranslationMissing
          : t.reader.pageTranslationFailed
        : t.reader.translating;
  } else if (activeSentenceIdx < 0) {
    translationMessage = t.reader.tapSentence;
  } else if (!activeTranslation) {
    translationMessage = offlineMode ? t.reader.offlineTranslationMissing : t.reader.sentenceTranslationFailed;
  }

  return (
    <div className={`min-h-screen flex flex-col ${translationPanelVisible ? "pb-64" : "pb-36"}`}>
      {/* Barra superior de lectura */}
      <div className="sticky top-0 z-30 p-4 pb-0 pointer-events-none">
        <header
          className="glass pointer-events-auto page-width mx-auto rounded-[22px] px-2.5 pt-0 pb-2 relative"
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
                <span>{t.nav.library}</span>
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
                <span>{t.reader.contents}</span>
              </button>
            </div>

            <div className="flex-initial min-w-0 text-center px-2">
              <p className="m-0 text-sm font-medium truncate max-w-sm" style={{ color: "var(--ink)" }}>
                {book?.title || t.common.loading}
              </p>
              <p className="m-0 text-xs tabular-nums truncate" style={{ color: "var(--muted)" }}>
                {t.common.pageOf(currentChapterIdx !== null ? currentChapterIdx + 1 : 1, book?.total_chapters || 1)}
                {chapter?.title ? ` · ${chapter.title}` : ""}
              </p>
            </div>

            <div className="flex-1 min-w-0 flex items-center justify-end gap-1">
              <OfflineBadge />
              {translationEnabled && (
                <button
                  type="button"
                  onClick={toggleTranslation}
                  aria-pressed={showTranslation}
                  aria-label={showTranslation ? t.reader.hideTranslation : t.reader.showTranslation}
                  title={showTranslation ? t.reader.hideTranslation : t.reader.showTranslation}
                  className="quiet inline-flex items-center justify-center w-10 h-10 rounded-full border-0 cursor-pointer"
                  style={{
                    background: showTranslation ? "var(--hover)" : "transparent",
                    color: showTranslation ? "var(--ink)" : "var(--muted)",
                  }}
                >
                  <Languages className="w-[18px] h-[18px]" strokeWidth={1.6} />
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setIsAaOpen((prev) => !prev);
                  setIsTocOpen(false);
                }}
                aria-expanded={isAaOpen}
                aria-label={t.reader.textAppearance}
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
                aria-label={t.nav.settings}
                className="quiet inline-flex items-center justify-center w-10 h-10 rounded-full no-underline"
                style={{ color: "var(--muted)" }}
              >
                <Settings className="w-[18px] h-[18px]" strokeWidth={1.6} />
              </Link>
            </div>
          </div>

          <div
            role="progressbar"
            aria-label={t.reader.bookProgress}
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
          aria-label={t.reader.textAppearance}
          className="glass-strong fixed z-40 top-20 right-8 w-80 max-w-[calc(100%-48px)] p-[18px] rounded-[24px] box-border flex flex-col gap-4"
          style={{
            background: "var(--glass-menu)",
            boxShadow: "var(--ring-menu)",
          }}
        >
          <div>
            <p className="m-0 mb-2.5 text-[13px] font-medium" style={{ color: "var(--muted)" }}>
              {t.nav.theme}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {[
                {
                  id: "light" as Theme,
                  label: t.themes.light,
                  bg: "radial-gradient(60px 50px at 20% 20%, rgba(195, 205, 218, 0.6), rgba(195, 205, 218, 0)), radial-gradient(60px 50px at 90% 80%, rgba(165, 178, 192, 0.4), rgba(165, 178, 192, 0)), #f7f8fa",
                  ink: "#1a1d20",
                },
                {
                  id: "sepia" as Theme,
                  label: t.themes.sepia,
                  bg: "radial-gradient(60px 50px at 20% 20%, rgba(214, 185, 150, 0.6), rgba(214, 185, 150, 0)), radial-gradient(60px 50px at 90% 80%, rgba(175, 155, 130, 0.35), rgba(175, 155, 130, 0)), #f4eee4",
                  ink: "#3a2e20",
                },
                {
                  id: "dark" as Theme,
                  label: t.themes.dark,
                  bg: "radial-gradient(60px 50px at 20% 20%, rgba(154, 179, 207, 0.25), rgba(154, 179, 207, 0)), radial-gradient(60px 50px at 90% 80%, rgba(65, 76, 92, 0.45), rgba(65, 76, 92, 0)), #101216",
                  ink: "#e6e9ed",
                },
              ].map((option) => {
                const isActive = theme === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setTheme(option.id)}
                    aria-pressed={isActive}
                    className="p-0 border-0 bg-transparent cursor-pointer flex flex-col gap-1.5 items-stretch"
                  >
                    <span
                      className="h-14 rounded-2xl flex items-center justify-center font-serif text-xl"
                      style={{
                        background: option.bg,
                        color: option.ink,
                        boxShadow: isActive
                          ? "inset 0 0 0 1.5px var(--accent-border)"
                          : "inset 0 0 0 1px var(--track)",
                      }}
                    >
                      Aa
                    </span>
                    <span className="text-[13px] text-center" style={{ color: "var(--ink)" }}>
                      {option.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="m-0 mb-2.5 text-[13px] font-medium" style={{ color: "var(--muted)" }}>
              {t.settings.textSize}
            </p>
            <div
              className="flex items-center gap-2 p-1 rounded-full"
              style={{ background: "var(--glass-seg)" }}
            >
              <button
                type="button"
                onClick={() => stepFontSize(-1)}
                aria-label={t.reader.smallerText}
                className="quiet w-11 h-9 rounded-full border-0 font-serif text-sm cursor-pointer"
                style={{ color: "var(--ink)" }}
              >
                A−
              </button>
              <span className="flex-1 text-center text-[13px] font-medium tabular-nums" style={{ color: "var(--ink)" }}>
                {t.fontSizes[fontSize]} ({FONT_PX[fontSize]} px)
              </span>
              <button
                type="button"
                onClick={() => stepFontSize(1)}
                aria-label={t.reader.largerText}
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
            style={{ color: "var(--accent)" }}
          >
            {t.reader.modeAndSpeed}
          </Link>
        </div>
      )}

      {/* Popover Índice */}
      {isTocOpen && (
        <nav
          ref={tocRef}
          aria-label={t.reader.contentsLabel}
          className="glass-strong fixed z-40 top-20 left-8 w-[340px] max-w-[calc(100%-48px)] p-2.5 rounded-[24px] box-border max-h-[75vh] flex flex-col shadow-2xl"
          style={{
            background: "var(--glass-menu)",
            boxShadow: "var(--ring-menu)",
          }}
        >
          <div className="flex items-center justify-between p-2 pb-2.5">
            <h2 className="m-0 text-[15px] font-semibold" style={{ color: "var(--ink)" }}>
              {t.reader.contents}
            </h2>
            <span className="text-xs tabular-nums" style={{ color: "var(--muted)" }}>
              {t.common.pageCount(book?.total_chapters || 0)}
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
                    player.goToChapter(c.idx);
                    setIsTocOpen(false);
                  }}
                  className="w-full min-h-[44px] flex items-center gap-2.5 px-3 py-2 border-0 rounded-2xl text-left cursor-pointer transition text-sm"
                  style={{
                    background: isCurrent ? "var(--hl)" : "transparent",
                    color: isCurrent ? "var(--hl-ink)" : "var(--ink)",
                    fontWeight: isCurrent ? 600 : 400,
                  }}
                >
                  <span className="flex-1 truncate">
                    {c.title ? t.reader.pageWithSection(c.start_page, c.title) : t.reader.page(c.start_page)}
                  </span>
                  {c.has_audio && (
                    <Headphones className="w-3.5 h-3.5 shrink-0 text-[var(--accent)]" />
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
              className="glbtn glbtn-primary inline-flex items-center h-10 px-5 rounded-full text-xs font-semibold no-underline"
              style={{
                background: "var(--btn-primary)",
                color: "var(--btn-primary-ink)",
                boxShadow: "var(--ring-primary)",
              }}
            >
              {t.common.backToLibrary}
            </Link>
          </div>
        ) : !chapter ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3" style={{ color: "var(--muted)" }}>
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--accent)" }} />
            <span className="text-sm">{t.reader.loadingPage}</span>
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
              lang={book?.language}
              className="font-serif max-w-[33em] mx-auto text-left hyphens-auto select-text"
              style={FONT_STYLES[fontSize]}
            >
              <header className="mb-9 pb-4">
                {chapter.title && (
                  <p className="m-0 mb-1.5 font-sans text-[13px] tabular-nums" style={{ color: "var(--muted)" }}>
                    {t.reader.pageRange(chapter.start_page, chapter.end_page)}
                  </p>
                )}
                <h1 className="m-0 font-serif text-[38px] leading-[1.15] font-normal tracking-[-0.012em]" style={{ color: "var(--ink)" }}>
                  {chapter.title || t.reader.pageRange(chapter.start_page, chapter.end_page)}
                </h1>
              </header>

              <div className="space-y-4">
                {groupParagraphs(chapter.sentences).map((indices) => (
                  <p key={indices[0]} className="m-0">
                    {indices.map((idx) => {
                      const s = chapter.sentences[idx];
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
                                ? t.reader.wordHint
                                : t.reader.listenFrom((s.start as number).toFixed(1))
                              : t.reader.voiceLoading
                          }
                        >
                          {renderSentenceContent(s, idx)}
                        </span>
                      );
                    })}
                  </p>
                ))}
              </div>
            </article>
          </div>
        )}
      </main>

      {/* Reproductor fijo abajo */}
      <footer className="fixed bottom-5 left-0 right-0 z-30 px-4 pointer-events-none flex flex-col items-center gap-2">
        {translationPanelVisible && (
          <div
            aria-live="polite"
            className="glass-strong pointer-events-auto w-full dock-width rounded-[24px] px-5 py-3 max-h-[132px] overflow-y-auto box-border"
            style={{
              background: "var(--glass-dock)",
              boxShadow: "var(--shadow-dock)",
            }}
          >
            <p className="m-0 mb-1 text-[12px] font-medium" style={{ color: "var(--muted)" }}>
              {t.reader.translation(languageName(nativeLanguage as string, locale))}
            </p>
            {translationMessage ? (
              <p className="m-0 text-sm" style={{ color: "var(--muted)" }}>
                {translationMessage}
              </p>
            ) : (
              <p
                lang={nativeLanguage ?? undefined}
                className="m-0 font-serif text-[17px] leading-relaxed"
                style={{ color: "var(--ink)" }}
              >
                {activeTranslation}
              </p>
            )}
          </div>
        )}

        <div
          className="glass-strong pointer-events-auto w-full min-w-[736px] dock-width rounded-[30px] p-[10px] pl-2.5 pr-3.5 flex items-center gap-3"
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
                style={{ background: "var(--hl)", color: "var(--accent)" }}
              >
                {narrator.charAt(0).toUpperCase()}
              </span>
              <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                {narrator}
              </span>
              <ChevronDown className="w-3.5 h-3.5 opacity-60" style={{ color: "var(--ink)" }} />
            </div>
            <select
              value={selectedVoice || "es-MX-DaliaNeural"}
              onChange={(e) => player.changeVoice(e.target.value)}
              aria-label={t.reader.narratorLabel(narrator)}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            >
              {bookVoices.map((v) => (
                <option
                  key={v.short_name}
                  value={v.short_name}
                  className="bg-white text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  {voiceLabel(v, locale, t)}
                </option>
              ))}
            </select>
          </div>

          {/* 2. Controles de transporte */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              disabled={currentChapterIdx === null || currentChapterIdx <= 0}
              onClick={() => {
                if (currentChapterIdx !== null) player.goToChapter(currentChapterIdx - 1);
              }}
              aria-label={t.reader.previousPage}
              className="quiet w-11 h-11 rounded-full flex items-center justify-center border-0 disabled:opacity-30 cursor-pointer transition"
              style={{ color: "var(--ink)" }}
            >
              <ChevronLeft className="w-5 h-5" strokeWidth={1.7} />
            </button>

            <button
              type="button"
              disabled={!audioUrl}
              onClick={() => seekRelative(-10)}
              aria-label={t.reader.back10}
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
              aria-label={isPlaying ? t.reader.pause : t.reader.play}
              className="glbtn glbtn-primary w-[52px] h-[52px] rounded-full border-0 flex items-center justify-center cursor-pointer disabled:opacity-40"
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
              aria-label={t.reader.forward10}
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
              onClick={() => {
                if (currentChapterIdx !== null) player.goToChapter(currentChapterIdx + 1);
              }}
              aria-label={t.reader.nextPage}
              className="quiet w-11 h-11 rounded-full flex items-center justify-center border-0 disabled:opacity-30 cursor-pointer transition"
              style={{ color: "var(--ink)" }}
            >
              <ChevronRight className="w-5 h-5" strokeWidth={1.7} />
            </button>
          </div>

          {/* 3. Línea de tiempo con 5 segmentos */}
          <div className="flex-1 min-w-[200px] flex flex-col gap-1.5 px-1">
            {voiceUnavailable ? (
              <p className="m-0 py-1 text-xs font-medium text-center" style={{ color: "var(--muted)" }}>
                {t.reader.offlineVoicesMissing}
              </p>
            ) : !audioUrl && isSynthesizing ? (
              <div className="flex items-center justify-center gap-2 py-1 text-xs font-medium" style={{ color: "var(--muted)" }}>
                <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--muted)" }} />
                <span>{t.reader.loadingVoicePart(Math.max(1, loadedParts), TOTAL_PARTS)}</span>
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
                    onChange={(e) => player.seekTo(parseFloat(e.target.value))}
                    aria-label={t.reader.position}
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
                      ? t.reader.preparingVoice(Math.max(1, loadedParts), TOTAL_PARTS)
                      : t.reader.voiceReady}
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
              onChange={(e) => player.changeSpeed(parseFloat(e.target.value))}
              aria-label={t.reader.playbackSpeed(playbackSpeed)}
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
  const { t } = useI18n();
  return (
    <Suspense
      fallback={
        <div
          className="min-h-screen flex items-center justify-center gap-3"
          style={{ color: "var(--muted)" }}
        >
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--accent)" }} />
          <span className="text-sm" style={{ color: "var(--muted)" }}>
            {t.reader.loading}
          </span>
        </div>
      }
    >
      <ReaderContent />
    </Suspense>
  );
}
