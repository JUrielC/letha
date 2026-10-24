"use client";

import React from "react";
import { useOfflineMode } from "@/components/OfflineMode";
import { useI18n } from "@/lib/i18n";

export function OfflineModeSection() {
  const { t } = useI18n();
  const { offlineMode, setOfflineMode } = useOfflineMode();

  return (
    <section aria-labelledby="offline-mode-title" className="flex flex-wrap gap-5 lg:gap-14 py-8">
      <div className="flex-1 min-w-[280px] max-w-[380px]">
        <h2 id="offline-mode-title" className="m-0 text-base font-medium" style={{ color: "var(--ink)" }}>
          {t.settings.offlineMode}
        </h2>
        <p className="m-0 mt-1.5 text-sm" style={{ color: "var(--muted)" }}>
          {t.settings.offlineModeHint}
        </p>
      </div>

      <div
        className="glass flex-[999_1_560px] min-w-0 p-2.5 rounded-[26px] flex flex-col gap-2.5"
        style={{ background: "var(--glass-sub)", boxShadow: "var(--ring-sub)" }}
      >
        <div
          className="p-4 rounded-[20px] flex items-center justify-between gap-4 transition"
          style={{
            background: offlineMode ? "var(--glass-seg-on)" : "var(--tile-off)",
            boxShadow: offlineMode
              ? "inset 0 0 0 1.5px var(--accent-border), var(--shadow-tile-on)"
              : "var(--shadow-tile-off)",
          }}
        >
          <div className="flex-1 min-w-0 pr-2">
            <span className="text-[15px] font-medium" style={{ color: "var(--ink)" }}>
              {t.settings.offlineModeToggle}
            </span>
            <p className="m-0 mt-1 text-sm leading-relaxed" style={{ color: "var(--soft)" }}>
              {t.settings.offlineModeDescription}
            </p>
          </div>

          <label
            htmlFor="offline-mode-toggle"
            className="relative inline-flex items-center shrink-0 cursor-pointer select-none"
            aria-label={t.settings.offlineModeToggle}
          >
            <input
              id="offline-mode-toggle"
              type="checkbox"
              checked={offlineMode}
              onChange={(e) => setOfflineMode(e.target.checked).catch(() => {})}
              className="sr-only"
            />
            <div
              className="w-12 h-7 rounded-full transition-colors flex items-center px-0.5"
              style={{ background: offlineMode ? "var(--accent)" : "var(--dot-off)" }}
            >
              <div
                className={`w-6 h-6 rounded-full bg-white shadow-md transform transition-transform ${
                  offlineMode ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </div>
          </label>
        </div>
      </div>
    </section>
  );
}
