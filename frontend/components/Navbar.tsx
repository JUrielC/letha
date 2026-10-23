"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus, Moon, Sun, Coffee } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/useTheme";

interface NavbarProps {
  onOpenUpload?: () => void;
}

export function Navbar({ onOpenUpload }: NavbarProps) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();
  const isSettingsPage = pathname?.startsWith("/settings");

  return (
    <div className="sticky top-0 z-30 w-full p-4 pb-0 pointer-events-none">
      <header
        className="glass pointer-events-auto max-w-[1148px] mx-auto px-[18px] py-[10px] flex items-center justify-between gap-4 flex-wrap rounded-[22px]"
        style={{
          background: "var(--glass-bar)",
          boxShadow: "var(--ring-bar)",
        }}
      >
        <Link
          href="/"
          className="flex items-center gap-2.5 font-semibold text-lg tracking-[-0.01em]"
          style={{ color: "var(--ink)" }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="2" y="4" width="20" height="2.4" rx="1.2" fill="var(--ink)" />
            <rect x="1" y="9.2" width="18" height="5.6" rx="2" fill="var(--logo-hl)" />
            <rect x="2" y="10.8" width="15" height="2.4" rx="1.2" fill="var(--accent)" />
            <rect x="2" y="17.6" width="11" height="2.4" rx="1.2" fill="var(--ink)" />
          </svg>
          <span>Letha</span>
        </Link>

        <nav aria-label={t.nav.main} className="flex items-center gap-1 flex-1 min-w-0">
          <Link
            href="/"
            aria-current={!isSettingsPage ? "page" : undefined}
            className={`px-3.5 py-2 rounded-full text-sm font-medium transition ${
              !isSettingsPage ? "" : "quiet text-[var(--muted)]"
            }`}
            style={{
              background: !isSettingsPage ? "var(--glass-seg-on)" : "transparent",
              boxShadow: !isSettingsPage ? "var(--ring-pill-on)" : "none",
              color: !isSettingsPage ? "var(--ink)" : "var(--muted)",
            }}
          >
            {t.nav.library}
          </Link>
          <Link
            href="/settings"
            aria-current={isSettingsPage ? "page" : undefined}
            className={`px-3.5 py-2 rounded-full text-sm font-medium transition ${
              isSettingsPage ? "" : "quiet text-[var(--muted)]"
            }`}
            style={{
              background: isSettingsPage ? "var(--glass-seg-on)" : "transparent",
              boxShadow: isSettingsPage ? "var(--ring-pill-on)" : "none",
              color: isSettingsPage ? "var(--ink)" : "var(--muted)",
            }}
          >
            {t.nav.settings}
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          <div
            role="radiogroup"
            aria-label={t.nav.theme}
            className="flex items-center gap-0.5 p-[3px] rounded-full"
            style={{
              background: "var(--glass-seg)",
              boxShadow: "var(--ring-seg)",
            }}
          >
            <button
              type="button"
              role="radio"
              aria-checked={theme === "light"}
              aria-label={t.themes.lightTheme}
              title={t.themes.lightTheme}
              onClick={() => setTheme("light")}
              className="quiet w-[34px] h-[34px] rounded-full flex items-center justify-center cursor-pointer border-0"
              style={{
                background: theme === "light" ? "var(--glass-seg-on)" : "transparent",
                boxShadow: theme === "light" ? "var(--shadow-seg-on)" : "none",
                color: "var(--ink)",
              }}
            >
              <Sun className="w-4 h-4" strokeWidth={1.7} />
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={theme === "sepia"}
              aria-label={t.themes.sepiaTheme}
              title={t.themes.sepiaTheme}
              onClick={() => setTheme("sepia")}
              className="quiet w-[34px] h-[34px] rounded-full flex items-center justify-center cursor-pointer border-0"
              style={{
                background: theme === "sepia" ? "var(--glass-seg-on)" : "transparent",
                boxShadow: theme === "sepia" ? "var(--shadow-seg-on)" : "none",
                color: "var(--ink)",
              }}
            >
              <Coffee className="w-4 h-4" strokeWidth={1.7} />
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={theme === "dark"}
              aria-label={t.themes.darkTheme}
              title={t.themes.darkTheme}
              onClick={() => setTheme("dark")}
              className="quiet w-[34px] h-[34px] rounded-full flex items-center justify-center cursor-pointer border-0"
              style={{
                background: theme === "dark" ? "var(--glass-seg-on)" : "transparent",
                boxShadow: theme === "dark" ? "var(--shadow-seg-on)" : "none",
                color: "var(--ink)",
              }}
            >
              <Moon className="w-4 h-4" strokeWidth={1.7} />
            </button>
          </div>

          {onOpenUpload && (
            <button
              type="button"
              onClick={onOpenUpload}
              className="glbtn inline-flex items-center gap-2 h-10 px-4 py-0 rounded-full border-0 text-sm font-medium cursor-pointer"
              style={{
                background: "var(--btn-primary)",
                boxShadow: "var(--ring-primary)",
                color: "var(--btn-primary-ink)",
              }}
            >
              <Plus className="w-4 h-4" strokeWidth={1.8} />
              <span>{t.nav.importPdf}</span>
            </button>
          )}
        </div>
      </header>
    </div>
  );
}
