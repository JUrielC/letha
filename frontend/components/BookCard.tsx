"use client";

import React from "react";
import Link from "next/link";
import { BookSummary } from "@/lib/api";
import { BookOpen, Trash2 } from "lucide-react";

interface BookCardProps {
  book: BookSummary;
  onDelete: (id: string) => void;
}

export function BookCard({ book, onDelete }: BookCardProps) {
  const progressPct =
    book.total_chapters > 0
      ? Math.round(((book.current_chapter_idx + 1) / book.total_chapters) * 100)
      : 0;

  return (
    <div className="group relative flex flex-col bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition">
      <Link href={`/reader?id=${book.id}`} className="block relative aspect-[3/4] bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
        {book.cover_url ? (
          <img
            src={book.cover_url}
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

      <div className="p-4 flex-1 flex flex-col justify-between">
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

        <div className="mt-4 flex items-center justify-between text-xs text-zinc-400 border-t border-zinc-100 dark:border-zinc-800 pt-3">
          <span>
            Cap. {book.current_chapter_idx + 1} de {book.total_chapters}
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
