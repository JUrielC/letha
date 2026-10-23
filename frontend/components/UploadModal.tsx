"use client";

import React, { useState, useRef, useEffect } from "react";
import { UploadCloud, X, Loader2, FileText, Check, Play, Pause } from "lucide-react";
import { api, VoiceItem } from "@/lib/api";
import { errorMessage, languageName, useI18n } from "@/lib/i18n";
import { voiceDetails } from "@/lib/voices";

const LANGUAGES = [
  { code: "es", defaultVoice: "es-MX-DaliaNeural" },
  { code: "en", defaultVoice: "en-US-AvaNeural" },
  { code: "fr", defaultVoice: "fr-FR-DeniseNeural" },
  { code: "it", defaultVoice: "it-IT-ElsaNeural" },
  { code: "pt", defaultVoice: "pt-BR-FranciscaNeural" },
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
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const { t, locale } = useI18n();

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

  useEffect(() => {
    if (!isOpen && previewAudioRef.current) {
      previewAudioRef.current.pause();
      setPreviewingVoice(null);
    }
  }, [isOpen]);

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
        setError(t.upload.pdfOnly);
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
        setError(t.upload.pdfOnly);
      }
    }
  };

  const handlePreviewVoice = async (voiceTarget?: string) => {
    const v = voiceTarget || selectedVoice;
    if (!v) return;
    if (previewingVoice === v) {
      if (previewAudioRef.current) previewAudioRef.current.pause();
      setPreviewingVoice(null);
      return;
    }
    setSelectedVoice(v);
    setPreviewingVoice(v);
    try {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
      }
      const audio = new Audio(api.getVoicePreviewUrl(v));
      previewAudioRef.current = audio;
      audio.onended = () => setPreviewingVoice(null);
      audio.onerror = () => setPreviewingVoice(null);
      await audio.play();
    } catch {
      setPreviewingVoice(null);
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
      await api.uploadBook(file, selectedVoice, langFilter);
      setFile(null);
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(errorMessage(err, t, t.upload.failed));
    } finally {
      setLoading(false);
    }
  };
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto"
      style={{
        background: "var(--scrim)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
      }}
    >
      <div
        className="glass-strong relative w-full max-w-[600px] p-7 rounded-[30px] flex flex-col gap-[26px] my-auto box-border"
        style={{
          background: "var(--dialog)",
          boxShadow: "var(--ring-dialog)",
        }}
      >
        {/* 1. Título y cerrar */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h2
              id="upload-modal-title"
              className="m-0 font-serif text-[28px] leading-[1.2] font-normal"
              style={{ color: "var(--ink)" }}
            >
              {t.upload.title}
            </h2>
            <p className="m-0 mt-1.5 text-sm" style={{ color: "var(--muted)" }}>
              {t.upload.subtitle}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            aria-label={t.common.close}
            className="quiet shrink-0 w-10 h-10 -mr-1.5 -mt-1 rounded-full flex items-center justify-center border-0 cursor-pointer"
            style={{
              background: "var(--btn-ghost)",
              color: "var(--muted)",
            }}
          >
            <X className="w-[18px] h-[18px]" strokeWidth={1.6} />
          </button>
        </div>

        {/* 2. Zona de Archivo */}
        {file ? (
          <div
            className="flex items-center gap-3.5 p-3 pl-3 rounded-[22px]"
            style={{
              background: "var(--glass-sub)",
              boxShadow: "var(--ring-sub)",
            }}
          >
            <span
              aria-hidden="true"
              className="w-[34px] h-[46px] rounded-[4px] flex items-center justify-center shrink-0"
              style={{
                background:
                  "linear-gradient(155deg, rgba(255, 255, 255, 0.34) 0%, rgba(255, 255, 255, 0) 40%), #7a959f",
                boxShadow: "0 6px 14px rgba(20, 18, 24, 0.2)",
                color: "#ffffff",
              }}
            >
              <FileText className="w-4 h-4 opacity-80" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="m-0 text-sm font-medium truncate" style={{ color: "var(--ink)" }}>
                {file.name}
              </p>
              <p className="m-0 text-xs tabular-nums" style={{ color: "var(--muted)" }}>
                {(file.size / (1024 * 1024)).toFixed(2)} MB
              </p>
            </div>
            <button
              type="button"
              onClick={() => !loading && inputRef.current?.click()}
              className="quiet h-9 px-3 rounded-full border-0 text-[13px] font-medium cursor-pointer"
              style={{ color: "var(--ink)" }}
            >
              {t.upload.changeFile}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,application/pdf"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
        ) : (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => !loading && inputRef.current?.click()}
            className="glbtn rounded-[22px] p-7 flex flex-col items-center justify-center cursor-pointer transition select-none text-center"
            style={{
              border: isDragging ? "1.5px dashed var(--accent)" : "1.5px dashed var(--add-border)",
              background: isDragging ? "var(--hover)" : "var(--add)",
              color: isDragging ? "var(--accent)" : "var(--soft)",
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,application/pdf"
              onChange={handleFileChange}
              className="hidden"
            />
            <UploadCloud className="w-9 h-9 mb-2" strokeWidth={1.5} style={{ color: "var(--soft)" }} />
            <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
              {t.upload.dropzone}
            </span>
            <span className="text-xs mt-1" style={{ color: "var(--muted)" }}>
              {t.upload.pdfFiles}
            </span>
          </div>
        )}

        {/* 3. Idioma del libro */}
        <fieldset className="m-0 p-0 border-0 min-w-0">
          <legend className="p-0 text-sm font-medium mb-0.5" style={{ color: "var(--ink)" }}>
            {t.upload.bookLanguage}
          </legend>
          <p className="m-0 mb-3 text-[13px]" style={{ color: "var(--muted)" }}>
            {t.upload.bookLanguageHint}
          </p>
          <div
            role="radiogroup"
            aria-label={t.upload.bookLanguage}
            className="flex flex-wrap gap-0.5 p-1 rounded-full w-fit max-w-full"
            style={{
              background: "var(--glass-seg)",
              boxShadow: "var(--ring-seg)",
            }}
          >
            {LANGUAGES.map(({ code }) => {
              const active = langFilter === code;
              return (
                <button
                  key={code}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setLangFilter(code)}
                  className="quiet h-9 px-3.5 rounded-full border-0 text-sm cursor-pointer transition"
                  style={{
                    background: active ? "var(--glass-seg-on)" : "transparent",
                    boxShadow: active ? "var(--shadow-seg-on)" : "none",
                    color: active ? "var(--ink)" : "var(--soft)",
                    fontWeight: active ? 500 : 400,
                  }}
                >
                  {languageName(code, locale)}
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* 4. Narrador */}
        <fieldset className="m-0 p-0 border-0 min-w-0">
          <legend className="p-0 text-sm font-medium mb-0.5" style={{ color: "var(--ink)" }}>
            {t.upload.narrator}
          </legend>
          <p className="m-0 mb-3 text-[13px]" style={{ color: "var(--muted)" }}>
            {t.upload.narratorHint}
          </p>

          <div
            className="rounded-[22px] p-1 max-h-[220px] overflow-y-auto space-y-1"
            style={{
              background: "var(--glass-sub)",
              boxShadow: "var(--ring-sub)",
            }}
          >
            {filteredVoices.map((v) => {
              const isSelected = selectedVoice === v.short_name;
              const isPlayingNow = previewingVoice === v.short_name;
              const persona = v.name;
              const meta = voiceDetails(v, locale, t);

              return (
                <div
                  key={v.short_name}
                  onClick={() => setSelectedVoice(v.short_name)}
                  className="vrow flex items-center gap-3.5 min-h-[58px] p-2 pl-3.5 rounded-[18px] cursor-pointer transition"
                  style={{
                    background: isSelected ? "var(--glass-seg-on)" : "transparent",
                    boxShadow: isSelected ? "var(--shadow-seg-on)" : "none",
                  }}
                >
                  <input
                    type="radio"
                    name="narrador"
                    id={`cv-${v.short_name}`}
                    checked={isSelected}
                    onChange={() => setSelectedVoice(v.short_name)}
                    className="w-[18px] h-[18px] m-0 cursor-pointer"
                    style={{ accentColor: "var(--accent)" }}
                  />
                  <label
                    htmlFor={`cv-${v.short_name}`}
                    className="flex-1 min-w-0 cursor-pointer flex flex-col"
                  >
                    <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                      {persona}
                    </span>
                    <span className="text-[13px] truncate" style={{ color: "var(--muted)" }}>
                      {meta}
                    </span>
                  </label>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePreviewVoice(v.short_name);
                    }}
                    disabled={loading}
                    aria-label={isPlayingNow ? t.upload.stopSample(persona) : t.upload.playSample(persona)}
                    className="quiet inline-flex items-center gap-2 h-9 px-3.5 pl-1.5 rounded-full border-0 text-[13px] font-medium cursor-pointer"
                    style={{
                      background: "transparent",
                      color: isSelected ? "var(--ink)" : "var(--soft)",
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="w-[26px] h-[26px] rounded-full inline-flex items-center justify-center"
                      style={{
                        background: isSelected ? "var(--icon-chip)" : "var(--btn-ghost)",
                      }}
                    >
                      {isPlayingNow ? (
                        <Pause className="w-3 h-3 fill-current" />
                      ) : (
                        <Play className="w-3 h-3 fill-current ml-0.5" />
                      )}
                    </span>
                    <span>{isPlayingNow ? t.common.stop : t.common.listen}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </fieldset>

        {/* 5. Error */}
        {error && (
          <p
            role="alert"
            className="text-xs font-medium rounded-xl px-4 py-3 m-0"
            style={{
              background: "rgba(143,58,51,0.1)",
              color: "var(--danger)",
              border: "1px solid var(--danger)",
            }}
          >
            {error}
          </p>
        )}

        {/* 6. Pie */}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <p className="flex-1 min-w-[200px] m-0 text-[13px]" style={{ color: "var(--muted)" }}>
            {t.upload.connectionNote}
          </p>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="quiet inline-flex items-center h-11 px-4 rounded-full border-0 text-[15px] font-medium cursor-pointer"
            style={{ color: "var(--soft)" }}
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={!file || loading}
            className="glbtn glbtn-primary inline-flex items-center gap-2 h-11 px-5 pl-4 rounded-full border-0 text-[15px] font-medium cursor-pointer disabled:opacity-40"
            style={{
              background: "var(--btn-primary)",
              boxShadow: "var(--ring-primary)",
              color: "var(--btn-primary-ink)",
            }}
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" strokeWidth={2} />
            )}
            <span>{loading ? t.upload.analyzing : t.upload.import}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
