"use client";

import React, { useState, useRef, useEffect } from "react";
import { UploadCloud, X, Loader2, FileText, Volume2, User } from "lucide-react";
import { api, VoiceItem } from "@/lib/api";

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function UploadModal({ isOpen, onClose, onSuccess }: UploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [voices, setVoices] = useState<VoiceItem[]>([]);
  const [langFilter, setLangFilter] = useState<"es" | "en" | "all">("es");
  const [selectedVoice, setSelectedVoice] = useState("es-MX-DaliaNeural");
  const [previewing, setPreviewing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (isOpen && voices.length === 0) {
      api.getVoices().then(setVoices).catch(console.error);
    }
  }, [isOpen, voices.length]);

  const filteredVoices = voices.filter((v) => {
    if (langFilter === "es") return v.locale.toLowerCase().startsWith("es-");
    if (langFilter === "en") return v.locale.toLowerCase().startsWith("en-");
    return true;
  });

  useEffect(() => {
    if (filteredVoices.length > 0 && !filteredVoices.some((v) => v.short_name === selectedVoice)) {
      setSelectedVoice(filteredVoices[0].short_name);
    }
  }, [langFilter, voices]);

  if (!isOpen) return null;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const selected = e.dataTransfer.files[0];
      if (selected.name.toLowerCase().endsWith(".pdf")) {
        setFile(selected);
        setError(null);
      } else {
        setError("Por favor selecciona un archivo PDF.");
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      if (selected.name.toLowerCase().endsWith(".pdf")) {
        setFile(selected);
        setError(null);
      } else {
        setError("Por favor selecciona un archivo PDF.");
      }
    }
  };

  const handlePreviewVoice = async () => {
    if (!selectedVoice || previewing) return;
    setPreviewing(true);
    try {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
      }
      const audio = new Audio(api.getVoicePreviewUrl(selectedVoice));
      previewAudioRef.current = audio;
      audio.onended = () => setPreviewing(false);
      audio.onerror = () => setPreviewing(false);
      await audio.play();
    } catch {
      setPreviewing(false);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);

    try {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
      }
      await api.uploadBook(file, selectedVoice);
      setFile(null);
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || "Error al procesar el PDF");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-md p-6 shadow-xl relative">
        <button
          onClick={onClose}
          disabled={loading}
          className="absolute top-4 right-4 p-1 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-lg font-bold mb-1">Importar libro en PDF</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
          Selecciona tu PDF y elige la persona que narrará el libro.
        </p>

        {/* Selector de Persona / Narrador antes de cargar el libro */}
        <div className="mb-4 p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300">
              <User className="w-3.5 h-3.5 text-amber-500" />
              <span>Persona que habla (Narrador)</span>
            </label>

            <div className="flex items-center gap-1 text-[11px]">
              {(["es", "en", "all"] as const).map((lf) => (
                <button
                  key={lf}
                  type="button"
                  onClick={() => setLangFilter(lf)}
                  className={`px-2 py-0.5 rounded-md font-medium transition ${
                    langFilter === lf
                      ? "bg-amber-500 text-white"
                      : "text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  }`}
                >
                  {lf === "es" ? "Español" : lf === "en" ? "Inglés" : "Todos"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedVoice}
              onChange={(e) => setSelectedVoice(e.target.value)}
              disabled={loading}
              className="flex-1 text-xs font-medium bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer truncate"
            >
              {filteredVoices.map((v) => (
                <option key={v.short_name} value={v.short_name}>
                  {v.friendly_name}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={handlePreviewVoice}
              disabled={previewing || loading}
              className="flex items-center gap-1 px-2.5 py-2 text-xs font-semibold rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 disabled:opacity-50 transition shrink-0"
              title="Escuchar voz de esta persona"
            >
              {previewing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Volume2 className="w-3.5 h-3.5" />
              )}
              <span>Probar</span>
            </button>
          </div>
        </div>

        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !loading && inputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition ${
            isDragging
              ? "border-amber-500 bg-amber-50/50 dark:bg-amber-950/20"
              : "border-zinc-300 dark:border-zinc-700 hover:border-amber-400"
          } ${loading ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,application/pdf"
            onChange={handleFileChange}
            className="hidden"
          />

          {file ? (
            <div className="flex flex-col items-center gap-2 text-center">
              <FileText className="w-10 h-10 text-amber-500" />
              <span className="font-medium text-sm truncate max-w-xs">{file.name}</span>
              <span className="text-xs text-zinc-400">
                {(file.size / (1024 * 1024)).toFixed(2)} MB
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-center">
              <UploadCloud className="w-10 h-10 text-zinc-400" />
              <span className="text-sm font-medium">
                Arrastra tu PDF aquí o haz clic para explorar
              </span>
              <span className="text-xs text-zinc-400">Archivos .pdf</span>
            </div>
          )}
        </div>

        {error && (
          <p className="text-sm text-red-500 mt-3 font-medium">{error}</p>
        )}

        <div className="mt-6 flex gap-3 justify-end">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleUpload}
            disabled={!file || loading}
            className="flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white transition shadow-sm"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>{loading ? "Analizando PDF..." : "Importar"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
