"use client";

import React, { useState } from "react";
import Link from "next/link";
import { api, BookSummary, VoiceItem, getBaseUrl, withTokenUrl } from "@/lib/api";
import { BookOpen, Trash2, User } from "lucide-react";

interface BookCardProps {
  book: BookSummary;
  voices: VoiceItem[];
  onDelete: (id: string) => void;
  onVoiceChange?: (bookId: string, newVoice: string) => void;
}

export function BookCard({ book, voices, onDelete, onVoiceChange }: BookCardProps) {
  const [selectedVoice, setSelectedVoice] = useState(book.voice || "es-MX-DaliaNeural");

  const progressPct =
    book.total_chapters > 0
      ? Math.round(((book.current_chapter_idx + 1) / book.total_chapters) * 100)
      : 0;
  const coverSrc = book.cover_url ? withTokenUrl(`${getBaseUrl()}${book.cover_url}`) : null;

  const handleSelectVoice = async (newVoice: string) => {
    setSelectedVoice(newVoice);
    await api.updateSettings(book.id, newVoice, book.speed).catch(console.error);
    if (onVoiceChange) onVoiceChange(book.id, newVoice);
  };

  return (
    <div className="group relative flex flex-col bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition">
      <Link href={`/reader?id=${book.id}`} className="block relative aspect-[3/4] bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
        {coverSrc ? (
          <img
            src={coverSrc}
            alt={book.title}
            className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-zinc-400 p-4 text-center">
            <BookOpen className="w-12 h-12 mb-2 stroke-[1.5]" />
            <span className="text-xs font-medium">Sin portada</span>
          </div>
        )}

        {/* Barra de progreso visual sobre la portada */}
        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/20 backdrop-blur-sm">
          <div
            className="h-full bg-amber-500 transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </Link>

      <div className="p-4 flex-1 flex flex-col justify-between gap-3">
        <div>
          <Link href={`/reader?id=${book.id}`} className="hover:text-amber-600 transition">
            <h4 className="font-semibold text-base line-clamp-1" title={book.title}>
              {book.title}
            </h4>
          </Link>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-1 mt-0.5">
            {book.author}
          </p>
        </div>

        {/* Selector de Persona / Narrador directamente antes de abrir el libro */}
        {voices.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-zinc-400 flex items-center gap-1">
              <User className="w-3 h-3 text-amber-500" />
              <span>Persona:</span>
            </label>
            <select
              value={selectedVoice}
              onChange={(e) => handleSelectVoice(e.target.value)}
              className="w-full text-[11px] font-medium bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer truncate"
              title="Cambiar la persona que narra este libro"
            >
              {voices.map((v) => (
                <option key={v.short_name} value={v.short_name}>
                  {v.friendly_name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center justify-between text-xs text-zinc-400 border-t border-zinc-100 dark:border-zinc-800 pt-2.5">
          <span>
            Pág. {book.current_chapter_idx + 1} de {book.total_chapters}
          </span>
          <button
            onClick={(e) => {
              e.preventDefault();
              if (confirm(`¿Eliminar "${book.title}" de tu biblioteca?`)) {
                onDelete(book.id);
              }
            }}
            className="p-1 rounded-md text-zinc-400 hover:text-red-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
            title="Eliminar libro"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
