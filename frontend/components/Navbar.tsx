"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, Plus, Moon, Sun, Coffee } from "lucide-react";

interface NavbarProps {
  onOpenUpload?: () => void;
}

export type Theme = "light" | "sepia" | "dark";

export function Navbar({ onOpenUpload }: NavbarProps) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const saved = (localStorage.getItem("letha_theme") as Theme) || "light";
    setTheme(saved);
    applyTheme(saved);
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

  return (
    <header className="sticky top-0 z-30 border-b backdrop-blur-md bg-white/80 dark:bg-zinc-900/80 dark:border-zinc-800 sepia-header border-zinc-200">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-bold text-xl tracking-tight">
          <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-sm">
            <BookOpen className="w-5 h-5" />
          </div>
          <span>Letha</span>
        </Link>

        <div className="flex items-center gap-3">
          <button
            onClick={cycleTheme}
            className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
            title={`Tema actual: ${theme}`}
          >
            {theme === "light" && <Sun className="w-4 h-4 text-amber-500" />}
            {theme === "sepia" && <Coffee className="w-4 h-4 text-amber-700" />}
            {theme === "dark" && <Moon className="w-4 h-4 text-indigo-400" />}
          </button>

          {onOpenUpload && (
            <button
              onClick={onOpenUpload}
              className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-xl shadow-sm transition"
            >
              <Plus className="w-4 h-4" />
              <span>Importar PDF</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
