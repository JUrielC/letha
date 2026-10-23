"use client";

import React, { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Check, Loader2, Play, RotateCcw, Square, Trash2 } from "lucide-react";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Navbar } from "@/components/Navbar";
import { LanguagePicker } from "@/components/LanguagePicker";
import { UpdateDialog } from "@/components/UpdateDialog";
import { api, TranslationLanguage, UpdateInfo } from "@/lib/api";
import { errorMessage, errorText, useI18n } from "@/lib/i18n";
import { announceNativeLanguage, NATIVE_LANGUAGE_EVENT } from "@/lib/nativeLanguage";
import { savedSettings, savePreferences } from "@/lib/preferences";
import { Theme, useTheme } from "@/lib/useTheme";

const DEFAULT_PERCENT = 90;
const PRESET_PERCENTS = [75, 80, 85, 90, 95, 100];
const DEFAULT_VOICE = "es-MX-DaliaNeural";

type Boundary = "SentenceBoundary" | "WordBoundary";
type FontSize = "sm" | "base" | "lg" | "xl";

interface OptionDef<T> {
  value: T;
  title: string;
  description: string;
  isDefault?: boolean;
  technical?: string;
  example?: React.ReactNode;
}

function OptionGrid<T extends string | boolean>({
  name,
  legend,
  description,
  options,
  value,
  onChange,
  children,
}: {
  name: string;
  legend: string;
  description: string;
  options: OptionDef<T>[];
  value: T;
  onChange: (v: T) => void;
  children?: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <section aria-labelledby={name} className="flex flex-wrap gap-5 lg:gap-14 py-8">
      <div className="flex-1 min-w-[280px] max-w-[380px]">
        <h2 id={name} className="m-0 text-base font-medium" style={{ color: "var(--ink)" }}>
          {legend}
        </h2>
        <p className="m-0 mt-1.5 text-sm" style={{ color: "var(--muted)" }}>
          {description}
        </p>
      </div>

      <div
        className="glass flex-[999_1_560px] min-w-0 p-2.5 rounded-[26px] flex flex-col gap-2.5"
        style={{
          background: "var(--glass-sub)",
          boxShadow: "var(--ring-sub)",
        }}
      >
        <div
          role="radiogroup"
          aria-labelledby={name}
          className="grid grid-cols-1 sm:grid-cols-2 gap-2.5"
        >
          {options.map((opt, idx) => {
            const selected = opt.value === value;
            const id = `${name}-${String(opt.value)}`;
            return (
              <label
                key={id}
                htmlFor={id}
                className="tile animate-rise-gradient relative text-left p-[18px] rounded-[20px] cursor-pointer flex flex-col gap-3 border-0 select-none"
                style={{
                  animationDelay: `${idx * 80}ms`,
                  background: selected ? "var(--glass-seg-on)" : "var(--tile-off)",
                  boxShadow: selected
                    ? "inset 0 0 0 1.5px var(--accent-border), var(--shadow-tile-on)"
                    : "var(--shadow-tile-off)",
                  color: "var(--ink)",
                }}
              >
                <input
                  id={id}
                  type="radio"
                  name={name}
                  checked={selected}
                  onChange={() => onChange(opt.value)}
                  className="sr-only"
                />
                <span className="flex items-center gap-2.5 flex-wrap">
                  <span
                    aria-hidden="true"
                    className="w-[18px] h-[18px] rounded-full inline-flex items-center justify-center box-border"
                    style={{
                      border: selected ? "0" : "1px solid var(--dot-off)",
                      background: selected ? "var(--accent)" : "transparent",
                    }}
                  >
                    {selected && (
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ background: "#ffffff" }}
                      />
                    )}
                  </span>
                  <span className="text-[15px] font-medium">{opt.title}</span>
                  {opt.isDefault && (
                    <span className="text-xs" style={{ color: "var(--muted)" }}>
                      {t.common.default}
                    </span>
                  )}
                </span>

                <span className="text-sm leading-relaxed" style={{ color: "var(--soft)" }}>
                  {opt.description}
                </span>

                {opt.example && (
                  <span
                    className="font-serif text-base leading-[1.6] p-3 rounded-[14px] block"
                    style={{ background: "var(--sample)" }}
                  >
                    {opt.example}
                  </span>
                )}

                {opt.technical && (
                  <code className="font-mono text-xs" style={{ color: "var(--muted)" }}>
                    {opt.technical}
                  </code>
                )}
              </label>
            );
          })}
        </div>
        {children}
      </div>
    </section>
  );
}

function SettingsContent() {
  const searchParams = useSearchParams();
  const bookId = searchParams.get("bookId");

  const [percent, setPercent] = useState<number>(DEFAULT_PERCENT);
  const [autoAdvance, setAutoAdvance] = useState<boolean>(true);
  const [autoAdvancePage, setAutoAdvancePage] = useState<boolean>(true);
  const [boundaryType, setBoundaryType] = useState<Boundary>("SentenceBoundary");
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [savedNotice, setSavedNotice] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [sampleVoice, setSampleVoice] = useState<string>(DEFAULT_VOICE);
  const [sampleState, setSampleState] = useState<"idle" | "loading" | "playing">("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [autoCheckUpdates, setAutoCheckUpdates] = useState<boolean>(true);
  const [checkingUpdates, setCheckingUpdates] = useState<boolean>(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [updateDialogOpen, setUpdateDialogOpen] = useState<boolean>(false);
  const [uninstallConfirmOpen, setUninstallConfirmOpen] = useState<boolean>(false);
  const [deleteLibrary, setDeleteLibrary] = useState<boolean>(false);
  const [uninstallPhase, setUninstallPhase] = useState<"idle" | "uninstalling" | "started" | "error">("idle");
  const [nativeLanguage, setNativeLanguage] = useState<string | null>(null);
  const [languages, setLanguages] = useState<TranslationLanguage[]>([]);

  const { theme, setTheme } = useTheme();
  const { t } = useI18n();
  const [fontSize, setFontSize] = useState<FontSize>("base");

  const savePromiseRef = useRef<Promise<void> | null>(null);
  const sampleAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setFontSize(savedSettings().font_size ?? "base");

    setLoading(true);
    api
      .getAppSettings()
      .then((s) => {
        setPercent(Math.round((s.edge_base_speed || DEFAULT_PERCENT / 100) * 100));
        setAutoAdvance(s.auto_advance_sentence ?? true);
        setAutoAdvancePage(s.auto_advance_page ?? true);
        setBoundaryType(s.boundary_type === "WordBoundary" ? "WordBoundary" : "SentenceBoundary");
        setAutoCheckUpdates(s.auto_check_updates ?? true);
        setNativeLanguage(s.native_language ?? null);
        setFontSize(s.font_size);
      })
      .catch((err) => {
        console.error("Error al cargar configuración:", err);
        setError(t.settings.loadFailed);
      })
      .finally(() => setLoading(false));

    api.getUpdates().then(setUpdateInfo).catch(() => {});
    api.getTranslationLanguages().then(setLanguages).catch(() => {});

    api
      .getBooks()
      .then((books) => {
        const fromBook = bookId ? books.find((b) => b.id === bookId) : undefined;
        const v = fromBook?.voice || books[0]?.voice;
        if (v) setSampleVoice(v);
      })
      .catch(() => {});

    return () => {
      sampleAudioRef.current?.pause();
    };
  }, [bookId]);

  const rateDiff = percent - 100;
  const rateLabel = rateDiff >= 0 ? `+${rateDiff}%` : `${rateDiff}%`;

  const saveSettings = (
    nextPercent: number,
    nextAutoAdvance: boolean,
    nextBoundary: Boundary,
    nextAutoAdvancePage: boolean = autoAdvancePage
  ) => {
    setSaving(true);
    setError(null);
    const p = (async () => {
      try {
        const decimal = Number((nextPercent / 100).toFixed(2));
        await api.updateAppSettings({
          edge_base_speed: decimal,
          auto_advance_sentence: nextAutoAdvance,
          auto_advance_page: nextAutoAdvancePage,
          boundary_type: nextBoundary,
        });
        setSavedNotice(true);
        setTimeout(() => setSavedNotice(false), 2000);
      } catch (err: any) {
        setError(errorMessage(err, t, t.settings.saveFailed));
      } finally {
        setSaving(false);
      }
    })();
    savePromiseRef.current = p;
    return p;
  };

  const handleModeChange = (nextAuto: boolean) => {
    setAutoAdvance(nextAuto);
    saveSettings(percent, nextAuto, boundaryType, autoAdvancePage);
  };

  const handleAutoAdvancePageChange = (nextAutoPage: boolean) => {
    setAutoAdvancePage(nextAutoPage);
    saveSettings(percent, autoAdvance, boundaryType, nextAutoPage);
  };

  const handleBoundaryChange = (nextBoundary: Boundary) => {
    setBoundaryType(nextBoundary);
    saveSettings(percent, autoAdvance, nextBoundary, autoAdvancePage);
  };

  useEffect(() => {
    const onNativeLanguage = (e: Event) => setNativeLanguage((e as CustomEvent<string>).detail);
    window.addEventListener(NATIVE_LANGUAGE_EVENT, onNativeLanguage);
    return () => window.removeEventListener(NATIVE_LANGUAGE_EVENT, onNativeLanguage);
  }, []);

  const handleNativeLanguageChange = (code: string) => {
    setNativeLanguage(code);
    api
      .updateAppSettings({ native_language: code })
      .then(() => announceNativeLanguage(code))
      .catch((err) => setError(errorMessage(err, t, t.settings.saveFailed)));
  };

  const handleAutoCheckUpdatesChange = (enabled: boolean) => {
    setAutoCheckUpdates(enabled);
    api.updateAppSettings({ auto_check_updates: enabled }).catch((err) => {
      setError(errorMessage(err, t, t.settings.saveFailed));
    });
  };

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true);
    setUpdateMessage(null);
    try {
      const info = await api.getUpdates(true);
      setUpdateInfo(info);
      if (info.error) {
        setUpdateMessage(errorText(info.error, t, t.settings.checkFailed));
      } else if (info.update_available) {
        setUpdateDialogOpen(true);
      } else {
        setUpdateMessage(info.latest_version ? t.settings.upToDate(info.current_version) : t.settings.noReleases);
      }
    } catch (err: any) {
      setUpdateMessage(errorMessage(err, t, t.settings.checkFailed));
    } finally {
      setCheckingUpdates(false);
    }
  };

  const canUninstall = updateInfo?.can_self_update ?? false;
  const uninstallStatus = {
    idle: canUninstall || !updateInfo ? t.settings.uninstallDescription : t.settings.uninstallUnavailable,
    uninstalling: t.settings.uninstalling,
    started: updateInfo?.platform === "win32" ? t.settings.uninstallStartedWindows : t.settings.uninstallStarted,
    error: t.settings.uninstallFailed,
  }[uninstallPhase];

  const openUninstallConfirm = () => {
    setDeleteLibrary(false);
    setUninstallConfirmOpen(true);
  };

  const handleUninstall = async () => {
    setUninstallConfirmOpen(false);
    setUninstallPhase("uninstalling");
    try {
      await api.uninstall(deleteLibrary);
      setUninstallPhase("started");
      // En Windows la ventana de Edge sigue abierta aunque el servidor se cierre
      if (updateInfo?.platform === "win32") setTimeout(() => window.close(), 4000);
    } catch {
      setUninstallPhase("error");
    }
  };

  const handlePresetClick = (p: number) => {
    setPercent(p);
    saveSettings(p, autoAdvance, boundaryType, autoAdvancePage);
  };

  const handleSample = async () => {
    if (sampleState === "playing") {
      sampleAudioRef.current?.pause();
      setSampleState("idle");
      return;
    }
    setSampleState("loading");
    try {
      if (savePromiseRef.current) await savePromiseRef.current;
      sampleAudioRef.current?.pause();
      const audio = new Audio(`${api.getVoicePreviewUrl(sampleVoice)}&t=${Date.now()}`);
      sampleAudioRef.current = audio;
      audio.onended = () => setSampleState("idle");
      audio.onerror = () => setSampleState("idle");
      await audio.play();
      setSampleState("playing");
    } catch {
      setSampleState("idle");
    }
  };

  const [sampleFirst, sampleSecond, sampleRest] = t.settings.readingSample;
  const modeOptions: OptionDef<boolean>[] = [
    {
      value: true,
      title: t.settings.autoTitle,
      isDefault: true,
      description: t.settings.autoDescription,
      example: (
        <span>
          <span className="rounded px-1 py-0.5" style={{ background: "var(--hl)" }}>
            {sampleFirst}
          </span>{" "}
          <span className="rounded px-1 py-0.5" style={{ background: "var(--hl)" }}>
            {sampleSecond}
          </span>{" "}
          <span style={{ color: "var(--faded)" }}>{sampleRest}</span>
        </span>
      ),
    },
    {
      value: false,
      title: t.settings.clickTitle,
      description: t.settings.clickDescription,
      example: (
        <span>
          <span className="rounded px-1 py-0.5" style={{ background: "var(--hl)" }}>
            {sampleFirst}
          </span>{" "}
          <span style={{ color: "var(--faded)" }}>
            {sampleSecond} {sampleRest}
          </span>
        </span>
      ),
    },
  ];

  const boundaryOptions: OptionDef<Boundary>[] = [
    {
      value: "SentenceBoundary",
      title: t.settings.bySentence,
      technical: "SentenceBoundary",
      isDefault: true,
      description: t.settings.bySentenceDescription,
      example: (
        <span>
          <span className="rounded px-1 py-0.5" style={{ background: "var(--hl)" }}>
            It was a place that she would like.
          </span>{" "}
          <span style={{ color: "var(--faded)" }}>She always dreamed of it.</span>
        </span>
      ),
    },
    {
      value: "WordBoundary",
      title: t.settings.byWord,
      technical: "WordBoundary",
      description: t.settings.byWordDescription,
      example: (
        <span>
          <span className="rounded px-1 py-0.5" style={{ background: "var(--hl)" }}>
            It was a{" "}
            <span
              className="rounded px-1 py-0.5"
              style={{
                background: "var(--word)",
                boxShadow: "var(--shadow-word)",
              }}
            >
              place
            </span>{" "}
            that she would like.
          </span>{" "}
          <span style={{ color: "var(--faded)" }}>She always dreamed of it.</span>
        </span>
      ),
    },
  ];
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-1 w-full max-w-[1148px] mx-auto px-6 pt-14 pb-28 box-border">
        {/* Encabezado */}
        <header className="flex flex-wrap items-end justify-between gap-4 pb-8">
          <div>
            <h1
              className="m-0 font-serif text-[40px] leading-[1.15] font-normal tracking-[-0.015em]"
              style={{ color: "var(--ink)" }}
            >
              {t.settings.title}
            </h1>
            <p className="m-0 mt-2.5 text-base" style={{ color: "var(--muted)" }}>
              {t.settings.subtitle}
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <p
              aria-live="polite"
              className="glass m-0 inline-flex items-center gap-2 h-9 px-3.5 pl-2.5 rounded-full text-sm font-medium"
              style={{
                background: "var(--glass-seg)",
                boxShadow: "var(--ring-seg)",
                color: "var(--ink)",
              }}
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--muted)" }} />
              ) : (
                <Check className="w-4 h-4 text-[var(--accent)]" strokeWidth={2} />
              )}
              <span>
                {saving ? t.common.saving : savedNotice ? t.settings.saved : t.settings.savedOnDevice}
              </span>
            </p>

            <Link
              href={bookId ? `/reader?id=${bookId}` : "/"}
              className="quiet inline-flex items-center gap-2 h-10 px-4 rounded-full text-sm font-medium no-underline"
              style={{ color: "var(--ink)" }}
            >
              <ArrowLeft className="w-4 h-4" strokeWidth={1.6} />
              <span>{bookId ? t.settings.backToBook : t.common.backToLibrary}</span>
            </Link>
          </div>
        </header>

        {loading ? (
          <div className="py-24 flex flex-col items-center justify-center gap-3" style={{ color: "var(--muted)" }}>
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--accent)" }} />
            <span className="text-sm">{t.settings.loading}</span>
          </div>
        ) : (
          <div className="divide-y divide-[var(--track)]">
            {/* Idioma nativo */}
            <section aria-labelledby="settings-native-language-title" className="flex flex-wrap gap-5 lg:gap-14 py-8">
              <div className="flex-1 min-w-[280px] max-w-[380px]">
                <h2 id="settings-native-language-title" className="m-0 text-base font-medium" style={{ color: "var(--ink)" }}>
                  {t.settings.nativeLanguage}
                </h2>
                <p className="m-0 mt-1.5 text-sm" style={{ color: "var(--muted)" }}>
                  {t.settings.nativeLanguageHint}
                </p>
              </div>

              <div
                className="glass flex-[999_1_560px] min-w-0 p-2.5 rounded-[26px]"
                style={{
                  background: "var(--glass-sub)",
                  boxShadow: "var(--ring-sub)",
                }}
              >
                <LanguagePicker languages={languages} value={nativeLanguage} onChange={handleNativeLanguageChange} />
              </div>
            </section>

            <OptionGrid
              name="reading-mode"
              legend={t.settings.readingMode}
              description={t.settings.readingModeHint}
              options={modeOptions}
              value={autoAdvance}
              onChange={handleModeChange}
            >
              {autoAdvance && (
                <div
                  className="animate-rise-gradient p-4 rounded-[20px] flex items-center justify-between gap-4 transition"
                  style={{
                    background: autoAdvancePage ? "var(--glass-seg-on)" : "var(--tile-off)",
                    boxShadow: autoAdvancePage
                      ? "inset 0 0 0 1.5px var(--accent-border), var(--shadow-tile-on)"
                      : "var(--shadow-tile-off)",
                  }}
                >
                  <div className="flex-1 min-w-0 pr-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[15px] font-medium" style={{ color: "var(--ink)" }}>
                        {t.settings.autoPage}
                      </span>
                      <span className="text-xs" style={{ color: "var(--muted)" }}>
                        {t.common.default}
                      </span>
                    </div>
                    <p className="m-0 mt-1 text-sm leading-relaxed" style={{ color: "var(--soft)" }}>
                      {t.settings.autoPageDescription}
                    </p>
                  </div>

                  <label
                    htmlFor="auto-advance-page-toggle"
                    className="relative inline-flex items-center shrink-0 cursor-pointer select-none"
                    aria-label={t.settings.autoPage}
                  >
                    <input
                      id="auto-advance-page-toggle"
                      type="checkbox"
                      checked={autoAdvancePage}
                      onChange={(e) => handleAutoAdvancePageChange(e.target.checked)}
                      className="sr-only"
                    />
                    <div
                      className="w-12 h-7 rounded-full transition-colors flex items-center px-0.5"
                      style={{
                        background: autoAdvancePage ? "var(--accent)" : "var(--dot-off)",
                      }}
                    >
                      <div
                        className={`w-6 h-6 rounded-full bg-white shadow-md transform transition-transform ${
                          autoAdvancePage ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </div>
                  </label>
                </div>
              )}
            </OptionGrid>

            <OptionGrid
              name="boundary"
              legend={t.settings.highlight}
              description={t.settings.highlightHint}
              options={boundaryOptions}
              value={boundaryType}
              onChange={handleBoundaryChange}
            />

            {/* Velocidad de la voz */}
            <section aria-labelledby="speed-title" className="flex flex-wrap gap-5 lg:gap-14 py-8">
              <div className="flex-1 min-w-[280px] max-w-[380px]">
                <h2 id="speed-title" className="m-0 text-base font-medium" style={{ color: "var(--ink)" }}>
                  {t.settings.speed}
                </h2>
                <p className="m-0 mt-1.5 text-sm" style={{ color: "var(--muted)" }}>
                  {t.settings.speedHint}
                </p>
                <p className="m-0 mt-3 text-sm" style={{ color: "var(--muted)" }}>
                  {t.settings.speedRecommended}
                </p>
              </div>

              <div
                className="animate-rise-gradient glass-strong flex-[999_1_560px] min-w-0 p-[26px] rounded-[28px] flex flex-col gap-[18px]"
                style={{
                  background: "var(--glass-panel)",
                  boxShadow: "var(--ring-panel)",
                  animationDelay: "160ms",
                }}
              >
                <div className="flex items-baseline gap-3.5 flex-wrap">
                  <span
                    className="font-serif text-[40px] leading-none tabular-nums tracking-[-0.01em]"
                    style={{ color: "var(--ink)" }}
                  >
                    {percent}%
                  </span>
                  <code className="font-mono text-[13px]" style={{ color: "var(--muted)" }}>
                    rate {rateLabel}
                  </code>
                </div>

                <div>
                  <label htmlFor="speed-slider" className="sr-only">
                    {t.settings.speedSlider}
                  </label>
                  <input
                    id="speed-slider"
                    type="range"
                    min={50}
                    max={120}
                    step={5}
                    value={percent}
                    onChange={(e) => setPercent(Number(e.target.value))}
                    onMouseUp={() => saveSettings(percent, autoAdvance, boundaryType)}
                    onTouchEnd={() => saveSettings(percent, autoAdvance, boundaryType)}
                    onKeyUp={() => saveSettings(percent, autoAdvance, boundaryType)}
                    className="letha-slider"
                    aria-valuetext={`${percent}%`}
                  />
                  <div
                    className="relative h-9 text-xs leading-[18px] tabular-nums mt-1 select-none"
                    style={{ color: "var(--muted)" }}
                  >
                    <span className="absolute left-0 flex flex-col">
                      <span>50%</span>
                      <span>{t.settings.slow}</span>
                    </span>
                    <span
                      className="absolute left-[57.1%] -translate-x-1/2 flex flex-col items-center font-medium"
                      style={{ color: "var(--ink)" }}
                    >
                      <span>{DEFAULT_PERCENT}%</span>
                      <span>{t.settings.recommended}</span>
                    </span>
                    <span className="absolute left-[71.4%] -translate-x-1/2 flex flex-col items-center">
                      <span>100%</span>
                      <span>Edge</span>
                    </span>
                    <span className="absolute right-0">120%</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div
                      role="group"
                      aria-label={t.settings.presets}
                      className="flex flex-wrap gap-0.5 p-1 rounded-full"
                      style={{
                        background: "var(--glass-seg)",
                        boxShadow: "var(--ring-seg)",
                      }}
                    >
                      {PRESET_PERCENTS.map((p) => {
                        const active = percent === p;
                        return (
                          <button
                            key={p}
                            type="button"
                            onClick={() => handlePresetClick(p)}
                            aria-pressed={active}
                            className="quiet h-[34px] min-w-[50px] px-3 rounded-full border-0 text-sm font-medium tabular-nums cursor-pointer transition"
                            style={{
                              background: active ? "var(--glass-seg-on)" : "transparent",
                              boxShadow: active ? "var(--shadow-seg-on)" : "none",
                              color: "var(--ink)",
                            }}
                          >
                            {p}%
                          </button>
                        );
                      })}
                    </div>

                    {percent !== DEFAULT_PERCENT && (
                      <button
                        type="button"
                        onClick={() => handlePresetClick(DEFAULT_PERCENT)}
                        className="quiet inline-flex items-center gap-1.5 h-[34px] px-3 rounded-full text-xs font-medium cursor-pointer border-0"
                        style={{ color: "var(--muted)" }}
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>{t.settings.reset}</span>
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleSample}
                    disabled={sampleState === "loading"}
                    className="glbtn inline-flex items-center gap-2.5 h-[46px] pr-5 pl-2 rounded-full border-0 text-[15px] font-medium cursor-pointer transition disabled:opacity-60"
                    style={{
                      background: "var(--btn-primary)",
                      boxShadow: "var(--ring-primary)",
                      color: "var(--btn-primary-ink)",
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="w-8 h-8 rounded-full inline-flex items-center justify-center"
                      style={{ background: "var(--icon-chip)" }}
                    >
                      {sampleState === "loading" ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : sampleState === "playing" ? (
                        <Square className="w-3.5 h-3.5 fill-current" />
                      ) : (
                        <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                      )}
                    </span>
                    <span>
                      {sampleState === "playing" ? t.common.stop : t.settings.trySpeed}
                    </span>
                  </button>
                </div>
              </div>
            </section>

            {/* Apariencia */}
            <section aria-labelledby="appearance-title" className="flex flex-wrap gap-5 lg:gap-14 py-8">
              <div className="flex-1 min-w-[280px] max-w-[380px]">
                <h2 id="appearance-title" className="m-0 text-base font-medium" style={{ color: "var(--ink)" }}>
                  {t.settings.appearance}
                </h2>
                <p className="m-0 mt-1.5 text-sm" style={{ color: "var(--muted)" }}>
                  {t.settings.appearanceHint}
                </p>
              </div>

              <div
                className="glass flex-[999_1_560px] min-w-0 p-2.5 rounded-[26px] flex flex-col gap-4"
                style={{
                  background: "var(--glass-sub)",
                  boxShadow: "var(--ring-sub)",
                }}
              >
                <div
                  role="radiogroup"
                  aria-label={t.nav.theme}
                  className="grid grid-cols-1 sm:grid-cols-3 gap-2.5"
                >
                  {[
                    {
                      id: "light" as Theme,
                      label: t.themes.light,
                      ambient:
                        "radial-gradient(850px 700px at 4% 0%, rgba(195, 205, 218, 0.55) 0%, rgba(195, 205, 218, 0) 65%), radial-gradient(950px 750px at 96% 8%, rgba(165, 178, 192, 0.35) 0%, rgba(165, 178, 192, 0) 62%), linear-gradient(160deg, #f7f8fa 0%, #ebeef2 100%)",
                      sheet: "linear-gradient(180deg, rgba(255,255,255,0.60) 0%, rgba(251,252,254,0.38) 100%)",
                      ink: "#1a1d20",
                      hl: "rgba(45,55,72,0.18)",
                    },
                    {
                      id: "sepia" as Theme,
                      label: t.themes.sepia,
                      ambient:
                        "radial-gradient(850px 700px at 4% 0%, rgba(214, 185, 150, 0.55) 0%, rgba(214, 185, 150, 0) 65%), radial-gradient(950px 750px at 96% 8%, rgba(175, 155, 130, 0.30) 0%, rgba(175, 155, 130, 0) 62%), linear-gradient(160deg, #f4eee4 0%, #eae2d4 100%)",
                      sheet: "linear-gradient(180deg, rgba(250,244,232,0.62) 0%, rgba(243,234,216,0.40) 100%)",
                      ink: "#3a2e20",
                      hl: "rgba(200,165,110,0.35)",
                    },
                    {
                      id: "dark" as Theme,
                      label: t.themes.dark,
                      ambient:
                        "radial-gradient(850px 700px at 4% 0%, rgba(65, 76, 92, 0.45) 0%, rgba(65, 76, 92, 0) 65%), radial-gradient(950px 750px at 96% 8%, rgba(42, 52, 65, 0.55) 0%, rgba(42, 52, 65, 0) 62%), linear-gradient(160deg, #101216 0%, #090a0d 100%)",
                      sheet: "linear-gradient(180deg, rgba(22,25,30,0.54) 0%, rgba(14,16,20,0.38) 100%)",
                      ink: "#e6e9ed",
                      hl: "rgba(154,179,207,0.25)",
                    },
                  ].map((option) => {
                    const isActive = theme === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        onClick={() => setTheme(option.id)}
                        className="tile text-left p-0 border-0 rounded-[20px] overflow-hidden cursor-pointer flex flex-col"
                        style={{
                          background: isActive ? "var(--tile-on)" : "var(--tile-off)",
                          boxShadow: isActive ? "inset 0 0 0 1.5px var(--accent-border), var(--shadow-tile-on)" : "var(--shadow-tile-off)",
                          color: "var(--ink)",
                        }}
                      >
                        <span
                          className="m-1.5 p-3.5 rounded-2xl block"
                          style={{ background: option.ambient }}
                        >
                          <span
                            className="block p-2.5 rounded-[10px] font-serif text-[15px] leading-normal"
                            style={{ background: option.sheet, color: option.ink }}
                          >
                            {t.settings.appearanceSample.before}
                            <span className="rounded px-1 py-0.5" style={{ background: option.hl }}>
                              {t.settings.appearanceSample.highlight}
                            </span>
                            …
                          </span>
                        </span>
                        <span className="p-3 pt-2 text-sm font-medium">{option.label}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-3.5 p-1 pt-2">
                  <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                    {t.settings.textSize}
                  </span>
                  <div
                    role="radiogroup"
                    aria-label={t.settings.textSize}
                    className="flex flex-wrap gap-0.5 p-1 rounded-full"
                    style={{
                      background: "var(--glass-seg)",
                      boxShadow: "var(--ring-seg)",
                    }}
                  >
                    {[
                      { key: "sm" as FontSize, label: t.fontSizes.sm, fs: "13px" },
                      { key: "base" as FontSize, label: t.fontSizes.base, fs: "15px" },
                      { key: "lg" as FontSize, label: t.fontSizes.lg, fs: "17px" },
                      { key: "xl" as FontSize, label: t.fontSizes.xl, fs: "19px" },
                    ].map((z) => {
                      const active = fontSize === z.key;
                      return (
                        <button
                          key={z.key}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => {
                            setFontSize(z.key);
                            savePreferences({ font_size: z.key });
                          }}
                          className="quiet h-[34px] px-3.5 rounded-full border-0 font-serif cursor-pointer transition"
                          style={{
                            fontSize: z.fs,
                            background: active ? "var(--glass-seg-on)" : "transparent",
                            boxShadow: active ? "var(--shadow-seg-on)" : "none",
                            color: "var(--ink)",
                          }}
                        >
                          {z.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>

            {/* Actualizaciones */}
            <section aria-labelledby="updates-title" className="flex flex-wrap gap-5 lg:gap-14 py-8">
              <div className="flex-1 min-w-[280px] max-w-[380px]">
                <h2 id="updates-title" className="m-0 text-base font-medium" style={{ color: "var(--ink)" }}>
                  {t.settings.updates}
                </h2>
                <p className="m-0 mt-1.5 text-sm" style={{ color: "var(--muted)" }}>
                  {t.settings.updatesHint}
                </p>
              </div>

              <div
                className="glass flex-[999_1_560px] min-w-0 p-2.5 rounded-[26px] flex flex-col gap-2.5"
                style={{
                  background: "var(--glass-sub)",
                  boxShadow: "var(--ring-sub)",
                }}
              >
                <div
                  className="p-4 rounded-[20px] flex flex-wrap items-center justify-between gap-4"
                  style={{ background: "var(--tile-off)", boxShadow: "var(--shadow-tile-off)" }}
                >
                  <div className="min-w-0">
                    <p className="m-0 text-[15px] font-medium" style={{ color: "var(--ink)" }}>
                      {t.settings.installedVersion(updateInfo?.current_version ?? "…")}
                    </p>
                    {updateMessage && (
                      <p className="m-0 mt-1 text-sm" style={{ color: "var(--soft)" }}>
                        {updateMessage}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleCheckUpdates}
                    disabled={checkingUpdates}
                    className="glbtn inline-flex items-center gap-2 h-10 px-4 rounded-full border-0 text-sm font-medium cursor-pointer disabled:opacity-60"
                    style={{ background: "var(--btn-ghost)", color: "var(--ink)" }}
                  >
                    {checkingUpdates ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RotateCcw className="w-4 h-4" />
                    )}
                    <span>{t.settings.checkUpdates}</span>
                  </button>
                </div>

                <div
                  className="p-4 rounded-[20px] flex items-center justify-between gap-4 transition"
                  style={{
                    background: autoCheckUpdates ? "var(--glass-seg-on)" : "var(--tile-off)",
                    boxShadow: autoCheckUpdates
                      ? "inset 0 0 0 1.5px var(--accent-border), var(--shadow-tile-on)"
                      : "var(--shadow-tile-off)",
                  }}
                >
                  <div className="flex-1 min-w-0 pr-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[15px] font-medium" style={{ color: "var(--ink)" }}>
                        {t.settings.checkOnLaunch}
                      </span>
                      <span className="text-xs" style={{ color: "var(--muted)" }}>
                        {t.common.default}
                      </span>
                    </div>
                    <p className="m-0 mt-1 text-sm leading-relaxed" style={{ color: "var(--soft)" }}>
                      {t.settings.checkOnLaunchDescription}
                    </p>
                  </div>

                  <label
                    htmlFor="auto-check-updates-toggle"
                    className="relative inline-flex items-center shrink-0 cursor-pointer select-none"
                    aria-label={t.settings.checkOnLaunchLabel}
                  >
                    <input
                      id="auto-check-updates-toggle"
                      type="checkbox"
                      checked={autoCheckUpdates}
                      onChange={(e) => handleAutoCheckUpdatesChange(e.target.checked)}
                      className="sr-only"
                    />
                    <div
                      className="w-12 h-7 rounded-full transition-colors flex items-center px-0.5"
                      style={{
                        background: autoCheckUpdates ? "var(--accent)" : "var(--dot-off)",
                      }}
                    >
                      <div
                        className={`w-6 h-6 rounded-full bg-white shadow-md transform transition-transform ${
                          autoCheckUpdates ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </div>
                  </label>
                </div>
              </div>
            </section>

            <section aria-labelledby="uninstall-title" className="flex flex-wrap gap-5 lg:gap-14 py-8">
              <div className="flex-1 min-w-[280px] max-w-[380px]">
                <h2 id="uninstall-title" className="m-0 text-base font-medium" style={{ color: "var(--ink)" }}>
                  {t.settings.uninstall}
                </h2>
                <p className="m-0 mt-1.5 text-sm" style={{ color: "var(--muted)" }}>
                  {t.settings.uninstallHint}
                </p>
              </div>

              <div
                className="glass flex-[999_1_560px] min-w-0 p-2.5 rounded-[26px] flex flex-col gap-2.5"
                style={{
                  background: "var(--glass-sub)",
                  boxShadow: "var(--ring-sub)",
                }}
              >
                <div
                  className="p-4 rounded-[20px] flex flex-wrap items-center justify-between gap-4"
                  style={{ background: "var(--tile-off)", boxShadow: "var(--shadow-tile-off)" }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-[15px] font-medium" style={{ color: "var(--ink)" }}>
                      {t.settings.uninstallApp}
                    </p>
                    <p
                      role={uninstallPhase === "error" ? "alert" : undefined}
                      className="m-0 mt-1 text-sm leading-relaxed"
                      style={{ color: uninstallPhase === "error" ? "var(--danger)" : "var(--soft)" }}
                    >
                      {uninstallStatus}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={openUninstallConfirm}
                    disabled={!canUninstall || uninstallPhase === "uninstalling" || uninstallPhase === "started"}
                    className="glbtn inline-flex items-center gap-2 h-10 px-4 rounded-full border-0 text-sm font-medium cursor-pointer disabled:opacity-60"
                    style={{ background: "var(--btn-ghost)", color: "var(--danger)" }}
                  >
                    {uninstallPhase === "uninstalling" ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                    <span>{t.settings.uninstallButton}</span>
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}

        {updateDialogOpen && updateInfo && (
          <UpdateDialog
            info={updateInfo}
            mode="available"
            onClose={() => setUpdateDialogOpen(false)}
            onSkip={() => {
              setUpdateDialogOpen(false);
              if (updateInfo.latest_version) api.skipUpdate(updateInfo.latest_version).catch(() => {});
            }}
          />
        )}

        <ConfirmModal
          isOpen={uninstallConfirmOpen}
          title={t.settings.uninstallConfirmTitle}
          message={
            <>
              {t.settings.uninstallConfirmBody}
              <label className="mt-4 flex items-start gap-2.5 cursor-pointer select-none" style={{ color: "var(--ink)" }}>
                <input
                  type="checkbox"
                  checked={deleteLibrary}
                  onChange={(e) => setDeleteLibrary(e.target.checked)}
                  className="mt-0.5 w-4 h-4 shrink-0 cursor-pointer"
                  style={{ accentColor: "var(--danger)" }}
                />
                <span>{t.settings.uninstallDeleteLibrary}</span>
              </label>
            </>
          }
          confirmLabel={t.settings.uninstallConfirm}
          destructive
          onConfirm={handleUninstall}
          onCancel={() => setUninstallConfirmOpen(false)}
        />

        {error && (
          <p
            role="alert"
            className="text-xs font-medium rounded-xl px-4 py-3 my-6"
            style={{
              background: "rgba(143,58,51,0.1)",
              color: "var(--danger)",
              border: "1px solid var(--danger)",
            }}
          >
            {error}
          </p>
        )}

        <footer className="pt-8 border-t" style={{ borderColor: "var(--track)" }}>
          <p className="m-0 text-[13px]" style={{ color: "var(--muted)" }}>
            Letha{updateInfo ? ` ${updateInfo.current_version}` : ""} · {t.settings.footer}
          </p>
        </footer>
      </main>
    </div>
  );
}

export default function SettingsPage() {
  const { t } = useI18n();
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center gap-3" style={{ color: "var(--muted)" }}>
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--accent)" }} />
          <span className="text-sm">{t.settings.loading}</span>
        </div>
      }
    >
      <SettingsContent />
    </Suspense>
  );
}
