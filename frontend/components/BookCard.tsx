"use client";

import React, { useState } from "react";
import Link from "next/link";
import { api, BookSummary, VoiceItem, getBaseUrl } from "@/lib/api";
import { Play, Trash2 } from "lucide-react";

const GENERATED_COVER_COLORS = ["#1b2b44", "#0f3b5c", "#0b4f6c"];

function pickCoverBg(id: string): string {
  let sum = 0;
  for (let i = 0; i < id.length; i++) {
    sum += id.charCodeAt(i);
  }
  return GENERATED_COVER_COLORS[sum % GENERATED_COVER_COLORS.length];
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

  const currentPage = Math.min(
    Math.max(1, book.current_chapter_idx + 1),
    Math.max(1, book.total_chapters)
  );
  const totalPages = Math.max(1, book.total_chapters || book.total_pages);
  const progressPct =
    book.current_chapter_idx === 0 && book.current_sentence_idx === 0
      ? 0
      : Math.min(100, Math.round((currentPage / totalPages) * 100));

  const coverSrc =
    book.cover_url && !imgFailed ? `${getBaseUrl()}${book.cover_url}` : null;
  const generatedBg = pickCoverBg(book.id);

  const handleSelectVoice = async (newVoice: string) => {
    setSelectedVoice(newVoice);
    await api.updateSettings(book.id, newVoice, book.speed).catch(console.error);
    if (onVoiceChange) onVoiceChange(book.id, newVoice);
  };

  return (
    <div
      className="group relative flex flex-col p-5 transition-colors hover:bg-[#0e1d33] h-full"
      style={{
        borderRight: "1px solid var(--line)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      {/* Portada 2:3 */}
      <div
        className="relative aspect-[2/3] w-full overflow-hidden rounded-xl mb-4 border"
        style={{
          borderColor: "var(--line)",
          backgroundColor: generatedBg,
        }}
      >
        <Link href={`/reader?id=${book.id}`} className="block w-full h-full">
          {coverSrc ? (
            <img
              src={coverSrc}
              alt={book.title}
              onError={() => setImgFailed(true)}
              className="w-full h-full object-cover transition duration-300 group-hover:scale-[1.02]"
            />
          ) : (
            <div className="w-full h-full p-5 flex flex-col justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-[#64c7f5] line-clamp-1">
                {book.author || "Autor desconocido"}
              </span>
              <h4 className="text-lg font-extrabold leading-snug text-[#eaf1fa] line-clamp-4">
                {book.title}
              </h4>
              <span
                className="text-xs font-medium text-[#c3cfdd] pt-2 border-t"
                style={{ borderColor: "var(--line)" }}
              >
                {book.total_pages} pág.
              </span>
            </div>
          )}
        </Link>

        {/* Botón circular de 52px flotando en esquina inferior derecha */}
        <Link
          href={`/reader?id=${book.id}`}
          aria-label={`Abrir y leer ${book.title}`}
          className="absolute bottom-3 right-3 w-[52px] h-[52px] rounded-full flex items-center justify-center text-[#0a1729] transition hover:opacity-95"
          style={{
            background: "linear-gradient(135deg, #1ea7e8 0%, #64c7f5 100%)",
          }}
        >
          <Play className="w-5 h-5 fill-current ml-0.5" />
        </Link>
      </div>

      {/* Contenido inferior */}
      <div className="flex-1 flex flex-col justify-between gap-3">
        <div>
          <Link
            href={`/reader?id=${book.id}`}
            className="hover:text-[#64c7f5] transition"
          >
            <h3
              className="font-semibold text-base text-[#eaf1fa] line-clamp-1"
              title={book.title}
            >
              {book.title}
            </h3>
          </Link>
          <p className="text-xs text-[#93a3b8] line-clamp-1 mt-0.5">
            {book.author}
          </p>
        </div>

        {/* Pág. X / Y ...... Z% + barra de progreso de 2px */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-[#93a3b8] tabular-nums">
            <span>
              Pág. {currentPage} / {totalPages}
            </span>
            <span className="text-[#c3cfdd] font-semibold">{progressPct}%</span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={progressPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Progreso de ${book.title}`}
            className="w-full h-[2px] overflow-hidden"
            style={{ backgroundColor: "var(--line)" }}
          >
            <div
              className="h-full transition-all duration-300"
              style={{
                width: `${progressPct}%`,
                backgroundColor: "var(--accent)",
              }}
            />
          </div>
        </div>

        {/* Fila: [label "Voz" + select de voz a ancho completo] [botón de eliminar 44×44] */}
        <div
          className="flex items-end gap-2 pt-3 border-t"
          style={{ borderColor: "var(--line)" }}
        >
          <div className="flex-1 min-w-0">
            <label
              htmlFor={`voice-select-${book.id}`}
              className="block text-[11px] font-medium text-[#93a3b8] mb-1"
            >
              Voz
            </label>
            <select
              id={`voice-select-${book.id}`}
              value={selectedVoice}
              onChange={(e) => handleSelectVoice(e.target.value)}
              className="w-full h-[44px] text-xs font-medium bg-[#0a1729] text-[#eaf1fa] border rounded-lg px-2.5 focus:outline-none focus:border-[#1ea7e8] cursor-pointer truncate"
              style={{ borderColor: "var(--line-strong)" }}
              title="Cambiar la persona que narra este libro"
            >
              {voices.map((v) => (
                <option
                  key={v.short_name}
                  value={v.short_name}
                  className="bg-[#0a1729] text-[#eaf1fa]"
                >
                  {v.friendly_name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              if (confirm(`¿Eliminar "${book.title}" de tu biblioteca?`)) {
                onDelete(book.id);
              }
            }}
            aria-label={`Eliminar ${book.title}`}
            title="Eliminar libro"
            className="w-[44px] h-[44px] shrink-0 rounded-lg border flex items-center justify-center text-[#93a3b8] hover:text-red-400 hover:border-red-400/40 transition"
            style={{ borderColor: "var(--line-strong)" }}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
