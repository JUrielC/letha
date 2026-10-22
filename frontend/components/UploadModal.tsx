"use client";

import React, { useState, useRef, useEffect } from "react";
import { UploadCloud, X, Loader2, FileText, Volume2, User, Languages } from "lucide-react";
import { api, VoiceItem } from "@/lib/api";

const LANGUAGES = [
  { code: "es", label: "Español", defaultVoice: "es-MX-DaliaNeural" },
  { code: "en", label: "Inglés", defaultVoice: "en-US-AvaNeural" },
  { code: "fr", label: "Francés", defaultVoice: "fr-FR-DeniseNeural" },
  { code: "it", label: "Italiano", defaultVoice: "it-IT-ElsaNeural" },
  { code: "pt", label: "Portugués", defaultVoice: "pt-BR-FranciscaNeural" },
] as const;

type LanguageCode = (typeof LANGUAGES)[number]["code"];

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialFile?: File | null;
}

export function UploadModal({ isOpen, onClose, onSuccess, initialFile }: UploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [voices, setVoices] = useState<VoiceItem[]>([]);
  const [langFilter, setLangFilter] = useState<LanguageCode>("es");
  const [selectedVoice, setSelectedVoice] = useState("es-MX-DaliaNeural");
  const [previewing, setPreviewing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (isOpen && initialFile) {
      setFile(initialFile);
      setError(null);
    }
  }, [isOpen, initialFile]);

  useEffect(() => {
    if (isOpen && voices.length === 0) {
      api.getVoices().then(setVoices).catch(console.error);
    }
  }, [isOpen, voices.length]);

  const filteredVoices = voices.filter((v) =>
    v.locale.toLowerCase().startsWith(`${langFilter}-`)
  );

  useEffect(() => {
    if (filteredVoices.length > 0 && !filteredVoices.some((v) => v.short_name === selectedVoice)) {
      const preferred = LANGUAGES.find((l) => l.code === langFilter)!.defaultVoice;
      setSelectedVoice(
        filteredVoices.some((v) => v.short_name === preferred) ? preferred : filteredVoices[0].short_name
      );
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in">
      <div
        className="w-full max-w-md p-6 rounded-2xl border relative animate-in fade-in zoom-in-95"
        style={{
          backgroundColor: "var(--panel)",
          borderColor: "var(--line-strong)",
        }}
      >
        <button
          onClick={onClose}
          disabled={loading}
          aria-label="Cerrar modal"
          className="absolute top-4 right-4 min-w-[44px] min-h-[44px] p-2 rounded-xl flex items-center justify-center text-[#93a3b8] hover:text-[#eaf1fa] hover:bg-[#0a1729] transition"
        >
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-lg font-bold text-[#eaf1fa] mb-1">Importar libro en PDF</h3>
        <p className="text-sm text-[#93a3b8] mb-4">
          Selecciona tu PDF, el idioma del libro y la persona que lo narrará.
        </p>

        {/* Selector de idioma y narrador antes de cargar el libro */}
        <div
          className="mb-4 p-4 rounded-xl border"
          style={{
            backgroundColor: "var(--bg)",
            borderColor: "var(--line)",
          }}
        >
          <p className="text-xs font-semibold flex items-center gap-1.5 text-[#eaf1fa] mb-2">
            <Languages className="w-3.5 h-3.5 text-[#1ea7e8]" />
            <span>Idioma del libro</span>
          </p>

          <div className="flex flex-wrap gap-1.5 mb-4" role="group" aria-label="Idioma del libro">
            {LANGUAGES.map(({ code, label }) => {
              const active = langFilter === code;
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => setLangFilter(code)}
                  aria-pressed={active}
                  className={`px-2.5 py-1 rounded-lg font-semibold text-xs transition ${
                    active
                      ? "text-[#0a1729]"
                      : "text-[#93a3b8] hover:text-[#64c7f5]"
                  }`}
                  style={
                    active
                      ? {
                          background: "var(--primary-btn-bg)",
                          color: "var(--primary-btn-text)",
                        }
                      : undefined
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>

          <label className="text-xs font-semibold flex items-center gap-1.5 text-[#eaf1fa] mb-2.5">
            <User className="w-3.5 h-3.5 text-[#1ea7e8]" />
            <span>Persona que habla (Narrador)</span>
          </label>

          <div className="flex items-center gap-2">
            <select
              value={selectedVoice}
              onChange={(e) => setSelectedVoice(e.target.value)}
              disabled={loading}
              className="flex-1 min-h-[44px] text-xs font-medium rounded-xl px-3 py-2 border bg-[#0e1d33] text-[#eaf1fa] focus:outline-none focus:border-[#1ea7e8] cursor-pointer truncate"
              style={{ borderColor: "var(--line-strong)" }}
            >
              {filteredVoices.map((v) => (
                <option
                  key={v.short_name}
                  value={v.short_name}
                  className="bg-[#0e1d33] text-[#eaf1fa]"
                >
                  {v.friendly_name}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={handlePreviewVoice}
              disabled={previewing || loading}
              className="min-h-[44px] flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border text-[#64c7f5] hover:bg-[#0a1729] disabled:opacity-50 transition shrink-0"
              style={{ borderColor: "var(--line-strong)" }}
              title="Escuchar voz de esta persona"
            >
              {previewing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#1ea7e8]" />
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
            loading ? "opacity-50 cursor-not-allowed" : ""
          }`}
          style={{
            backgroundColor: "var(--bg)",
            borderColor: isDragging ? "var(--accent)" : "var(--line-strong)",
          }}
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
              <FileText className="w-10 h-10 text-[#64c7f5]" />
              <span className="font-semibold text-sm text-[#eaf1fa] truncate max-w-xs">
                {file.name}
              </span>
              <span className="text-xs text-[#93a3b8]">
                {(file.size / (1024 * 1024)).toFixed(2)} MB
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-center">
              <UploadCloud className="w-10 h-10 text-[#64c7f5]" />
              <span className="text-sm font-semibold text-[#eaf1fa]">
                Arrastra tu PDF aquí o haz clic para explorar
              </span>
              <span className="text-xs text-[#93a3b8]">Archivos .pdf</span>
            </div>
          )}
        </div>

        {error && (
          <p
            role="alert"
            className="text-xs font-medium text-red-300 border border-red-400/30 rounded-xl px-3 py-2 mt-3"
          >
            {error}
          </p>
        )}

        <div className="mt-6 flex gap-3 justify-end">
          <button
            onClick={onClose}
            disabled={loading}
            className="min-h-[44px] px-4 py-2 text-sm font-semibold rounded-xl border text-[#c3cfdd] hover:bg-[#0a1729] transition"
            style={{ borderColor: "var(--line-strong)" }}
          >
            Cancelar
          </button>
          <button
            onClick={handleUpload}
            disabled={!file || loading}
            className="min-h-[44px] flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-xl disabled:opacity-50 transition hover:opacity-95"
            style={{
              background: "var(--primary-btn-bg)",
              color: "var(--primary-btn-text)",
            }}
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>{loading ? "Analizando PDF..." : "Importar"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
