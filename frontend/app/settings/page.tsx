"use client";

import React, { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Check, Loader2, Play, RotateCcw, Square } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { UpdateDialog } from "@/components/UpdateDialog";
import { api, UpdateInfo } from "@/lib/api";
import { Theme, useTheme } from "@/lib/useTheme";

const DEFAULT_PERCENT = 85;
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
                      Por defecto
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

  const { theme, setTheme } = useTheme();
  const [fontSize, setFontSize] = useState<FontSize>("base");

  const savePromiseRef = useRef<Promise<void> | null>(null);
  const sampleAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    try {
      const savedFont = (localStorage.getItem("letha_fontsize") as FontSize) || "base";
      setFontSize(savedFont);
    } catch {}

    setLoading(true);
    api
      .getAppSettings()
      .then((s) => {
        setPercent(Math.round((s.edge_base_speed || 0.85) * 100));
        setAutoAdvance(s.auto_advance_sentence ?? true);
        setAutoAdvancePage(s.auto_advance_page ?? true);
        setBoundaryType(s.boundary_type === "WordBoundary" ? "WordBoundary" : "SentenceBoundary");
        setAutoCheckUpdates(s.auto_check_updates ?? true);
      })
      .catch((err) => {
        console.error("Error al cargar configuración:", err);
        setError("No se pudo cargar la configuración actual.");
      })
      .finally(() => setLoading(false));

    api.getUpdates().then(setUpdateInfo).catch(() => {});

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
        setError(err.message || "No se pudo guardar la configuración.");
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

  const handleAutoCheckUpdatesChange = (enabled: boolean) => {
    setAutoCheckUpdates(enabled);
    api.updateAppSettings({ auto_check_updates: enabled }).catch((err) => {
      setError(err.message || "No se pudo guardar la configuración.");
    });
  };

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true);
    setUpdateMessage(null);
    try {
      const info = await api.getUpdates(true);
      setUpdateInfo(info);
      if (info.error) {
        setUpdateMessage(info.error);
      } else if (info.update_available) {
        setUpdateDialogOpen(true);
      } else {
        setUpdateMessage(
          info.latest_version
            ? `Tienes la última versión (${info.current_version}).`
            : "Todavía no hay versiones publicadas."
        );
      }
    } catch (err: any) {
      setUpdateMessage(err.message || "No se pudo buscar actualizaciones.");
    } finally {
      setCheckingUpdates(false);
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

  const modeOptions: OptionDef<boolean>[] = [
    {
      value: true,
      title: "Lectura en automático",
      isDefault: true,
      description:
        "Lee una oración enseguida de la otra de forma continua mientras las va resaltando en la página.",
      example: (
        <span>
          <span className="rounded px-1 py-0.5" style={{ background: "var(--hl)" }}>
            En un lugar de la Mancha,
          </span>{" "}
          <span className="rounded px-1 py-0.5" style={{ background: "var(--hl)" }}>
            de cuyo nombre no quiero acordarme,
          </span>{" "}
          <span style={{ color: "var(--faded)" }}>no ha mucho tiempo…</span>
        </span>
      ),
    },
    {
      value: false,
      title: "Solo al clickear la frase",
      description:
        "Reproduce únicamente la oración en la que hagas clic y se detiene automáticamente al terminarla.",
      example: (
        <span>
          <span className="rounded px-1 py-0.5" style={{ background: "var(--hl)" }}>
            En un lugar de la Mancha,
          </span>{" "}
          <span style={{ color: "var(--faded)" }}>de cuyo nombre no quiero acordarme, no ha mucho tiempo…</span>
        </span>
      ),
    },
  ];

  const boundaryOptions: OptionDef<Boundary>[] = [
    {
      value: "SentenceBoundary",
      title: "Por oración",
      technical: "SentenceBoundary",
      isDefault: true,
      description:
        "Mayor fluidez por oración: sincroniza y selecciona oraciones completas de principio a fin, ideal para lectura fluida por bloques.",
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
      title: "Por palabra",
      technical: "WordBoundary",
      description:
        "Permite seleccionar palabras individuales: extrae el tiempo exacto de cada palabra para que puedas hacer clic en cualquier palabra de una frase y escuchar solo esa palabra.",
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
              Configuración
            </h1>
            <p className="m-0 mt-2.5 text-base" style={{ color: "var(--muted)" }}>
              Cómo te lee Letha. Los cambios se guardan solos en este equipo.
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
                {saving
                  ? "Guardando…"
                  : savedNotice
                  ? "Cambios guardados"
                  : "Cambios guardados en este equipo"}
              </span>
            </p>

            <Link
              href={bookId ? `/reader?id=${bookId}` : "/"}
              className="quiet inline-flex items-center gap-2 h-10 px-4 rounded-full text-sm font-medium no-underline"
              style={{ color: "var(--ink)" }}
            >
              <ArrowLeft className="w-4 h-4" strokeWidth={1.6} />
              <span>{bookId ? "Volver al libro" : "Volver a la biblioteca"}</span>
            </Link>
          </div>
        </header>

        {loading ? (
          <div className="py-24 flex flex-col items-center justify-center gap-3" style={{ color: "var(--muted)" }}>
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--accent)" }} />
            <span className="text-sm">Cargando configuración...</span>
          </div>
        ) : (
          <div className="divide-y divide-[var(--track)]">
            <OptionGrid
              name="reading-mode"
              legend="Modo de lectura"
              description="Elige si la lectura avanza de corrido oración tras oración o si solo se lee la frase que selecciones."
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
                        Pasar páginas automáticamente
                      </span>
                      <span className="text-xs" style={{ color: "var(--muted)" }}>
                        Por defecto
                      </span>
                    </div>
                    <p className="m-0 mt-1 text-sm leading-relaxed" style={{ color: "var(--soft)" }}>
                      Al terminar de escuchar la última frase de la página, pasa a la siguiente y continúa la lectura sin detenerse.
                    </p>
                  </div>

                  <label
                    htmlFor="auto-advance-page-toggle"
                    className="relative inline-flex items-center shrink-0 cursor-pointer select-none"
                    aria-label="Pasar páginas automáticamente"
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
              legend="Resaltar mientras escuchas"
              description="Ajusta la forma en que el lector segmenta el texto y la fluidez con la que lee."
              options={boundaryOptions}
              value={boundaryType}
              onChange={handleBoundaryChange}
            />

            {/* Velocidad de la voz */}
            <section aria-labelledby="speed-title" className="flex flex-wrap gap-5 lg:gap-14 py-8">
              <div className="flex-1 min-w-[280px] max-w-[380px]">
                <h2 id="speed-title" className="m-0 text-base font-medium" style={{ color: "var(--ink)" }}>
                  Velocidad de la voz
                </h2>
                <p className="m-0 mt-1.5 text-sm" style={{ color: "var(--muted)" }}>
                  La velocidad con la que se genera el audio. A diferencia del control 1.0× del lector, conserva la entonación natural sin distorsión.
                </p>
                <p className="m-0 mt-3 text-sm" style={{ color: "var(--muted)" }}>
                  Recomendado: 85%.
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
                    Velocidad de la voz en porcentaje
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
                  <div className="relative h-5 text-xs tabular-nums mt-1 select-none" style={{ color: "var(--muted)" }}>
                    <span className="absolute left-0">50% · Lento</span>
                    <span className="absolute left-1/2 -translate-x-1/2 font-medium" style={{ color: "var(--ink)" }}>
                      85% · Recomendado
                    </span>
                    <span className="absolute left-[71.4%] -translate-x-1/2">
                      100% · Edge
                    </span>
                    <span className="absolute right-0">120%</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div
                      role="group"
                      aria-label="Velocidades frecuentes"
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
                        <span>Restaurar a 85%</span>
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
                      {sampleState === "playing"
                        ? "Detener"
                        : "Probar velocidad"}
                    </span>
                  </button>
                </div>
              </div>
            </section>

            {/* Apariencia */}
            <section aria-labelledby="appearance-title" className="flex flex-wrap gap-5 lg:gap-14 py-8">
              <div className="flex-1 min-w-[280px] max-w-[380px]">
                <h2 id="appearance-title" className="m-0 text-base font-medium" style={{ color: "var(--ink)" }}>
                  Apariencia
                </h2>
                <p className="m-0 mt-1.5 text-sm" style={{ color: "var(--muted)" }}>
                  Claro, sepia u oscuro para toda la app. El texto se adapta automáticamente para máxima legibilidad.
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
                  aria-label="Tema"
                  className="grid grid-cols-1 sm:grid-cols-3 gap-2.5"
                >
                  {[
                    {
                      id: "light" as Theme,
                      label: "Claro",
                      ambient:
                        "radial-gradient(850px 700px at 4% 0%, rgba(195, 205, 218, 0.55) 0%, rgba(195, 205, 218, 0) 65%), radial-gradient(950px 750px at 96% 8%, rgba(165, 178, 192, 0.35) 0%, rgba(165, 178, 192, 0) 62%), linear-gradient(160deg, #f7f8fa 0%, #ebeef2 100%)",
                      sheet: "linear-gradient(180deg, rgba(255,255,255,0.60) 0%, rgba(251,252,254,0.38) 100%)",
                      ink: "#1a1d20",
                      hl: "rgba(45,55,72,0.18)",
                    },
                    {
                      id: "sepia" as Theme,
                      label: "Sepia",
                      ambient:
                        "radial-gradient(850px 700px at 4% 0%, rgba(214, 185, 150, 0.55) 0%, rgba(214, 185, 150, 0) 65%), radial-gradient(950px 750px at 96% 8%, rgba(175, 155, 130, 0.30) 0%, rgba(175, 155, 130, 0) 62%), linear-gradient(160deg, #f4eee4 0%, #eae2d4 100%)",
                      sheet: "linear-gradient(180deg, rgba(250,244,232,0.62) 0%, rgba(243,234,216,0.40) 100%)",
                      ink: "#3a2e20",
                      hl: "rgba(200,165,110,0.35)",
                    },
                    {
                      id: "dark" as Theme,
                      label: "Oscuro",
                      ambient:
                        "radial-gradient(850px 700px at 4% 0%, rgba(65, 76, 92, 0.45) 0%, rgba(65, 76, 92, 0) 65%), radial-gradient(950px 750px at 96% 8%, rgba(42, 52, 65, 0.55) 0%, rgba(42, 52, 65, 0) 62%), linear-gradient(160deg, #101216 0%, #090a0d 100%)",
                      sheet: "linear-gradient(180deg, rgba(22,25,30,0.54) 0%, rgba(14,16,20,0.38) 100%)",
                      ink: "#e6e9ed",
                      hl: "rgba(154,179,207,0.25)",
                    },
                  ].map((t) => {
                    const isActive = theme === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        onClick={() => setTheme(t.id)}
                        className="tile text-left p-0 border-0 rounded-[20px] overflow-hidden cursor-pointer flex flex-col"
                        style={{
                          background: isActive ? "var(--tile-on)" : "var(--tile-off)",
                          boxShadow: isActive ? "inset 0 0 0 1.5px var(--accent-border), var(--shadow-tile-on)" : "var(--shadow-tile-off)",
                          color: "var(--ink)",
                        }}
                      >
                        <span
                          className="m-1.5 p-3.5 rounded-2xl block"
                          style={{ background: t.ambient }}
                        >
                          <span
                            className="block p-2.5 rounded-[10px] font-serif text-[15px] leading-normal"
                            style={{ background: t.sheet, color: t.ink }}
                          >
                            Frisaba la edad de nuestro{" "}
                            <span className="rounded px-1 py-0.5" style={{ background: t.hl }}>
                              hidalgo
                            </span>
                            …
                          </span>
                        </span>
                        <span className="p-3 pt-2 text-sm font-medium">{t.label}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-3.5 p-1 pt-2">
                  <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                    Tamaño del texto
                  </span>
                  <div
                    role="radiogroup"
                    aria-label="Tamaño del texto"
                    className="flex flex-wrap gap-0.5 p-1 rounded-full"
                    style={{
                      background: "var(--glass-seg)",
                      boxShadow: "var(--ring-seg)",
                    }}
                  >
                    {[
                      { key: "sm" as FontSize, label: "Pequeño", fs: "13px" },
                      { key: "base" as FontSize, label: "Mediano", fs: "15px" },
                      { key: "lg" as FontSize, label: "Grande", fs: "17px" },
                      { key: "xl" as FontSize, label: "Muy grande", fs: "19px" },
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
                            try {
                              localStorage.setItem("letha_fontsize", z.key);
                            } catch {}
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
                  Actualizaciones
                </h2>
                <p className="m-0 mt-1.5 text-sm" style={{ color: "var(--muted)" }}>
                  Letha te avisa cuando hay una versión nueva y solo se actualiza cuando tú lo decides. Tu biblioteca y tu progreso se conservan.
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
                      Versión instalada: {updateInfo?.current_version ?? "…"}
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
                    <span>Buscar actualizaciones</span>
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
                        Buscar al abrir Letha
                      </span>
                      <span className="text-xs" style={{ color: "var(--muted)" }}>
                        Por defecto
                      </span>
                    </div>
                    <p className="m-0 mt-1 text-sm leading-relaxed" style={{ color: "var(--soft)" }}>
                      Consulta como mucho una vez al día si hay una versión nueva y te avisa en la biblioteca.
                    </p>
                  </div>

                  <label
                    htmlFor="auto-check-updates-toggle"
                    className="relative inline-flex items-center shrink-0 cursor-pointer select-none"
                    aria-label="Buscar actualizaciones al abrir Letha"
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
            Letha{updateInfo ? ` ${updateInfo.current_version}` : ""} · Las voces neurales vienen de Microsoft Edge TTS y necesitan conexión a internet.
          </p>
        </footer>
      </main>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center gap-3" style={{ color: "var(--muted)" }}>
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--accent)" }} />
          <span className="text-sm">Cargando configuración...</span>
        </div>
      }
    >
      <SettingsContent />
    </Suspense>
  );
}
