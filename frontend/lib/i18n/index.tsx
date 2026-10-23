"use client";

import React, { createContext, useContext, useEffect, useLayoutEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { NATIVE_LANGUAGE_EVENT } from "@/lib/nativeLanguage";
import { savedSettings } from "@/lib/preferences";
import { en, Messages } from "./messages/en";
import { es } from "./messages/es";
import { fr } from "./messages/fr";
import { it } from "./messages/it";
import { pt } from "./messages/pt";

export type { Messages };

export const UI_MESSAGES = { en, es, fr, it, pt };
export type UiLocale = keyof typeof UI_MESSAGES;

export function resolveLocale(language: string | null | undefined): UiLocale {
  return language && language in UI_MESSAGES ? (language as UiLocale) : "en";
}

const I18nContext = createContext<{ locale: UiLocale; t: Messages }>({ locale: "en", t: en });

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<UiLocale>("en");

  // El HTML exportado está en inglés: el idioma guardado se aplica antes de pintar y el script de layout.tsx oculta la página hasta entonces
  useLayoutEffect(() => {
    setLocale(resolveLocale(savedSettings().native_language));
    document.documentElement.removeAttribute("data-i18n-pending");
  }, []);

  useEffect(() => {
    api
      .getAppSettings()
      .then((settings) => setLocale(resolveLocale(settings.native_language)))
      .catch(() => {});
    const onNativeLanguage = (e: Event) => setLocale(resolveLocale((e as CustomEvent<string>).detail));
    window.addEventListener(NATIVE_LANGUAGE_EVENT, onNativeLanguage);
    return () => window.removeEventListener(NATIVE_LANGUAGE_EVENT, onNativeLanguage);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = UI_MESSAGES[locale].meta.title;
    (window as any).webkit?.messageHandlers?.lethaLanguage?.postMessage(locale);
  }, [locale]);

  return <I18nContext.Provider value={{ locale, t: UI_MESSAGES[locale] }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export function errorText(code: string | null | undefined, t: Messages, fallback: string): string {
  return code && code in t.errors ? t.errors[code as keyof Messages["errors"]] : fallback;
}

export function errorMessage(err: unknown, t: Messages, fallback: string): string {
  return errorText(err instanceof ApiError ? err.code : null, t, fallback);
}

export function languageName(code: string, locale: UiLocale): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: "language", languageDisplay: "standard" }).of(code);
    if (name) return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
  } catch {}
  return code;
}
