import { VoiceItem } from "@/lib/api";
import { languageName, Messages, UiLocale } from "@/lib/i18n";

export function personaName(shortName: string | null | undefined, voices: VoiceItem[], t: Messages): string {
  const voice = voices.find((v) => v.short_name === shortName);
  if (voice) return voice.name;
  return shortName?.split("-")[2]?.replace(/(Multilingual)?Neural$/, "") || t.voices.narrator;
}

export function voiceDetails(voice: VoiceItem, locale: UiLocale, t: Messages): string {
  const gender = voice.gender === "Female" ? t.voices.female : voice.gender === "Male" ? t.voices.male : voice.gender;
  const details = `${languageName(voice.locale, locale)} · ${gender}`;
  return voice.offline ? `${details} · ${t.voices.offline}` : details;
}

export function voiceLabel(voice: VoiceItem, locale: UiLocale, t: Messages): string {
  return `${voice.name} — ${voiceDetails(voice, locale, t)}`;
}
