"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { BookCard } from "@/components/BookCard";
import { UploadModal } from "@/components/UploadModal";
import {
  api,
  BookSummary,
  VoiceItem,
  getBaseUrl,
} from "@/lib/api";
import { useOfflineMode } from "@/components/OfflineMode";
import { useI18n } from "@/lib/i18n";
import { personaName } from "@/lib/voices";
import {
  BookOpen,
  ChevronDown,
  Loader2,
  Play,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";

const COVER_PALETTES = [
  { bg: "#2f4a3a", ink: "#efe9dc" },
  { bg: "#1f2326", ink: "#e9e6df" },
  { bg: "#6b2430", ink: "#f1e6e0" },
  { bg: "#c9b98f", ink: "#2a241a" },
  { bg: "#8f9aa0", ink: "#1d2124" },
  { bg: "#3b5568", ink: "#eef0ee" },
  { bg: "#d9d3c4", ink: "#2b2a26" },
  { bg: "#b8a24f", ink: "#231f12" },
  { bg: "#5b4a3f", ink: "#efe6da" },
];

type FilterKey = "all" | "inprogress" | "notstarted";

function pickCoverPalette(id: string) {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return COVER_PALETTES[sum % COVER_PALETTES.length];
}

function isStarted(b: BookSummary): boolean {
  return b.current_chapter_idx > 0 || b.current_sentence_idx > 0;
}

function pageInfo(b: BookSummary) {
  const total = Math.max(1, b.total_chapters || b.total_pages);
  const current = Math.min(Math.max(1, b.current_chapter_idx + 1), total);
  const pct = isStarted(b) ? Math.min(100, Math.round((current / total) * 100)) : 0;
  return { current, total, pct };
}

export default function HomePage() {
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [voices, setVoices] = useState<VoiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const [isDraggingAdd, setIsDraggingAdd] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  const [continueSentenceText, setContinueSentenceText] = useState<string | null>(null);
  const [lastBookId, setLastBookId] = useState<string | null>(null);
  const [columns, setColumns] = useState(1);
  const [rows, setRows] = useState(1);
  const addInputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const { t, locale } = useI18n();
  const { offlineMode } = useOfflineMode();
  const offlineModeSeenRef = useRef(offlineMode);

  const loadBooks = async () => {
    try {
      setLoading(true);
      const data = await api.getBooks();
      setBooks(data);
    } catch (err) {
      console.error("Error al cargar libros:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (offlineModeSeenRef.current === offlineMode) return;
    offlineModeSeenRef.current = offlineMode;
    api.getBooks().then(setBooks).catch(console.error);
    api.getVoices().then(setVoices).catch(console.error);
  }, [offlineMode]);

  useEffect(() => {
    loadBooks();
    api.getVoices().then(setVoices).catch(console.error);
    api
      .getAppSettings()
      .then((s) => setLastBookId(s.last_book_id))
      .catch(console.error);
  }, []);

  const handleDelete = async (id: string) => {
    try {
      await api.deleteBook(id);
      setBooks((prev) => prev.filter((b) => b.id !== id));
    } catch (err) {
      console.error("Error al eliminar libro:", err);
    }
  };

  const handleVoiceChange = (bookId: string, newVoice: string) => {
    setBooks((prev) => prev.map((b) => (b.id === bookId ? { ...b, voice: newVoice } : b)));
  };

  const continueBook = useMemo(() => {
    if (books.length === 0) return null;
    // 1. Libro con progreso de cap?tulos
    const withChapter = books.find((b) => b.current_chapter_idx >= 1);
    if (withChapter) return withChapter;
    // 2. Libro iniciado
    const started = books.find(isStarted);
    if (started) return started;
    // 3. Último libro abierto
    const lastOpened = lastBookId ? books.find((b) => b.id === lastBookId) : undefined;
    if (lastOpened) return lastOpened;
    // 4. Libro le?do recientemente seg?n el backend
    const recent = books.find((b) => b.last_read_at && b.last_read_at > b.created_at);
    if (recent) return recent;
    return null;
  }, [books, lastBookId]);

  useEffect(() => {
    if (!continueBook) {
      setContinueSentenceText(null);
      return;
    }
    let ignore = false;
    api
      .getChapter(
        continueBook.id,
        continueBook.current_chapter_idx,
        continueBook.voice || "es-MX-DaliaNeural"
      )
      .then((ch) => {
        if (ignore) return;
        const s = ch.sentences?.[continueBook.current_sentence_idx]?.text;
        setContinueSentenceText(s || null);
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, [continueBook]);

  const continueInfo = continueBook ? pageInfo(continueBook) : null;
  const continuePalette = continueBook ? pickCoverPalette(continueBook.id) : null;
  const continuePersona = personaName(continueBook?.voice, voices, t);

  const otherInProgress = useMemo(() => {
    if (!continueBook) return books.filter(isStarted).slice(0, 2);
    return books.filter((b) => b.id !== continueBook.id && isStarted(b)).slice(0, 2);
  }, [books, continueBook]);

  const totalPages = useMemo(
    () => books.reduce((acc, b) => acc + (b.total_pages || 0), 0),
    [books]
  );

  const counts = useMemo(
    () => ({
      all: books.length,
      inprogress: books.filter(isStarted).length,
      notstarted: books.filter((b) => !isStarted(b)).length,
    }),
    [books]
  );

  const filteredBooks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return books.filter((b) => {
      if (filter === "inprogress" && !isStarted(b)) return false;
      if (filter === "notstarted" && isStarted(b)) return false;
      if (!q) return true;
      return b.title.toLowerCase().includes(q) || (b.author || "").toLowerCase().includes(q);
    });
  }, [books, filter, query]);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => setColumns(getComputedStyle(grid).gridTemplateColumns.split(" ").length);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [loading]);

  useEffect(() => {
    setRows(1);
  }, [filter, query]);

  const visibleCount = Math.max(1, rows * columns - 1);
  const visibleBooks = filteredBooks.slice(0, visibleCount);

  const openUploadWithFile = (f: File | null) => {
    setDroppedFile(f);
    setIsUploadOpen(true);
  };

  const handleAddDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingAdd(false);
    const f = e.dataTransfer.files?.[0];
    if (f && f.name.toLowerCase().endsWith(".pdf")) openUploadWithFile(f);
  };

  const filterTabs: { key: FilterKey; label: string; count: number }[] = [
    { key: "all", label: t.library.filterAll, count: counts.all },
    { key: "inprogress", label: t.library.filterInProgress, count: counts.inprogress },
    { key: "notstarted", label: t.library.filterNotStarted, count: counts.notstarted },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar onOpenUpload={() => openUploadWithFile(null)} />

      <main className="flex-1 w-full page-width mx-auto px-6 pt-14 pb-28 box-border">
        {/* Encabezado */}
        <section
          aria-labelledby="header-title"
          className="flex flex-wrap items-end justify-between gap-6 pb-10"
        >
          <div className="flex-1 min-w-[320px]">
            <h1
              id="header-title"
              className="m-0 font-serif text-[48px] leading-[1.1] font-normal tracking-[-0.018em] max-w-[860px]"
              style={{ color: "var(--ink)" }}
            >
              {continueBook && continueInfo
                ? t.library.resumeTitle(continueInfo.current, continueBook.title)
                : t.library.title}
            </h1>
            <p className="m-0 mt-3.5 text-base" style={{ color: "var(--muted)" }}>
              {t.library.subtitle}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span
              className="glass inline-flex items-center gap-2 h-10 px-4 py-0 rounded-full text-[13px] font-medium whitespace-nowrap"
              style={{
                background: "var(--glass-seg)",
                boxShadow: "var(--ring-seg)",
                color: "var(--ink)",
              }}
            >
              <Sparkles className="w-4 h-4 text-[var(--accent)]" strokeWidth={1.6} />
              <span>{t.library.engine}</span>
            </span>

            <dl
              className="glass m-0 flex rounded-[20px] overflow-hidden"
              style={{
                background: "var(--glass-sub)",
                boxShadow: "var(--ring-sub)",
              }}
            >
              <div className="px-5 py-2.5">
                <dt className="text-xs font-medium" style={{ color: "var(--muted)" }}>
                  {t.library.books}
                </dt>
                <dd className="m-0 mt-0.5 text-[22px] leading-[1.2] font-semibold tabular-nums" style={{ color: "var(--ink)" }}>
                  {books.length}
                </dd>
              </div>
              <div
                className="px-5 py-2.5"
                style={{ boxShadow: "inset 1px 0 0 var(--track)" }}
              >
                <dt className="text-xs font-medium" style={{ color: "var(--muted)" }}>
                  {t.library.pages}
                </dt>
                <dd className="m-0 mt-0.5 text-[22px] leading-[1.2] font-semibold tabular-nums" style={{ color: "var(--ink)" }}>
                  {totalPages.toLocaleString(locale)}
                </dd>
              </div>
            </dl>
          </div>
        </section>

        {/* Continuar escuchando */}
        {continueBook && continueInfo && continuePalette && (
          <section
            aria-label={t.library.continueListening}
            className="animate-rise-gradient glass-strong rounded-[30px] p-8 flex flex-wrap gap-9 items-stretch mt-4 mb-16"
            style={{
              background: "var(--glass-panel)",
              boxShadow: "var(--ring-panel)",
            }}
          >
            <Link
              href={`/reader?id=${continueBook.id}`}
              className="cover-card block shrink-0 w-[184px] h-[276px] rounded-[8px] overflow-hidden relative no-underline p-[18px] pl-[22px] flex flex-col justify-between box-border"
              style={{
                backgroundColor: continuePalette.bg,
                color: continuePalette.ink,
                boxShadow: "var(--shadow-hero-cover)",
              }}
              aria-label={t.library.open(continueBook.title)}
            >
              {continueBook.cover_url ? (
                <img
                  src={`${getBaseUrl()}${continueBook.cover_url}`}
                  alt={continueBook.title}
                  className="w-full h-full object-cover absolute inset-0"
                />
              ) : (
                <>
                  <span className="text-[11px] font-medium tracking-[0.01em] line-clamp-1">
                    {continueBook.author || t.common.unknownAuthor}
                  </span>
                  <span className="font-serif text-[24px] leading-[1.12] line-clamp-4">
                    {continueBook.title}
                  </span>
                </>
              )}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[8px]"
                style={{
                  background:
                    "linear-gradient(155deg, rgba(255, 255, 255, 0.34) 0%, rgba(255, 255, 255, 0) 38%), linear-gradient(90deg, rgba(0, 0, 0, 0.16) 0px, rgba(0, 0, 0, 0) 12px)",
                }}
              />
            </Link>

            <div className="flex-1 min-w-[280px] flex flex-col justify-center gap-5">
              <div>
                <h2 className="m-0 text-[15px] font-semibold" style={{ color: "var(--ink)" }}>
                  {continueBook.title}
                </h2>
                <p className="m-0 mt-0.5 text-sm" style={{ color: "var(--muted)" }}>
                  {continueBook.author || t.common.unknownAuthor} · {t.library.narratedBy(continuePersona)}
                </p>
              </div>

              {continueSentenceText && (
                <figure className="m-0">
                  <figcaption className="text-[13px]" style={{ color: "var(--muted)" }}>
                    {t.library.leftOff}
                  </figcaption>
                  <blockquote className="m-0 mt-2 font-serif text-[23px] leading-[1.6] max-w-[640px]">
                    <span
                      className="rounded-[6px] px-1.5 py-0.5"
                      style={{
                        background: "var(--hl)",
                        color: "var(--hl-ink)",
                        WebkitBoxDecorationBreak: "clone",
                        boxDecorationBreak: "clone",
                      }}
                    >
                      {continueSentenceText}
                    </span>
                  </blockquote>
                </figure>
              )}

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Link
                  href={`/reader?id=${continueBook.id}`}
                  className="glbtn glbtn-primary inline-flex items-center gap-3 h-12 pr-[22px] pl-2 rounded-full font-medium text-[15px] no-underline"
                  style={{
                    background: "var(--btn-primary)",
                    boxShadow: "var(--ring-primary)",
                    color: "var(--btn-primary-ink)",
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="w-[34px] h-[34px] rounded-full flex items-center justify-center"
                    style={{ background: "var(--icon-chip)" }}
                  >
                    <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                  </span>
                  <span>{t.library.resumeAt(continueInfo.current)}</span>
                </Link>

                <Link
                  href={`/reader?id=${continueBook.id}`}
                  className="glbtn glbtn-ghost inline-flex items-center gap-2 h-12 px-[18px] rounded-full font-medium text-[15px] no-underline"
                  style={{
                    background: "var(--btn-ghost)",
                    boxShadow: "var(--ring-ghost)",
                    color: "var(--ink)",
                  }}
                >
                  <BookOpen className="w-[17px] h-[17px]" strokeWidth={1.6} />
                  <span>{t.library.openReader}</span>
                </Link>

                <div className="flex-1 min-w-[160px] flex flex-col gap-1.5">
                  <div
                    role="progressbar"
                    aria-label={t.library.progressOf(continueBook.title)}
                    aria-valuenow={continueInfo.pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="h-1 rounded-full overflow-hidden w-full"
                    style={{ background: "var(--track)" }}
                  >
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{ width: `${continueInfo.pct}%`, background: "var(--fill)" }}
                    />
                  </div>
                  <span className="text-[13px] tabular-nums" style={{ color: "var(--muted)" }}>
                    {t.common.pageOf(continueInfo.current, continueInfo.total)} · {continueInfo.pct}%
                  </span>
                </div>
              </div>
            </div>

            {otherInProgress.length > 0 && (
              <aside
                aria-label={t.library.alsoInProgress}
                className="shrink-0 w-[260px] max-w-full flex flex-col gap-1 p-4 rounded-[22px]"
                style={{
                  background: "var(--glass-sub)",
                  boxShadow: "var(--ring-sub)",
                }}
              >
                <h3 className="m-0 mx-1 mb-2 text-sm font-semibold" style={{ color: "var(--ink)" }}>
                  {t.library.alsoInProgress}
                </h3>
                {otherInProgress.map((b) => {
                  const bInfo = pageInfo(b);
                  const bPal = pickCoverPalette(b.id);
                  return (
                    <Link
                      key={b.id}
                      href={`/reader?id=${b.id}`}
                      className="row-link flex gap-3.5 items-center p-2 rounded-[14px] no-underline"
                    >
                      <div
                        className="shrink-0 w-[38px] h-[57px] rounded-[4px] relative overflow-hidden"
                        style={{
                          backgroundColor: bPal.bg,
                          boxShadow: "var(--shadow-cover)",
                        }}
                      >
                        {b.cover_url ? (
                          <img
                            src={`${getBaseUrl()}${b.cover_url}`}
                            alt={b.title}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div
                            aria-hidden="true"
                            className="w-full h-full"
                            style={{
                              background:
                                "linear-gradient(155deg, rgba(255, 255, 255, 0.34) 0%, rgba(255, 255, 255, 0) 45%)",
                            }}
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col gap-1">
                        <span className="text-sm font-medium leading-[1.3] truncate" style={{ color: "var(--ink)" }}>
                          {b.title}
                        </span>
                        <div
                          className="h-[3px] rounded-full overflow-hidden w-full"
                          style={{ background: "var(--track)" }}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${bInfo.pct}%`, background: "var(--fill)" }}
                          />
                        </div>
                        <span className="text-xs tabular-nums" style={{ color: "var(--muted)" }}>
                          {t.common.pageOf(bInfo.current, bInfo.total)} · {bInfo.pct}%
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </aside>
            )}
          </section>
        )}

        {/* Todos los libros */}
        <section aria-labelledby="all-books-title" className="mt-12">
          <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
            <h2
              id="all-books-title"
              className="m-0 font-serif text-[30px] leading-[1.2] font-normal tracking-[-0.01em]"
              style={{ color: "var(--ink)" }}
            >
              {t.library.allBooks}
            </h2>

            <div className="flex flex-wrap items-center gap-3">
              <div
                role="tablist"
                aria-label={t.library.filterBooks}
                className="glass flex gap-0.5 p-1 rounded-full"
                style={{
                  background: "var(--glass-seg)",
                  boxShadow: "var(--ring-seg)",
                }}
              >
                {filterTabs.map((t) => {
                  const active = filter === t.key;
                  return (
                    <button
                      key={t.key}
                      role="tab"
                      aria-selected={active}
                      onClick={() => setFilter(t.key)}
                      className={`h-[34px] px-3.5 rounded-full border-0 text-sm font-medium cursor-pointer transition ${
                        active ? "" : "quiet text-[var(--soft)]"
                      }`}
                      style={{
                        background: active ? "var(--glass-seg-on)" : "transparent",
                        boxShadow: active ? "var(--shadow-seg-on)" : "none",
                        color: active ? "var(--ink)" : "var(--soft)",
                      }}
                    >
                      {t.label} <span className="tabular-nums" style={{ color: "var(--muted)" }}>{t.count}</span>
                    </button>
                  );
                })}
              </div>

              <div className="relative w-[260px] max-w-full">
                <label htmlFor="search-books" className="sr-only">
                  {t.library.searchBooks}
                </label>
                <Search
                  className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: "var(--soft)" }}
                  aria-hidden="true"
                />
                <input
                  id="search-books"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t.library.searchPlaceholder}
                  className="glass w-full h-[42px] pl-10 pr-3.5 rounded-full border-0 text-sm focus:outline-none"
                  style={{
                    background: "var(--glass-seg)",
                    boxShadow: "var(--ring-input)",
                    color: "var(--ink)",
                  }}
                />
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3" style={{ color: "var(--muted)" }}>
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--muted)" }} />
              <span className="text-sm">{t.library.loading}</span>
            </div>
          ) : (
            <div
              ref={gridRef}
              className="grid gap-x-7 gap-y-11"
              style={{
                gridTemplateColumns:
                  "repeat(auto-fill, minmax(min(176px, calc(50% - 14px)), 1fr))",
              }}
            >
              {visibleBooks.map((book, idx) => (
                <div
                  key={book.id}
                  className="animate-rise-gradient flex flex-col"
                  style={{ animationDelay: `${(idx % columns) * 75}ms` }}
                >
                  <BookCard
                    book={book}
                    voices={voices}
                    onDelete={handleDelete}
                    onVoiceChange={handleVoiceChange}
                  />
                </div>
              ))}

              {/* Celda Añadir un libro */}
              <div
                role="button"
                tabIndex={0}
                aria-label={`${t.library.addBook}: ${t.library.addBookHint}`}
                onClick={() => addInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    addInputRef.current?.click();
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingAdd(true);
                }}
                onDragLeave={() => setIsDraggingAdd(false)}
                onDrop={handleAddDrop}
                className={`add-book-cell aspect-[2/3] box-border rounded-[8px] flex flex-col items-center justify-center gap-2.5 p-4 text-center cursor-pointer transition select-none ${
                  isDraggingAdd ? "is-dragging" : ""
                }`}
              >
                <input
                  ref={addInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) openUploadWithFile(f);
                    e.target.value = "";
                  }}
                />
                <Plus className="w-7 h-7" strokeWidth={1.5} />
                <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                  {t.library.addBook}
                </span>
                <span className="text-[13px] leading-[1.4]">
                  {t.library.addBookHint}
                </span>
              </div>
            </div>
          )}

          {!loading && filteredBooks.length > visibleCount && (
            <div className="flex justify-center mt-10">
              <button
                type="button"
                onClick={() => setRows((prev) => prev + 1)}
                className="glbtn glbtn-ghost inline-flex items-center gap-2 h-11 px-5 rounded-full border-0 text-[15px] font-medium cursor-pointer"
                style={{
                  background: "var(--btn-ghost)",
                  boxShadow: "var(--ring-ghost)",
                  color: "var(--ink)",
                }}
              >
                <span>{t.library.showMore}</span>
                <ChevronDown className="w-4 h-4" strokeWidth={1.7} />
              </button>
            </div>
          )}

          {!loading && filteredBooks.length === 0 && books.length > 0 && (
            <p className="text-sm mt-6" style={{ color: "var(--muted)" }}>
              {t.library.noMatches}
            </p>
          )}
        </section>
      </main>

      <UploadModal
        isOpen={isUploadOpen}
        initialFile={droppedFile}
        onClose={() => {
          setIsUploadOpen(false);
          setDroppedFile(null);
        }}
        onSuccess={loadBooks}
      />
    </div>
  );
}
