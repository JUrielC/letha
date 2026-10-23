"use client";

import React from "react";
import { Check } from "lucide-react";
import { TranslationLanguage } from "@/lib/api";

interface LanguagePickerProps {
  languages: TranslationLanguage[];
  value: string | null;
  onChange: (code: string) => void;
}

export function LanguagePicker({ languages, value, onChange }: LanguagePickerProps) {
  return (
    <div role="radiogroup" aria-label="Idioma nativo" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {languages.map((language) => {
        const selected = language.code === value;
        return (
          <button
            key={language.code}
            type="button"
            role="radio"
            aria-checked={selected}
            lang={language.code}
            onClick={() => onChange(language.code)}
            className="tile flex items-center justify-between gap-2 h-11 px-3.5 rounded-[14px] border-0 text-sm text-left cursor-pointer"
            style={{
              background: selected ? "var(--glass-seg-on)" : "var(--tile-off)",
              boxShadow: selected
                ? "inset 0 0 0 1.5px var(--accent-border), var(--shadow-tile-on)"
                : "var(--shadow-tile-off)",
              color: "var(--ink)",
            }}
          >
            <span className="truncate">{language.name}</span>
            {selected && <Check className="w-4 h-4 shrink-0" style={{ color: "var(--accent)" }} />}
          </button>
        );
      })}
    </div>
  );
}
