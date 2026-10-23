"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { api, UpdateInfo } from "@/lib/api";

interface UpdateDialogProps {
  info: UpdateInfo;
  mode: "available" | "updated";
  onClose: () => void;
  onSkip?: () => void;
}

type Phase = "idle" | "installing" | "started" | "error";

export function UpdateDialog({ info, mode, onClose, onSkip }: UpdateDialogProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const busy = phase === "installing" || phase === "started";

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  const handleInstall = async () => {
    setPhase("installing");
    setError(null);
    try {
      await api.installUpdate();
      setPhase("started");
      // En Windows la versión nueva abre otra ventana de Edge; esta intenta cerrarse sola
      if (info.platform === "win32") setTimeout(() => window.close(), 4000);
    } catch (err: any) {
      setError(err.message || "No se pudo actualizar Letha.");
      setPhase("error");
    }
  };

  const showNotes =
    info.notes.length > 0 && (mode === "available" || info.latest_version === info.current_version);
  const title =
    mode === "updated"
      ? `Letha se actualizó a la versión ${info.current_version}`
      : `Letha ${info.latest_version} está disponible`;
  const subtitle =
    mode === "updated"
      ? `Antes tenías la versión ${info.updated_from}. Tu biblioteca y tu progreso siguen igual.`
      : `Tienes la versión ${info.current_version}. Tu biblioteca y tu progreso se conservan al actualizar.`;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        background: "var(--scrim)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (!busy) onClose();
      }}
    >
      <div
        className="glass-strong w-full max-w-[520px] p-7 rounded-[30px] flex flex-col gap-5 box-border"
        style={{ background: "var(--dialog)", boxShadow: "var(--ring-dialog)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2
            id="update-dialog-title"
            className="m-0 font-serif text-[26px] leading-[1.2] font-normal"
            style={{ color: "var(--ink)" }}
          >
            {title}
          </h2>
          <p className="m-0 mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            {subtitle}
          </p>
        </div>

        {showNotes && (
          <div
            className="rounded-[20px] p-4 max-h-[240px] overflow-y-auto"
            style={{ background: "var(--glass-sub)", boxShadow: "var(--ring-sub)" }}
          >
            <p className="m-0 mb-2 text-sm font-medium" style={{ color: "var(--ink)" }}>
              Novedades
            </p>
            <ul className="m-0 pl-5 space-y-1.5 text-sm leading-relaxed" style={{ color: "var(--soft)" }}>
              {info.notes.map((note, idx) => (
                <li key={idx}>{note}</li>
              ))}
            </ul>
          </div>
        )}

        {mode === "available" && !info.can_self_update && (
          <div className="text-sm leading-relaxed" style={{ color: "var(--soft)" }}>
            <p className="m-0">{info.self_update_unavailable_reason}</p>
            {info.install_command && (
              <>
                <p className="m-0 mt-2">También puedes actualizar ejecutando en la terminal:</p>
                <code
                  className="mt-2 block font-mono text-xs p-3 rounded-[14px] break-all select-all"
                  style={{ background: "var(--sample)", color: "var(--ink)" }}
                >
                  {info.install_command}
                </code>
              </>
            )}
          </div>
        )}

        {phase === "installing" && (
          <p className="m-0 flex items-center gap-2 text-sm" style={{ color: "var(--soft)" }}>
            <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--accent)" }} />
            Descargando y verificando la versión {info.latest_version}…
          </p>
        )}

        {phase === "started" && (
          <p className="m-0 text-sm leading-relaxed" style={{ color: "var(--soft)" }}>
            {info.platform === "win32"
              ? `Listo. Letha se cerrará y se abrirá en una ventana nueva con la versión ${info.latest_version}. Si esta ventana no se cierra sola, puedes cerrarla.`
              : `Listo. Letha se cerrará y volverá a abrirse con la versión ${info.latest_version} en unos segundos.`}
          </p>
        )}

        {phase === "error" && (
          <p role="alert" className="m-0 text-sm leading-relaxed" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}

        {phase !== "installing" && phase !== "started" && (
          <div className="flex flex-wrap justify-end gap-3">
            {mode === "available" && onSkip && (
              <button
                type="button"
                onClick={onSkip}
                className="quiet inline-flex items-center h-11 px-4 rounded-full border-0 text-[15px] font-medium cursor-pointer"
                style={{ color: "var(--muted)" }}
              >
                Omitir esta versión
              </button>
            )}
            <button
              type="button"
              autoFocus={mode === "updated" || !info.can_self_update}
              onClick={onClose}
              className={`${mode === "updated" ? "glbtn" : "quiet"} inline-flex items-center h-11 px-5 rounded-full border-0 text-[15px] font-medium cursor-pointer`}
              style={
                mode === "updated"
                  ? { background: "var(--btn-primary)", boxShadow: "var(--ring-primary)", color: "var(--btn-primary-ink)" }
                  : { color: "var(--soft)" }
              }
            >
              {mode === "updated" ? "Entendido" : info.can_self_update ? "Más tarde" : "Cerrar"}
            </button>
            {mode === "available" && info.can_self_update && (
              <button
                type="button"
                autoFocus
                onClick={handleInstall}
                className="glbtn inline-flex items-center h-11 px-5 rounded-full border-0 text-[15px] font-medium cursor-pointer"
                style={{
                  background: "var(--btn-primary)",
                  boxShadow: "var(--ring-primary)",
                  color: "var(--btn-primary-ink)",
                }}
              >
                {phase === "error" ? "Reintentar" : "Actualizar ahora"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
