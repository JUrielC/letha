"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, BookSummary, VoiceItem, getBaseUrl } from "@/lib/api";
import { AudioLines, Check, MoreVertical, Trash2 } from "lucide-react";

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

const LANG_LABELS: Record<string, string> = {
  es: "Español",
  en: "English",
  fr: "Français",
  it: "Italiano",
  pt: "Português",
};

function pickCoverPalette(id: string) {
  let sum = 0;
  for (let i = 0; i < id.length; i++) {
    sum += id.charCodeAt(i);
  }
  return COVER_PALETTES[sum % COVER_PALETTES.length];
}

function extractPersona(friendlyName?: string, shortName?: string): string {
  if (friendlyName) {
    const parts = friendlyName.split(/\s*[—-]\s*/);
    if (parts[0]) return parts[0].trim();
  }
  if (!shortName) return "Narrador";
  const parts = shortName.split("-");
  const last = parts[parts.length - 1] || "";
  return last.replace("Neural", "");
}

interface BookCardProps {
  book: BookSummary;
  voices: VoiceItem[];
  onDelete: (id: string) => void;
  onVoiceChange?: (bookId: string, newVoice: string) => void;
}

export function BookCard({
  book,
  voices,
  onDelete,
  onVoiceChange,
}: BookCardProps) {
  const [selectedVoice, setSelectedVoice] = useState(
    book.voice || "es-MX-DaliaNeural"
  );
  const [imgFailed, setImgFailed] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showVoicePicker, setShowVoicePicker] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const bookVoices = voices.filter(
    (v) =>
      v.locale.toLowerCase().startsWith(`${book.language}-`) ||
      v.short_name === selectedVoice
  );

  const matchedVoice = voices.find((v) => v.short_name === selectedVoice);
  const personaName = extractPersona(matchedVoice?.friendly_name, selectedVoice);
  const langLabel = LANG_LABELS[book.language] || book.language.toUpperCase();

  const totalPages = Math.max(1, book.total_chapters || book.total_pages);
  const currentPage = Math.min(
    Math.max(1, book.current_chapter_idx + 1),
    totalPages
  );
  const isStarted =
    book.current_chapter_idx > 0 || book.current_sentence_idx > 0;
  const isCompleted = currentPage >= totalPages && isStarted;
  const progressPct = !isStarted
    ? 0
    : isCompleted
    ? 100
    : Math.min(100, Math.round((currentPage / totalPages) * 100));

  const coverSrc =
    book.cover_url && !imgFailed ? `${getBaseUrl()}${book.cover_url}` : null;
  const palette = pickCoverPalette(book.id);

  const handleSelectVoice = async (newVoice: string) => {
    setSelectedVoice(newVoice);
    await api.updateSettings(book.id, newVoice, book.speed).catch(console.error);
    if (onVoiceChange) onVoiceChange(book.id, newVoice);
  };

  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
        setShowVoicePicker(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsMenuOpen(false);
        setShowVoicePicker(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

  return (
    <article className="relative flex flex-col gap-3.5 min-w-0">
      <Link
        href={`/reader?id=${book.id}`}
        aria-label={`Abrir ${book.title}`}
        className="cover-card group relative block aspect-[2/3] w-full overflow-hidden rounded-[8px] no-underline"
        style={{
          boxShadow: "var(--shadow-cover)",
          backgroundColor: palette.bg,
          color: palette.ink,
        }}
      >
        {coverSrc ? (
          <img
            src={coverSrc}
            alt={book.title}
            onError={() => setImgFailed(true)}
            className="w-full h-full object-cover transition duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="w-full h-full p-4 pl-5 flex flex-col justify-between box-border select-none">
            <span className="text-[11px] font-medium tracking-[0.01em] line-clamp-1">
              {book.author || "Autor desconocido"}
            </span>
            <span className="font-serif text-[21px] leading-[1.14] overflow-wrap-anywhere line-clamp-4">
              {book.title}
            </span>
          </div>
        )}

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[8px]"
          style={{
            background:
              "linear-gradient(155deg, rgba(255, 255, 255, 0.34) 0%, rgba(255, 255, 255, 0) 38%), linear-gradient(90deg, rgba(0, 0, 0, 0.14) 0px, rgba(0, 0, 0, 0) 10px)",
          }}
        />
      </Link>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3
              className="m-0 text-sm font-medium leading-[1.35] truncate"
              title={book.title}
              style={{ color: "var(--ink)" }}
            >
              {book.title}
            </h3>
            <p className="m-0 mt-0.5 text-[13px] truncate" style={{ color: "var(--muted)" }}>
              {langLabel} · {personaName}
            </p>
          </div>

          <button
            type="button"
            aria-label={`Más opciones para ${book.title}`}
            onClick={(e) => {
              e.preventDefault();
              setIsMenuOpen((prev) => !prev);
            }}
            className="quiet shrink-0 w-8 h-8 -mr-1.5 -mt-1 rounded-full flex items-center justify-center cursor-pointer border-0"
            style={{
              background: isMenuOpen ? "var(--menu-item-on)" : "transparent",
              color: "var(--soft)",
            }}
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        </div>

        {progressPct === 100 ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium tabular-nums" style={{ color: "var(--soft)" }}>
            <Check className="w-3.5 h-3.5 text-[var(--accent)]" strokeWidth={2.2} />
            <span>Leído · {totalPages} págs.</span>
          </span>
        ) : isStarted ? (
          <div className="flex flex-col gap-1 mt-0.5">
            <div
              role="progressbar"
              aria-label={`Progreso de ${book.title}`}
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-[3px] rounded-full overflow-hidden w-full"
              style={{ background: "var(--track)" }}
            >
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${progressPct}%`, background: "var(--fill)" }}
              />
            </div>
            <span className="text-xs tabular-nums" style={{ color: "var(--muted)" }}>
              Pág. {currentPage} de {totalPages} · {progressPct}%
            </span>
          </div>
        ) : (
          <span className="text-xs tabular-nums" style={{ color: "var(--muted)" }}>
            {totalPages} págs. · sin empezar
          </span>
        )}
      </div>

      {isMenuOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Opciones de ${book.title}`}
          className="glass-strong absolute z-20 right-[-8px] top-[calc(100%-48px)] w-[240px] p-1.5 rounded-[20px] box-border"
          style={{
            background: "var(--glass-menu)",
            boxShadow: "var(--ring-menu)",
          }}
        >
          <div className="relative">
            <button
              type="button"
              role="menuitem"
              onClick={() => setShowVoicePicker((prev) => !prev)}
              className="w-full flex items-center gap-2.5 h-10 px-2.5 border-0 rounded-[14px] text-left cursor-pointer transition"
              style={{
                background: showVoicePicker ? "var(--menu-item-on)" : "transparent",
                color: "var(--ink)",
                fontSize: "14px",
              }}
            >
              <AudioLines className="w-4 h-4 shrink-0" strokeWidth={1.7} />
              <span className="flex-1 truncate">Cambiar narrador</span>
              <span className="text-xs truncate max-w-[80px]" style={{ color: "var(--muted)" }}>
                {personaName}
              </span>
            </button>
            {showVoicePicker && (
              <div className="p-2 pt-1 border-t mt-1" style={{ borderColor: "var(--track)" }}>
                <select
                  value={selectedVoice}
                  onChange={(e) => {
                    handleSelectVoice(e.target.value);
                    setIsMenuOpen(false);
                    setShowVoicePicker(false);
                  }}
                  className="w-full h-9 text-xs rounded-xl px-2 border-0 text-[var(--ink)] focus:outline-none cursor-pointer"
                  style={{
                    background: "var(--glass-seg)",
                    boxShadow: "var(--ring-seg)",
                  }}
                  autoFocus
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
            )}
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsMenuOpen(false);
              if (confirm(`¿Eliminar "${book.title}" de tu biblioteca?`)) {
                onDelete(book.id);
              }
            }}
            className="quiet w-full flex items-center gap-2.5 h-10 px-2.5 border-0 rounded-[14px] text-left cursor-pointer"
            style={{
              background: "transparent",
              color: "var(--danger)",
              fontSize: "14px",
            }}
          >
            <Trash2 className="w-4 h-4 shrink-0" strokeWidth={1.7} />
            <span>Quitar de la biblioteca</span>
          </button>
        </div>
      )}
    </article>
  );
}
