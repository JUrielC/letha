"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Wifi, WifiOff, X } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const CHECK_INTERVAL_MS = 30000;
const LOST_NOTICE_MS = 8000;

interface OfflineModeValue {
  offlineMode: boolean;
  setOfflineMode: (enabled: boolean) => Promise<void>;
}

const OfflineModeContext = createContext<OfflineModeValue>({
  offlineMode: false,
  setOfflineMode: async () => {},
});

export function useOfflineMode() {
  return useContext(OfflineModeContext);
}

export function OfflineModeProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [offlineMode, setOfflineModeState] = useState(false);
  const [automatic, setAutomatic] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<"lost" | "back" | null>(null);
  const previousOnline = useRef<boolean | null>(null);

  const save = useCallback(async (enabled: boolean, auto = false) => {
    const settings = await api.updateAppSettings({ offline_mode: enabled, offline_mode_auto: auto });
    setOfflineModeState(settings.offline_mode);
    setAutomatic(settings.offline_mode_auto);
  }, []);

  const setOfflineMode = useCallback(
    async (enabled: boolean) => {
      setNotice(null);
      await save(enabled);
    },
    [save]
  );

  useEffect(() => {
    api
      .getAppSettings()
      .then((settings) => {
        setOfflineModeState(settings.offline_mode);
        setAutomatic(settings.offline_mode_auto);
        setLoaded(true);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    const check = () =>
      api
        .getConnectivity()
        .then((result) => !cancelled && setOnline(result.online))
        .catch(() => {});
    const onOffline = () => setOnline(false);
    check();
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    window.addEventListener("online", check);
    window.addEventListener("offline", onOffline);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("online", check);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (!loaded || online === null) return;
    const previous = previousOnline.current;
    previousOnline.current = online;
    if (online === previous) return;
    if (!online) {
      if (offlineMode) {
        setNotice((current) => (current === "back" ? null : current));
      } else {
        save(true, true).catch(() => {});
        setNotice("lost");
      }
    } else if (offlineMode && (previous === false || automatic)) {
      setNotice("back");
    }
  }, [online, loaded, offlineMode, automatic, save]);

  useEffect(() => {
    if (notice !== "lost") return;
    const timer = setTimeout(() => setNotice(null), LOST_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const stayOffline = () => {
    setNotice(null);
    save(true).catch(() => {});
  };

  return (
    <OfflineModeContext.Provider value={{ offlineMode, setOfflineMode }}>
      {children}
      {notice && (
        <div
          role={notice === "back" ? "alertdialog" : "status"}
          aria-labelledby="offline-notice-title"
          className="glass-strong fixed top-24 left-1/2 -translate-x-1/2 z-[55] w-[min(460px,calc(100vw-32px))] p-5 rounded-[24px] flex flex-col gap-3 box-border"
          style={{ background: "var(--dialog)", boxShadow: "var(--ring-dialog)", color: "var(--ink)" }}
        >
          <div className="flex items-start gap-3">
            {notice === "back" ? (
              <Wifi className="w-5 h-5 mt-0.5 shrink-0" style={{ color: "var(--accent)" }} />
            ) : (
              <WifiOff className="w-5 h-5 mt-0.5 shrink-0" style={{ color: "var(--accent)" }} />
            )}
            <div className="flex-1 min-w-0">
              <p id="offline-notice-title" className="m-0 text-[15px] font-medium">
                {notice === "back" ? t.offlineMode.backTitle : t.offlineMode.lostTitle}
              </p>
              <p className="m-0 mt-1 text-sm leading-relaxed" style={{ color: "var(--soft)" }}>
                {notice === "back" ? t.offlineMode.backBody : t.offlineMode.lostBody}
              </p>
            </div>
            {notice === "lost" && (
              <button
                type="button"
                onClick={() => setNotice(null)}
                aria-label={t.updates.dismiss}
                className="quiet shrink-0 w-8 h-8 -mr-1 -mt-1 rounded-full flex items-center justify-center border-0 cursor-pointer"
                style={{ background: "transparent", color: "var(--muted)" }}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          {notice === "back" && (
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={stayOffline}
                className="quiet inline-flex items-center h-10 px-4 rounded-full border-0 text-sm font-medium cursor-pointer"
                style={{ color: "var(--soft)" }}
              >
                {t.offlineMode.stay}
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => setOfflineMode(false).catch(() => {})}
                className="glbtn inline-flex items-center h-10 px-4 rounded-full border-0 text-sm font-medium cursor-pointer"
                style={{ background: "var(--btn-primary)", boxShadow: "var(--ring-primary)", color: "var(--btn-primary-ink)" }}
              >
                {t.offlineMode.leave}
              </button>
            </div>
          )}
        </div>
      )}
    </OfflineModeContext.Provider>
  );
}

export function OfflineBadge() {
  const { t } = useI18n();
  const { offlineMode } = useOfflineMode();
  if (!offlineMode) return null;
  return (
    <Link
      href="/settings"
      title={t.offlineMode.badgeHint}
      className="quiet inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium no-underline whitespace-nowrap"
      style={{ background: "var(--glass-seg)", boxShadow: "var(--ring-seg)", color: "var(--ink)" }}
    >
      <WifiOff className="w-3.5 h-3.5" style={{ color: "var(--accent)" }} />
      <span>{t.offlineMode.badge}</span>
    </Link>
  );
}
