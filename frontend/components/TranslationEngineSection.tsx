"use client";

import React from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { TranslationEngine } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export function TranslationEngineSection({
  order,
  onChange,
}: {
  order: TranslationEngine[];
  onChange: (order: TranslationEngine[]) => void;
}) {
  const { t } = useI18n();

  const engines: Record<TranslationEngine, { name: string; description: string }> = {
    microsoft: { name: "Microsoft", description: t.settings.engineOnline },
    google: { name: "Google", description: t.settings.engineOnline },
    offline: { name: t.settings.engineOffline, description: t.settings.engineOfflineDescription },
  };

  const move = (from: number, to: number) => {
    const next = [...order];
    [next[from], next[to]] = [next[to], next[from]];
    onChange(next);
  };

  const arrowButton = "glbtn w-10 h-10 rounded-full border-0 flex items-center justify-center cursor-pointer disabled:opacity-30 disabled:cursor-default";

  return (
    <section aria-labelledby="translation-engine-title" className="flex flex-wrap gap-5 lg:gap-14 py-8">
      <div className="flex-1 min-w-[280px] max-w-[380px]">
        <h2 id="translation-engine-title" className="m-0 text-base font-medium" style={{ color: "var(--ink)" }}>
          {t.settings.engine}
        </h2>
        <p className="m-0 mt-1.5 text-sm" style={{ color: "var(--muted)" }}>
          {t.settings.engineHint}
        </p>
      </div>

      <ol
        className="glass flex-[999_1_560px] min-w-0 m-0 p-2.5 rounded-[26px] flex flex-col gap-2.5 list-none"
        style={{ background: "var(--glass-sub)", boxShadow: "var(--ring-sub)" }}
      >
        {order.map((engine, index) => (
          <li
            key={engine}
            className="p-4 rounded-[20px] flex items-center gap-4"
            style={{ background: "var(--tile-off)", boxShadow: "var(--shadow-tile-off)" }}
          >
            <span
              aria-hidden="true"
              className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-sm font-semibold"
              style={{ background: "var(--btn-ghost)", boxShadow: "var(--ring-ghost)", color: "var(--accent)" }}
            >
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="m-0 text-[15px] font-medium" style={{ color: "var(--ink)" }}>
                {engines[engine].name}
              </p>
              <p className="m-0 mt-1 text-sm" style={{ color: "var(--soft)" }}>
                {engines[engine].description}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => move(index, index - 1)}
                disabled={index === 0}
                aria-label={t.settings.engineMoveUp(engines[engine].name)}
                className={arrowButton}
                style={{ background: "var(--btn-ghost)", color: "var(--ink)" }}
              >
                <ArrowUp className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => move(index, index + 1)}
                disabled={index === order.length - 1}
                aria-label={t.settings.engineMoveDown(engines[engine].name)}
                className={arrowButton}
                style={{ background: "var(--btn-ghost)", color: "var(--ink)" }}
              >
                <ArrowDown className="w-4 h-4" />
              </button>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
