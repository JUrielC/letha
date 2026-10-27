"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Check, Download, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { api, OfflineVoices } from "@/lib/api";
import { usePlayer } from "@/components/Player";
import { useI18n } from "@/lib/i18n";

const VOICE_LANGUAGES = ["es", "en", "fr", "it", "pt"];

export function OfflineVoicesSection() {
  const { t, locale } = useI18n();
  const [voices, setVoices] = useState<OfflineVoices | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const { refreshVoices } = usePlayer();

  const refresh = useCallback(() => {
    api
      .getOfflineVoices()
      .then((status) => {
        setVoices(status);
        setLoadFailed(false);
      })
      .catch(() => setLoadFailed(true));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const downloading = voices?.status === "downloading";
  useEffect(() => {
    if (!downloading) return;
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  }, [downloading, refresh]);

  useEffect(() => {
    if (voices && !downloading) refreshVoices();
  }, [voices?.status]);

  const run = (action: Promise<unknown>) => action.then(refresh, refresh);

  const names = new Intl.DisplayNames([locale], { type: "language" });
  const languages = new Intl.ListFormat(locale, { type: "conjunction" }).format(
    VOICE_LANGUAGES.map((code) => names.of(code) ?? code)
  );

  const statusText = (status: OfflineVoices) => {
    if (status.status === "downloading") return t.settings.offlineDownloading(Math.floor(status.progress * 100));
    if (status.status === "installed") return t.settings.offlineInstalled;
    if (status.status === "error") return t.settings.offlineFailed;
    return `${Math.round(status.size / 1e6)} MB`;
  };

  return (
    <section aria-labelledby="offline-voices-title" className="flex flex-wrap gap-5 lg:gap-14 py-8">
      <div className="flex-1 min-w-[280px] max-w-[380px]">
        <h2 id="offline-voices-title" className="m-0 text-base font-medium" style={{ color: "var(--ink)" }}>
          {t.settings.offlineVoices}
        </h2>
        <p className="m-0 mt-1.5 text-sm" style={{ color: "var(--muted)" }}>
          {t.settings.offlineVoicesHint}
        </p>
        <p className="m-0 mt-3 text-xs" style={{ color: "var(--muted)" }}>
          {t.settings.offlineVoicesCredits}
        </p>
      </div>

      <div
        className="glass flex-[999_1_560px] min-w-0 p-2.5 rounded-[26px] flex flex-col gap-2.5"
        style={{ background: "var(--glass-sub)", boxShadow: "var(--ring-sub)" }}
      >
        {loadFailed || !voices ? (
          loadFailed && (
            <p className="m-0 p-4 text-sm" style={{ color: "var(--soft)" }}>
              {t.settings.offlineLoadFailed}
            </p>
          )
        ) : (
          <div
            className="p-4 rounded-[20px] flex flex-wrap items-center justify-between gap-4"
            style={{ background: "var(--tile-off)", boxShadow: "var(--shadow-tile-off)" }}
          >
            <div className="min-w-0 flex-1">
              <p className="m-0 text-[15px] font-medium first-letter:uppercase" style={{ color: "var(--ink)" }}>
                {languages}
              </p>
              <p
                className="m-0 mt-1 text-sm leading-relaxed"
                style={{ color: voices.status === "error" ? "var(--danger)" : "var(--soft)" }}
              >
                {statusText(voices)}
              </p>
              {voices.status === "downloading" && (
                <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--track)" }}>
                  <div
                    className="h-full rounded-full transition-[width]"
                    style={{ width: `${Math.round(voices.progress * 100)}%`, background: "var(--accent)" }}
                  />
                </div>
              )}
            </div>

            {voices.status === "installed" ? (
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4" style={{ color: "var(--accent)" }} aria-hidden="true" />
                <button
                  type="button"
                  onClick={() => run(api.deleteOfflineVoices())}
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
                onClick={() => run(api.downloadOfflineVoices())}
                disabled={downloading}
                className="glbtn inline-flex items-center gap-2 h-10 px-4 rounded-full border-0 text-sm font-medium cursor-pointer disabled:opacity-60"
                style={{ background: "var(--btn-ghost)", color: "var(--ink)" }}
              >
                {downloading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : voices.status === "error" ? (
                  <RotateCcw className="w-4 h-4" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                <span>{voices.status === "error" ? t.settings.offlineRetry : t.settings.offlineDownload}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
