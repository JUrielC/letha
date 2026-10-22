"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  BookOpen,
  Loader2,
  Play,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";

const GENERATED_COVER_COLORS = [
  "var(--cover-bg-1)",
  "var(--cover-bg-2)",
  "var(--cover-bg-3)",
];

type FilterKey = "all" | "inprogress" | "notstarted";

function pickCoverBg(id: string): string {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return GENERATED_COVER_COLORS[sum % GENERATED_COVER_COLORS.length];
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

function MiniCover({
  book,
  className,
  style,
}: {
  book: BookSummary;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [failed, setFailed] = useState(false);
  const src = book.cover_url && !failed ? `${getBaseUrl()}${book.cover_url}` : null;
  return (
    <div
      className={`overflow-hidden rounded-lg border shrink-0 ${className || ""}`}
      style={{ borderColor: "var(--line)", backgroundColor: pickCoverBg(book.id), ...style }}
    >
      {src ? (
        <img
          src={src}
          alt={book.title}
          onError={() => setFailed(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[#64c7f5]">
          <BookOpen className="w-1/3 h-1/3" />
        </div>
      )}
    </div>
  );
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
  const addInputRef = useRef<HTMLInputElement>(null);

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
    loadBooks();
    api.getVoices().then(setVoices).catch(console.error);
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

  const voiceName = useCallback(
    (shortName: string) => voices.find((v) => v.short_name === shortName)?.name || shortName,
    [voices]
  );

  // Último libro con progreso > 1 página (la lista ya viene ordenada por last_read_at)
  const continueBook = useMemo(
    () => books.find((b) => b.current_chapter_idx >= 1) || null,
    [books]
  );

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

  // ───────── Añadir libro (drag & drop) ─────────
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

  const continueInfo = continueBook ? pageInfo(continueBook) : null;

  const filterTabs: { key: FilterKey; label: string; count: number }[] = [
    { key: "all", label: "Todos", count: counts.all },
    { key: "inprogress", label: "En curso", count: counts.inprogress },
    { key: "notstarted", label: "Sin empezar", count: counts.notstarted },
  ];

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "var(--bg)" }}>
      <Navbar onOpenUpload={() => openUploadWithFile(null)} />

      <main className="flex-1 w-full max-w-[1320px] mx-auto px-[28px] pt-[72px] pb-16">
        {/* a) Encabezado */}
        <section className="flex flex-wrap items-end justify-between gap-6 pb-12">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#eaf1fa]">
              Tu Biblioteca
            </h1>
            <p className="text-sm text-[#c3cfdd] mt-1">
              Lee tus libros o escúchalos narrados con voces neurales sincronizadas palabra por palabra.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 text-xs font-semibold px-3.5 py-2 rounded-full bg-[#1ea7e8]/10 text-[#64c7f5] border border-[#1ea7e8]/25 w-fit">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Motor Neural Edge-TTS</span>
            </div>

            <dl
              className="flex border rounded-xl overflow-hidden"
              style={{ borderColor: "var(--line)" }}
            >
              {[
                { label: "LIBROS", value: books.length.toString() },
                { label: "PÁGINAS", value: totalPages.toLocaleString("es-MX") },
              ].map((stat, idx) => (
                <div
                  key={stat.label}
                  className={`px-5 py-3 ${idx === 0 ? "border-r" : ""}`}
                  style={{ borderColor: "var(--line)" }}
                >
                  <dt className="text-[11px] font-semibold text-[#93a3b8]">{stat.label}</dt>
                  <dd className="text-base font-bold text-[#eaf1fa] tabular-nums">{stat.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* b) Continuar escuchando */}
        {continueBook && continueInfo && (
          <section
            className="border-t py-12"
            style={{ borderColor: "var(--line)" }}
            aria-labelledby="continue-title"
          >
            <h2 id="continue-title" className="text-lg font-bold text-[#eaf1fa] mb-6">
              Continuar escuchando
            </h2>

            <div
              className="animate-rise-gradient flex flex-wrap gap-8 p-8 border rounded-2xl"
              style={{ backgroundColor: "var(--panel)", borderColor: "var(--line)" }}
            >
              <MiniCover book={continueBook} style={{ width: 168, height: 252 }} className="rounded-xl" />

              <div className="flex-1 min-w-[260px] flex flex-col justify-center gap-4">
                <div>
                  <h3 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#eaf1fa]">
                    {continueBook.title}
                  </h3>
                  <p className="text-sm text-[#c3cfdd] mt-1">
                    {continueBook.author} · narrado por {voiceName(continueBook.voice)}
                  </p>
                </div>

                <div className="space-y-2 max-w-xl">
                  <div className="flex items-center justify-between text-xs text-[#93a3b8] tabular-nums">
                    <span>
                      Pág. {continueInfo.current} de {continueInfo.total}
                    </span>
                    <span className="text-[#c3cfdd] font-semibold">{continueInfo.pct}%</span>
                  </div>
                  <div
                    role="progressbar"
                    aria-valuenow={continueInfo.pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Progreso de ${continueBook.title}`}
                    className="w-full h-[3px] overflow-hidden"
                    style={{ backgroundColor: "var(--line)" }}
                  >
                    <div
                      className="h-full"
                      style={{ width: `${continueInfo.pct}%`, backgroundColor: "var(--accent)" }}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 pt-1">
                  <Link
                    href={`/reader?id=${continueBook.id}`}
                    className="min-h-[44px] inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold transition hover:opacity-95"
                    style={{
                      background: "var(--primary-btn-bg)",
                      color: "var(--primary-btn-text)",
                    }}
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>Reanudar en pág. {continueInfo.current}</span>
                  </Link>
                  <Link
                    href={`/reader?id=${continueBook.id}`}
                    className="min-h-[44px] inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-[#eaf1fa] border transition hover:bg-[#0a1729]"
                    style={{ borderColor: "var(--line-strong)" }}
                  >
                    <BookOpen className="w-4 h-4" />
                    <span>Abrir lector</span>
                  </Link>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* c) Todos los libros */}
        <section
          className="border-t pt-12"
          style={{ borderColor: "var(--line)" }}
          aria-labelledby="all-books-title"
        >
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
            <h2 id="all-books-title" className="text-lg font-bold text-[#eaf1fa]">
              Todos los libros
            </h2>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div role="tablist" aria-label="Filtrar libros" className="flex flex-wrap gap-1.5">
                {filterTabs.map((t) => {
                  const active = filter === t.key;
                  return (
                    <button
                      key={t.key}
                      role="tab"
                      aria-selected={active}
                      onClick={() => setFilter(t.key)}
                      className={`min-h-[44px] px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition ${
                        active
                          ? "text-[#0a1729] border-transparent"
                          : "text-[#c3cfdd] hover:text-[#64c7f5]"
                      }`}
                      style={
                        active
                          ? {
                              background: "var(--primary-btn-bg)",
                              color: "var(--primary-btn-text)",
                            }
                          : { borderColor: "var(--line-strong)" }
                      }
                    >
                      {t.label} · {t.count}
                    </button>
                  );
                })}
              </div>

              <label className="relative block sm:w-64">
                <span className="sr-only">Buscar libros</span>
                <Search
                  className="w-4 h-4 text-[#93a3b8] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar por título o autor"
                  className="w-full min-h-[44px] pl-9 pr-3 text-sm rounded-xl border bg-transparent text-[#eaf1fa] placeholder:text-[#93a3b8] focus:outline-none focus:border-[#1ea7e8]"
                  style={{ borderColor: "var(--line-strong)" }}
                />
              </label>
            </div>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-24 text-[#93a3b8] gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-[#1ea7e8]" />
              <span className="text-sm">Cargando biblioteca...</span>
            </div>
          ) : (
            <div
              className="grid"
              style={{
                gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
                borderTop: "1px solid var(--line)",
                borderLeft: "1px solid var(--line)",
              }}
            >
              {filteredBooks.map((book, idx) => (
                <div
                  key={book.id}
                  className="animate-rise-gradient flex flex-col"
                  style={{ animationDelay: `${idx * 75}ms` }}
                >
                  <BookCard
                    book={book}
                    voices={voices}
                    onDelete={handleDelete}
                    onVoiceChange={handleVoiceChange}
                  />
                </div>
              ))}

              {/* Última celda: Añadir un libro */}
              <div
                role="button"
                tabIndex={0}
                aria-label="Añadir un libro: arrastra un PDF o haz clic para elegir un archivo"
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
                className={`min-h-[420px] flex flex-col items-center justify-center gap-4 p-6 text-center cursor-pointer transition-colors hover:bg-[#0e1d33] ${
                  isDraggingAdd ? "bg-[#0e1d33]" : ""
                }`}
                style={{
                  borderRight: "1px solid var(--line)",
                  borderBottom: "1px solid var(--line)",
                }}
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
                <div
                  className="w-16 h-16 rounded-full border-2 border-dashed flex items-center justify-center text-[#64c7f5]"
                  style={{ borderColor: isDraggingAdd ? "var(--accent)" : "var(--line-strong)" }}
                >
                  <Plus className="w-7 h-7" />
                </div>
                <div>
                  <p className="text-base font-semibold text-[#eaf1fa]">Añadir un libro</p>
                  <p className="text-xs text-[#93a3b8] mt-1">
                    Arrastra un PDF aquí o haz clic para elegir un archivo.
                  </p>
                </div>
              </div>
            </div>
          )}

          {!loading && filteredBooks.length === 0 && books.length > 0 && (
            <p className="text-sm text-[#93a3b8] mt-6">No hay libros que coincidan con el filtro.</p>
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
