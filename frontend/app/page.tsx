"use client";

import React, { useEffect, useState } from "react";
import { Navbar } from "@/components/Navbar";
import { BookCard } from "@/components/BookCard";
import { UploadModal } from "@/components/UploadModal";
import { api, BookSummary } from "@/lib/api";
import { BookPlus, Loader2, Sparkles } from "lucide-react";

export default function HomePage() {
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [isUploadOpen, setIsUploadOpen] = useState(false);

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
  }, []);

  const handleDelete = async (id: string) => {
    try {
      await api.deleteBook(id);
      setBooks((prev) => prev.filter((b) => b.id !== id));
    } catch (err) {
      console.error("Error al eliminar libro:", err);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar onOpenUpload={() => setIsUploadOpen(true)} />

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Tu Biblioteca</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              Lee tus libros o escúchalos narrados con voces neurales sincronizadas palabra por palabra.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 w-fit">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Motor Neural Edge-TTS</span>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-zinc-400 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
            <span className="text-sm">Cargando biblioteca...</span>
          </div>
        ) : books.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
            {books.map((book) => (
              <BookCard key={book.id} book={book} onDelete={handleDelete} />
            ))}
          </div>
        ) : (
          <div className="border border-dashed border-zinc-300 dark:border-zinc-800 rounded-3xl p-12 flex flex-col items-center justify-center text-center max-w-lg mx-auto mt-12">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center mb-4">
              <BookPlus className="w-8 h-8 stroke-[1.5]" />
            </div>
            <h3 className="text-lg font-bold mb-1">Aún no tienes libros</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
              Importa un archivo PDF para comenzar a leer y escuchar tus libros favoritos.
            </p>
            <button
              onClick={() => setIsUploadOpen(true)}
              className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl shadow-sm transition"
            >
              Importar mi primer PDF
            </button>
          </div>
        )}
      </main>

      <UploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onSuccess={loadBooks}
      />
    </div>
  );
}
