"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Check, Download, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { api, OfflineTranslation } from "@/lib/api";
import { languageName, useI18n } from "@/lib/i18n";

export function OfflineTranslationSection({ nativeLanguage }: { nativeLanguage: string | null }) {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<OfflineTranslation[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(() => {
    api
      .getOfflineTranslation()
      .then((list) => {
        setItems(list);
        setLoadFailed(false);
      })
      .catch(() => setLoadFailed(true));
  }, []);

  useEffect(() => {
    refresh();
  }, [nativeLanguage, refresh]);

  const downloading = items.some((item) => item.status === "downloading");
  useEffect(() => {
    if (!downloading) return;
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  }, [downloading, refresh]);

  const run = (action: Promise<unknown>) => action.then(refresh, refresh);
  const listFormat = new Intl.ListFormat(locale, { type: "conjunction" });

  const statusText = (item: OfflineTranslation) => {
    if (item.status === "downloading") return t.settings.offlineDownloading(Math.floor(item.progress * 100));
    if (item.status === "installed") return t.settings.offlineInstalled;
    if (item.status === "error") return t.settings.offlineFailed;
    const shared = items.filter((other) => other.model === item.model && other.language !== item.language);
    const size = `${Math.round(item.size / 1e6)} MB`;
    return shared.length
      ? `${size} · ${t.settings.offlineShared(listFormat.format(shared.map((s) => languageName(s.language, locale))))}`
      : size;
  };

  return (
    <section aria-labelledby="offline-translation-title" className="flex flex-wrap gap-5 lg:gap-14 py-8">
      <div className="flex-1 min-w-[280px] max-w-[380px]">
        <h2 id="offline-translation-title" className="m-0 text-base font-medium" style={{ color: "var(--ink)" }}>
          {t.settings.offline}
        </h2>
        <p className="m-0 mt-1.5 text-sm" style={{ color: "var(--muted)" }}>
          {t.settings.offlineHint}
        </p>
        <p className="m-0 mt-3 text-xs" style={{ color: "var(--muted)" }}>
          {t.settings.offlineCredits}
        </p>
      </div>

      <div
        className="glass flex-[999_1_560px] min-w-0 p-2.5 rounded-[26px] flex flex-col gap-2.5"
        style={{ background: "var(--glass-sub)", boxShadow: "var(--ring-sub)" }}
      >
        {!nativeLanguage || loadFailed ? (
          <p className="m-0 p-4 text-sm" style={{ color: "var(--soft)" }}>
            {nativeLanguage ? t.settings.offlineLoadFailed : t.settings.offlineNeedsNative}
          </p>
        ) : (
          items.map((item) => (
            <div
              key={item.language}
              className="p-4 rounded-[20px] flex flex-wrap items-center justify-between gap-4"
              style={{ background: "var(--tile-off)", boxShadow: "var(--shadow-tile-off)" }}
            >
              <div className="min-w-0 flex-1">
                <p className="m-0 text-[15px] font-medium" style={{ color: "var(--ink)" }}>
                  {languageName(item.language, locale)} → {languageName(nativeLanguage, locale)}
                </p>
                <p
                  className="m-0 mt-1 text-sm leading-relaxed"
                  style={{ color: item.status === "error" ? "var(--danger)" : "var(--soft)" }}
                >
                  {statusText(item)}
                </p>
                {item.status === "downloading" && (
                  <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--track)" }}>
                    <div
                      className="h-full rounded-full transition-[width]"
                      style={{ width: `${Math.round(item.progress * 100)}%`, background: "var(--accent)" }}
                    />
                  </div>
                )}
              </div>

              {item.status === "installed" ? (
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4" style={{ color: "var(--accent)" }} aria-hidden="true" />
                  <button
                    type="button"
                    onClick={() => run(api.deleteOfflineTranslation(item.language))}
                    className="glbtn inline-flex items-center gap-2 h-10 px-4 rounded-full border-0 text-sm font-medium cursor-pointer"
                    style={{ background: "var(--btn-ghost)", color: "var(--soft)" }}
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>{t.settings.offlineDelete}</span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => run(api.downloadOfflineTranslation(item.language))}
                  disabled={item.status === "downloading"}
                  className="glbtn inline-flex items-center gap-2 h-10 px-4 rounded-full border-0 text-sm font-medium cursor-pointer disabled:opacity-60"
                  style={{ background: "var(--btn-ghost)", color: "var(--ink)" }}
                >
                  {item.status === "downloading" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : item.status === "error" ? (
                    <RotateCcw className="w-4 h-4" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  <span>{item.status === "error" ? t.settings.offlineRetry : t.settings.offlineDownload}</span>
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
