"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlignLeft,
  ArrowLeft,
  Check,
  Loader2,
  MousePointerClick,
  PlayCircle,
  RotateCcw,
  Settings,
  Sparkles,
  Type,
} from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { api } from "@/lib/api";

const DEFAULT_PERCENT = 85;
const PRESET_PERCENTS = [75, 80, 85, 90, 95, 100];

function SettingsContent() {
  const searchParams = useSearchParams();
  const bookId = searchParams.get("bookId");

  const [percent, setPercent] = useState<number>(DEFAULT_PERCENT);
  const [autoAdvance, setAutoAdvance] = useState<boolean>(true);
  const [boundaryType, setBoundaryType] = useState<"SentenceBoundary" | "WordBoundary">(
    "SentenceBoundary"
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [savedNotice, setSavedNotice] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .getAppSettings()
      .then((s) => {
        setPercent(Math.round((s.edge_base_speed || 0.85) * 100));
        setAutoAdvance(s.auto_advance_sentence ?? true);
        setBoundaryType(
          s.boundary_type === "WordBoundary" ? "WordBoundary" : "SentenceBoundary"
        );
      })
      .catch((err) => {
        console.error("Error al cargar configuración:", err);
        setError("No se pudo cargar la configuración actual.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const rateDiff = percent - 100;
  const rateLabel = rateDiff >= 0 ? `+${rateDiff}%` : `${rateDiff}%`;

  const saveSettings = async (
    nextPercent: number,
    nextAutoAdvance: boolean,
    nextBoundary: "SentenceBoundary" | "WordBoundary"
  ) => {
    setSaving(true);
    setError(null);
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
  };

  const handleModeChange = (nextAuto: boolean) => {
    setAutoAdvance(nextAuto);
    saveSettings(percent, nextAuto, boundaryType);
  };

  const handleBoundaryChange = (nextBoundary: "SentenceBoundary" | "WordBoundary") => {
    setBoundaryType(nextBoundary);
    saveSettings(percent, autoAdvance, nextBoundary);
  };

  const handlePresetClick = (p: number) => {
    setPercent(p);
    saveSettings(p, autoAdvance, boundaryType);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center">
                <Settings className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                  Configuración
                </h1>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Personaliza el modo de lectura, la selección de palabras y la velocidad nativa de síntesis de voz.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {savedNotice && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <Check className="w-3.5 h-3.5" />
                <span>Cambios guardados</span>
              </span>
            )}

            {bookId ? (
              <Link
                href={`/reader?id=${bookId}`}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white shadow-sm transition"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Volver al libro</span>
              </Link>
            ) : (
              <Link
                href="/"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Volver a la biblioteca</span>
              </Link>
            )}
          </div>
        </div>

        {loading ? (
          <div className="py-24 flex flex-col items-center justify-center gap-3 text-zinc-400">
            <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
            <span className="text-sm">Cargando configuración...</span>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Sección 1: Modo de avance de oraciones */}
            <section className="p-6 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-4">
              <div>
                <h2 className="text-base font-bold flex items-center gap-2">
                  <MousePointerClick className="w-4 h-4 text-amber-500" />
                  <span>Modo de lectura de oraciones</span>
                </h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                  Elige si deseas que la lectura avance de corrido oración tras oración o que se lea únicamente la frase que selecciones con un clic. Cambiar esta opción no realiza solicitudes adicionales a Edge-TTS.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                <button
                  type="button"
                  onClick={() => handleModeChange(true)}
                  className={`flex flex-col items-start gap-2 p-4 rounded-2xl border text-left transition ${
                    autoAdvance
                      ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/40"
                      : "border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-800/40 text-zinc-700 dark:text-zinc-300 hover:border-amber-400"
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-2 font-bold text-sm">
                      <PlayCircle className="w-4 h-4 text-amber-500 shrink-0" />
                      <span>Lectura en automático</span>
                    </div>
                    <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
                      Por defecto
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed opacity-85">
                    Lee una oración enseguida de la otra de forma continua mientras las va resaltando en la página.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => handleModeChange(false)}
                  className={`flex flex-col items-start gap-2 p-4 rounded-2xl border text-left transition ${
                    !autoAdvance
                      ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/40"
                      : "border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-800/40 text-zinc-700 dark:text-zinc-300 hover:border-amber-400"
                  }`}
                >
                  <div className="flex items-center gap-2 font-bold text-sm">
                    <MousePointerClick className="w-4 h-4 text-amber-500 shrink-0" />
                    <span>Solo al clickear la frase</span>
                  </div>
                  <p className="text-xs leading-relaxed opacity-85">
                    Reproduce únicamente la oración en la que hagas clic y se detiene automáticamente al terminarla.
                  </p>
                </button>
              </div>
            </section>

            {/* Sección 2: Granularidad de sincronización (SentenceBoundary vs WordBoundary) */}
            <section className="p-6 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-4">
              <div>
                <h2 className="text-base font-bold flex items-center gap-2">
                  <Type className="w-4 h-4 text-amber-500" />
                  <span>Granularidad de marcas de voz (SentenceBoundary vs WordBoundary)</span>
                </h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                  Controla el tipo de marcas de tiempo que solicita Letha a Edge-TTS en cada fragmento de página.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                <button
                  type="button"
                  onClick={() => handleBoundaryChange("SentenceBoundary")}
                  className={`flex flex-col items-start gap-2 p-4 rounded-2xl border text-left transition ${
                    boundaryType === "SentenceBoundary"
                      ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/40"
                      : "border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-800/40 text-zinc-700 dark:text-zinc-300 hover:border-amber-400"
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-2 font-bold text-sm">
                      <AlignLeft className="w-4 h-4 text-amber-500 shrink-0" />
                      <span>Por oración (SentenceBoundary)</span>
                    </div>
                    <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
                      Por defecto
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed opacity-85">
                    <strong>Mayor fluidez por oración:</strong> sincroniza y selecciona oraciones completas de principio a fin, ideal para lectura fluida por bloques.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => handleBoundaryChange("WordBoundary")}
                  className={`flex flex-col items-start gap-2 p-4 rounded-2xl border text-left transition ${
                    boundaryType === "WordBoundary"
                      ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/40"
                      : "border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-800/40 text-zinc-700 dark:text-zinc-300 hover:border-amber-400"
                  }`}
                >
                  <div className="flex items-center gap-2 font-bold text-sm">
                    <Type className="w-4 h-4 text-amber-500 shrink-0" />
                    <span>Por palabra (WordBoundary)</span>
                  </div>
                  <p className="text-xs leading-relaxed opacity-85">
                    <strong>Permite seleccionar palabras individuales:</strong> extrae el tiempo exacto de cada palabra para que puedas hacer clic en cualquier palabra de una frase y escuchar solo esa palabra.
                  </p>
                </button>
              </div>
            </section>

            {/* Sección 3: Velocidad nativa de Edge-TTS */}
            <section className="p-6 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-500" />
                    <span>Velocidad nativa de lectura (Edge-TTS)</span>
                  </h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                    Define la velocidad a la que el modelo neural de Microsoft Edge-TTS genera el audio de origen, conservando la entonación natural sin distorsión.
                  </p>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
                  <span className="text-2xl font-extrabold text-amber-600 dark:text-amber-400 tabular-nums">
                    {percent}%
                  </span>
                  <span className="text-xs font-mono px-2 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
                    rate {rateLabel}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <input
                  type="range"
                  min={50}
                  max={120}
                  step={1}
                  value={percent}
                  onChange={(e) => setPercent(Number(e.target.value))}
                  onMouseUp={() => saveSettings(percent, autoAdvance, boundaryType)}
                  onTouchEnd={() => saveSettings(percent, autoAdvance, boundaryType)}
                  className="w-full h-2 bg-zinc-200 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
                <div className="flex justify-between text-xs text-zinc-400 font-medium">
                  <span>50% (Más lento)</span>
                  <span>85% (Por defecto)</span>
                  <span>100% (Estándar Edge)</span>
                  <span>120%</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  {PRESET_PERCENTS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => handlePresetClick(p)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                        percent === p
                          ? "bg-amber-500 text-white shadow-sm"
                          : "bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:border-amber-400"
                      }`}
                    >
                      {p}%{p === DEFAULT_PERCENT ? " · Por defecto" : ""}
                    </button>
                  ))}

                  {percent !== DEFAULT_PERCENT && (
                    <button
                      type="button"
                      onClick={() => handlePresetClick(DEFAULT_PERCENT)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-zinc-500 hover:text-amber-500 transition"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Restaurar al 85%</span>
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => saveSettings(percent, autoAdvance, boundaryType)}
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white shadow-sm disabled:opacity-50 transition"
                >
                  {saving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                  <span>Guardar configuración</span>
                </button>
              </div>
            </section>

            {error && (
              <p className="text-xs font-medium text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-xl px-4 py-3">
                {error}
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-zinc-400 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
          <span className="text-sm">Cargando configuración...</span>
        </div>
      }
    >
      <SettingsContent />
    </Suspense>
  );
}
