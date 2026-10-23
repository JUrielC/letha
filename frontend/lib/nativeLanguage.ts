import { TranslationLanguage } from "@/lib/api";

export const NATIVE_LANGUAGE_EVENT = "letha_native_language_change";

export function suggestNativeLanguage(languages: TranslationLanguage[]): string | null {
  if (typeof navigator === "undefined") return null;
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of preferred) {
    const code = tag.toLowerCase().split("-")[0];
    if (languages.some((l) => l.code === code)) return code;
  }
  return null;
}

export function announceNativeLanguage(code: string) {
  window.dispatchEvent(new CustomEvent(NATIVE_LANGUAGE_EVENT, { detail: code }));
}
