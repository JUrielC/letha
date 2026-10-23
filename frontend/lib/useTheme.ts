"use client";

import { useEffect, useState } from "react";

export type Theme = "light" | "sepia" | "dark";

export function applyTheme(t: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", t === "dark");
  document.body.classList.remove("theme-sepia", "theme-dark");
  if (t === "sepia") document.body.classList.add("theme-sepia");
  if (t === "dark") document.body.classList.add("theme-dark");
  try {
    localStorage.setItem("letha_ui_theme", t);
  } catch {}
  // La ventana de macOS lo recuerda para pintar su pantalla de carga antes de que exista la interfaz
  (window as any).webkit?.messageHandlers?.lethaTheme?.postMessage(t);
  window.dispatchEvent(new CustomEvent("letha_theme_change", { detail: t }));
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    let saved: Theme = "light";
    try {
      saved = (localStorage.getItem("letha_ui_theme") as Theme) || "light";
    } catch {}
    setThemeState(saved);
    applyTheme(saved);

    const onStorage = (e: StorageEvent) => {
      if (e.key === "letha_ui_theme" && e.newValue) {
        const next = e.newValue as Theme;
        setThemeState(next);
        applyTheme(next);
      }
    };

    const onCustom = (e: Event) => {
      const custom = e as CustomEvent<Theme>;
      if (custom.detail) {
        setThemeState(custom.detail);
      }
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("letha_theme_change", onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("letha_theme_change", onCustom);
    };
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    applyTheme(t);
  };

  return { theme, setTheme, applyTheme };
}
