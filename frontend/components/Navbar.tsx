"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Plus, Moon, Sun, Coffee, Settings, Library } from "lucide-react";

interface NavbarProps {
  onOpenUpload?: () => void;
}

export type Theme = "light" | "sepia" | "dark";

export function Navbar({ onOpenUpload }: NavbarProps) {
  const pathname = usePathname();
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const saved = (localStorage.getItem("letha_ui_theme") as Theme) || "dark";
    setTheme(saved);
    applyTheme(saved);
  }, []);

  const applyTheme = (t: Theme) => {
    document.documentElement.classList.toggle("dark", t === "dark");
    document.body.classList.remove("theme-sepia", "theme-dark");
    if (t === "sepia") document.body.classList.add("theme-sepia");
    if (t === "dark") document.body.classList.add("theme-dark");
    localStorage.setItem("letha_ui_theme", t);
  };

  const cycleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : theme === "light" ? "sepia" : "dark";
    setTheme(next);
    applyTheme(next);
  };

  const isSettingsPage = pathname?.startsWith("/settings");

  return (
    <header
      className="sticky top-0 z-30 border-b backdrop-blur-xl flex items-center"
      style={{
        paddingTop: "16px",
        paddingBottom: "16px",
        backgroundColor: "var(--header-bg)",
        borderColor: "var(--line)",
      }}
    >
      <div className="max-w-[1320px] mx-auto px-[28px] w-full flex items-center justify-between gap-4">
        {/* Izquierda: logo + Letha */}
        <Link href="/" className="flex items-center gap-2.5 font-bold text-xl tracking-tight text-[#eaf1fa]">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center text-[#0a1729]"
            style={{
              background: "linear-gradient(135deg, #1ea7e8 0%, #64c7f5 100%)",
            }}
          >
            <BookOpen className="w-5 h-5" />
          </div>
          <span>Letha</span>
        </Link>

        {/* Centro: nav */}
        <nav className="flex items-center gap-2" aria-label="Navegación principal">
          <Link
            href="/"
            className={`relative flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition ${
              !isSettingsPage
                ? "bg-[#1ea7e8]/15 text-[#64c7f5]"
                : "text-[#c3cfdd] hover:text-[#64c7f5]"
            }`}
            style={
              !isSettingsPage
                ? { boxShadow: "inset 0 -2px 0 #1ea7e8" }
                : undefined
            }
          >
            <Library className="w-3.5 h-3.5" />
            <span>Biblioteca</span>
          </Link>

          <Link
            href="/settings"
            className={`relative flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition ${
              isSettingsPage
                ? "bg-[#1ea7e8]/15 text-[#64c7f5]"
                : "text-[#c3cfdd] hover:text-[#64c7f5]"
            }`}
            style={
              isSettingsPage
                ? { boxShadow: "inset 0 -2px 0 #1ea7e8" }
                : undefined
            }
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Configuración</span>
          </Link>
        </nav>

        {/* Derecha: botón de tema + botón Importar PDF */}
        <div className="flex items-center gap-3">
          <button
            onClick={cycleTheme}
            aria-label={`Cambiar tema (actual: ${theme})`}
            title={`Tema actual: ${theme}`}
            className="min-w-[44px] min-h-[44px] p-2.5 rounded-xl border flex items-center justify-center transition hover:bg-[#0e1d33]"
            style={{ borderColor: "var(--line-strong)" }}
          >
            {theme === "light" && <Sun className="w-4 h-4 text-[var(--accent)]" />}
            {theme === "sepia" && <Coffee className="w-4 h-4 text-[var(--accent)]" />}
            {theme === "dark" && <Moon className="w-4 h-4 text-[var(--accent)]" />}
          </button>

          {onOpenUpload && (
            <button
              onClick={onOpenUpload}
              className="min-h-[44px] flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl transition hover:opacity-95"
              style={{
                background: "var(--primary-btn-bg)",
                color: "var(--primary-btn-text)",
              }}
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
