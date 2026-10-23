"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, TranslationLanguage } from "@/lib/api";
import { LanguagePicker } from "@/components/LanguagePicker";
import { errorMessage, resolveLocale, UI_MESSAGES } from "@/lib/i18n";
import { announceNativeLanguage, suggestNativeLanguage } from "@/lib/nativeLanguage";

export function NativeLanguageGate() {
  const [languages, setLanguages] = useState<TranslationLanguage[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getAppSettings()
      .then(async (settings) => {
        if (settings.native_language) return;
        const available = await api.getTranslationLanguages();
        setSelected(suggestNativeLanguage(available));
        setLanguages(available);
      })
      .catch(() => {});
  }, []);

  if (!languages) return null;

  const preview = UI_MESSAGES[resolveLocale(selected)];

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateAppSettings({ native_language: selected });
      announceNativeLanguage(selected);
      setLanguages(null);
    } catch (err: any) {
      setError(errorMessage(err, preview, preview.nativeLanguage.saveFailed));
    } finally {
      setSaving(false);
    }
  };

  // Sin cierre con Escape ni clic en el fondo: el idioma nativo es obligatorio para traducir
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="native-language-title"
      lang={resolveLocale(selected)}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 overflow-y-auto"
      style={{
        background: "var(--scrim)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
      }}
    >
      <div
        className="glass-strong w-full max-w-[600px] p-7 rounded-[30px] flex flex-col gap-5 my-auto box-border"
        style={{ background: "var(--dialog)", boxShadow: "var(--ring-dialog)" }}
      >
        <div>
          <h2
            id="native-language-title"
            className="m-0 font-serif text-[28px] leading-[1.2] font-normal"
            style={{ color: "var(--ink)" }}
          >
            {preview.nativeLanguage.title}
          </h2>
          <p className="m-0 mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            {preview.nativeLanguage.body}
          </p>
        </div>

        <LanguagePicker languages={languages} value={selected} onChange={setSelected} />

        {error && (
          <p role="alert" className="m-0 text-sm" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={save}
            disabled={!selected || saving}
            className="glbtn inline-flex items-center h-11 px-5 rounded-full border-0 text-[15px] font-medium cursor-pointer disabled:opacity-40"
            style={{
              background: "var(--btn-primary)",
              boxShadow: "var(--ring-primary)",
              color: "var(--btn-primary-ink)",
            }}
          >
            {saving ? preview.common.saving : preview.nativeLanguage.continue}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
