"use client";

import React, { useState, useRef } from "react";
import { UploadCloud, X, Loader2, FileText } from "lucide-react";
import { api } from "@/lib/api";

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function UploadModal({ isOpen, onClose, onSuccess }: UploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);

    try {
      await api.uploadBook(file);
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
          Letha analizará la portada, capítulos y preparará el texto para lectura con voz neural.
        </p>

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
