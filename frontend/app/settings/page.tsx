"use client";

import React, { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, Play, RotateCcw, Square } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { api } from "@/lib/api";

const DEFAULT_PERCENT = 85;
const PRESET_PERCENTS = [75, 80, 85, 90, 95, 100];
const DEFAULT_VOICE = "es-MX-DaliaNeural";

type Boundary = "SentenceBoundary" | "WordBoundary";

interface OptionDef<T> {
  value: T;
  title: string;
  description: string;
  isDefault?: boolean;
  technical?: string;
  example?: React.ReactNode;
}

const HIGHLIGHT = "var(--read-highlight)";

function OptionGrid<T extends string | boolean>({
  name,
  legend,
  description,
  options,
  value,
  onChange,
}: {
  name: string;
  legend: string;
  description: string;
  options: OptionDef<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="border-t py-12" style={{ borderColor: "var(--line)" }}>
      <legend className="sr-only">{legend}</legend>
      <h2 className="text-lg font-bold text-[#eaf1fa]" aria-hidden="true">
        {legend}
      </h2>
      <p className="text-sm text-[#93a3b8] mt-1 mb-6 max-w-3xl">{description}</p>

      <div
        className="grid"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          borderTop: "1px solid var(--line)",
          borderLeft: "1px solid var(--line)",
        }}
      >
        {options.map((opt, idx) => {
          const selected = opt.value === value;
          const id = `${name}-${String(opt.value)}`;
          return (
            <label
              key={id}
              htmlFor={id}
              className={`animate-rise-gradient flex gap-3 p-6 cursor-pointer transition-colors ${
                selected ? "" : "hover:bg-[#0e1d33]/60"
              }`}
              style={{
                animationDelay: `${idx * 80}ms`,
                borderRight: "1px solid var(--line)",
                borderBottom: "1px solid var(--line)",
                backgroundColor: selected ? "var(--panel)" : "transparent",
                boxShadow: selected ? "inset 0 2px 0 var(--accent)" : "none",
              }}
            >
              <input
                id={id}
                type="radio"
                name={name}
                checked={selected}
                onChange={() => onChange(opt.value)}
                className="mt-1 w-4 h-4 shrink-0 cursor-pointer"
                style={{ accentColor: "var(--accent)" }}
              />
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-sm text-[#eaf1fa]">{opt.title}</span>
                  {opt.isDefault && (
                    <span
                      className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border text-[#64c7f5]"
                      style={{ borderColor: "var(--line-strong)" }}
                    >
                      Por defecto
                    </span>
                  )}
                </div>
                {opt.technical && (
                  <p className="text-xs font-mono text-[#64c7f5]">{opt.technical}</p>
                )}
                <p className="text-xs leading-relaxed text-[#c3cfdd]">{opt.description}</p>
                {opt.example && (
                  <div
                    className="mt-3 p-3 rounded-lg border text-sm text-[#eaf1fa] font-serif"
                    style={{ backgroundColor: "var(--bg)", borderColor: "var(--line)" }}
                  >
                    {opt.example}
                  </div>
                )}
              </div>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function SettingsContent() {
  const searchParams = useSearchParams();
  const bookId = searchParams.get("bookId");

  const [percent, setPercent] = useState<number>(DEFAULT_PERCENT);
  const [autoAdvance, setAutoAdvance] = useState<boolean>(true);
  const [boundaryType, setBoundaryType] = useState<Boundary>("SentenceBoundary");
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [savedNotice, setSavedNotice] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [sampleVoice, setSampleVoice] = useState<string>(DEFAULT_VOICE);
  const [sampleState, setSampleState] = useState<"idle" | "loading" | "playing">("idle");

  const savePromiseRef = useRef<Promise<void> | null>(null);
  const sampleAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .getAppSettings()
      .then((s) => {
        setPercent(Math.round((s.edge_base_speed || 0.85) * 100));
        setAutoAdvance(s.auto_advance_sentence ?? true);
        setBoundaryType(s.boundary_type === "WordBoundary" ? "WordBoundary" : "SentenceBoundary");
      })
      .catch((err) => {
        console.error("Error al cargar configuración:", err);
        setError("No se pudo cargar la configuración actual.");
      })
      .finally(() => setLoading(false));

    // Voz para la muestra: la del libro abierto (si se llegó desde el lector) o la del último libro leído
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

  const saveSettings = (nextPercent: number, nextAutoAdvance: boolean, nextBoundary: Boundary) => {
    setSaving(true);
    setError(null);
    const p = (async () => {
      try {
        const decimal = Number((nextPercent / 100).toFixed(2));
        await api.updateAppSettings({
          edge_base_speed: decimal,
          auto_advance_sentence: nextAutoAdvance,
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
    saveSettings(percent, nextAuto, boundaryType);
  };

  const handleBoundaryChange = (nextBoundary: Boundary) => {
    setBoundaryType(nextBoundary);
    saveSettings(percent, autoAdvance, nextBoundary);
  };

  const handlePresetClick = (p: number) => {
    setPercent(p);
    saveSettings(p, autoAdvance, boundaryType);
  };

  const handleSample = async () => {
    if (sampleState === "playing") {
      sampleAudioRef.current?.pause();
      setSampleState("idle");
      return;
    }
    setSampleState("loading");
    try {
      // Asegurar que la velocidad elegida ya está guardada antes de pedir la muestra
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
    },
    {
      value: false,
      title: "Solo al clickear la frase",
      description:
        "Reproduce únicamente la oración en la que hagas clic y se detiene automáticamente al terminarla.",
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
          <span style={{ backgroundColor: HIGHLIGHT }} className="rounded px-0.5">
            It was a place that she would like.
          </span>{" "}
          <span className="text-[#93a3b8]">She always dreamed of it.</span>
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
          It was a{" "}
          <span style={{ backgroundColor: HIGHLIGHT }} className="rounded px-0.5">
            place
          </span>{" "}
          that she would like.
        </span>
      ),
    },
  ];

  const presetActiveStyle = {
    background: "var(--primary-btn-bg)",
    color: "var(--primary-btn-text)",
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "var(--bg)" }}>
      <Navbar />

      <main className="flex-1 w-full max-w-[1320px] mx-auto px-[28px] pt-[72px] pb-16">
        {/* Encabezado */}
        <header className="flex flex-wrap items-end justify-between gap-4 pb-12">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#eaf1fa]">
              Configuración
            </h1>
            <p className="text-sm text-[#c3cfdd] mt-1">
              Personaliza el modo de lectura, la selección de palabras y la velocidad de la voz. Los cambios se guardan solos.
            </p>
          </div>

          <Link
            href={bookId ? `/reader?id=${bookId}` : "/"}
            className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border text-[#eaf1fa] hover:bg-[#0e1d33] transition"
            style={{ borderColor: "var(--line-strong)" }}
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{bookId ? "Volver al libro" : "Volver a la biblioteca"}</span>
          </Link>
        </header>

        {loading ? (
          <div className="py-24 flex flex-col items-center justify-center gap-3 text-[#93a3b8]">
            <Loader2 className="w-8 h-8 animate-spin text-[#1ea7e8]" />
            <span className="text-sm">Cargando configuración...</span>
          </div>
        ) : (
          <>
            <OptionGrid
              name="reading-mode"
              legend="Modo de lectura"
              description="Elige si la lectura avanza de corrido oración tras oración o si solo se lee la frase que selecciones. Cambiar esta opción no realiza solicitudes adicionales a Edge-TTS."
              options={modeOptions}
              value={autoAdvance}
              onChange={handleModeChange}
            />

            <OptionGrid
              name="boundary"
              legend="Granularidad de marcas de voz"
              description="Controla el tipo de marcas de tiempo que Letha solicita a Edge-TTS en cada fragmento de página."
              options={boundaryOptions}
              value={boundaryType}
              onChange={handleBoundaryChange}
            />

            {/* Velocidad de la voz */}
            <section
              className="border-t py-12 space-y-8"
              style={{ borderColor: "var(--line)" }}
              aria-labelledby="speed-title"
            >
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="max-w-3xl">
                  <h2 id="speed-title" className="text-lg font-bold text-[#eaf1fa]">
                    Velocidad de la voz
                  </h2>
                  <p className="text-sm text-[#93a3b8] mt-1">
                    Define la velocidad a la que el modelo neural de Edge-TTS genera el audio de origen, conservando la entonación natural sin distorsión.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-extrabold text-[#eaf1fa] tabular-nums">
                    {percent}%
                  </span>
                  <span
                    className="text-xs font-mono px-2 py-1 rounded-lg border text-[#64c7f5]"
                    style={{ borderColor: "var(--line-strong)" }}
                  >
                    rate {rateLabel}
                  </span>
                </div>
              </div>

              <div className="space-y-3">
                <label htmlFor="speed-slider" className="sr-only">
                  Velocidad de la voz en porcentaje
                </label>
                <div className="h-[44px] flex items-center">
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
                </div>
                <div className="flex justify-between text-xs text-[#93a3b8] font-medium">
                  <span>50% · Lento</span>
                  <span>85% · Recomendado</span>
                  <span>100% · Edge</span>
                  <span>120%</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {PRESET_PERCENTS.map((p) => {
                  const active = percent === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => handlePresetClick(p)}
                      aria-pressed={active}
                      className={`min-h-[44px] px-3 py-1.5 rounded-xl text-xs font-semibold transition border ${
                        active ? "text-[#0a1729] border-transparent" : "text-[#c3cfdd] hover:text-[#64c7f5]"
                      }`}
                      style={active ? presetActiveStyle : { borderColor: "var(--line-strong)" }}
                    >
                      {p}%{p === DEFAULT_PERCENT ? " · Recomendado" : ""}
                    </button>
                  );
                })}

                {percent !== DEFAULT_PERCENT && (
                  <button
                    type="button"
                    onClick={() => handlePresetClick(DEFAULT_PERCENT)}
                    className="min-h-[44px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-[#93a3b8] hover:text-[#64c7f5] transition"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Restaurar a 85%</span>
                  </button>
                )}
              </div>

              <div
                className="animate-rise-gradient flex flex-wrap items-center justify-between gap-4 p-6 rounded-2xl border"
                style={{
                  backgroundColor: "var(--panel)",
                  borderColor: "var(--line)",
                  animationDelay: "160ms",
                }}
              >
                <div>
                  <p className="text-sm font-semibold text-[#eaf1fa]">Escucha una muestra</p>
                  <p className="text-xs text-[#93a3b8] mt-0.5">
                    Reproduce una frase corta a {percent}% con la voz de tu libro.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleSample}
                  disabled={sampleState === "loading"}
                  className="min-h-[44px] inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-[#0a1729] disabled:opacity-60 transition hover:opacity-95"
                  style={presetActiveStyle}
                >
                  {sampleState === "loading" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : sampleState === "playing" ? (
                    <Square className="w-4 h-4 fill-current" />
                  ) : (
                    <Play className="w-4 h-4 fill-current" />
                  )}
                  <span>{sampleState === "playing" ? "Detener" : "Probar velocidad"}</span>
                </button>
              </div>
            </section>

            {error && (
              <p
                role="alert"
                className="text-xs font-medium text-red-300 border border-red-400/30 rounded-xl px-4 py-3 mb-6"
              >
                {error}
              </p>
            )}

            {/* Pie */}
            <footer
              className="border-t pt-8 flex items-center gap-2 text-xs text-[#93a3b8]"
              style={{ borderColor: "var(--line)" }}
              aria-live="polite"
            >
              {saving ? (
                <Loader2 className="w-3 h-3 animate-spin text-[#1ea7e8]" />
              ) : (
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: "var(--accent)" }}
                  aria-hidden="true"
                />
              )}
              <span>
                {saving
                  ? "Guardando…"
                  : savedNotice
                  ? "Cambios guardados"
                  : "Cambios guardados en este equipo"}
              </span>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-[#93a3b8] gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-[#1ea7e8]" />
          <span className="text-sm">Cargando configuración...</span>
        </div>
      }
    >
      <SettingsContent />
    </Suspense>
  );
}
