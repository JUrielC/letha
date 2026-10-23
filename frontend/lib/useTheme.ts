"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { savedSettings, savePreferences } from "@/lib/preferences";

export type Theme = "light" | "sepia" | "dark";

export function applyTheme(t: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", t === "dark");
  document.body.classList.remove("theme-sepia", "theme-dark");
  if (t === "sepia") document.body.classList.add("theme-sepia");
  if (t === "dark") document.body.classList.add("theme-dark");
  // La ventana de macOS lo recuerda para pintar su pantalla de carga antes de que exista la interfaz
  (window as any).webkit?.messageHandlers?.lethaTheme?.postMessage(t);
  window.dispatchEvent(new CustomEvent("letha_theme_change", { detail: t }));
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    const show = (t: Theme) => {
      setThemeState(t);
      applyTheme(t);
    };
    const saved = savedSettings().theme;
    if (saved) {
      show(saved);
    } else {
      api
        .getAppSettings()
        .then((s) => show(s.theme))
        .catch(() => show("light"));
    }

    const onCustom = (e: Event) => {
      const custom = e as CustomEvent<Theme>;
      if (custom.detail) {
        setThemeState(custom.detail);
      }
    };

    window.addEventListener("letha_theme_change", onCustom);
    return () => {
      window.removeEventListener("letha_theme_change", onCustom);
    };
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    applyTheme(t);
    savePreferences({ theme: t });
  };

  return { theme, setTheme, applyTheme };
}
