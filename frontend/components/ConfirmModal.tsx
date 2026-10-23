"use client";

import React, { useEffect } from "react";
import { createPortal } from "react-dom";

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  isOpen,
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancelar",
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  // Portal al body: dentro de un elemento con backdrop-filter, `fixed` quedaría atrapado en él
  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      aria-describedby="confirm-modal-message"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        background: "var(--scrim)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
      }}
      onClick={(e) => {
        e.stopPropagation();
        onCancel();
      }}
    >
      <div
        className="glass-strong w-full max-w-[420px] p-7 rounded-[30px] flex flex-col gap-6 box-border"
        style={{
          background: "var(--dialog)",
          boxShadow: "var(--ring-dialog)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2
            id="confirm-modal-title"
            className="m-0 font-serif text-[24px] leading-[1.2] font-normal"
            style={{ color: "var(--ink)" }}
          >
            {title}
          </h2>
          <p
            id="confirm-modal-message"
            className="m-0 mt-2 text-sm leading-relaxed"
            style={{ color: "var(--muted)" }}
          >
            {message}
          </p>
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="quiet inline-flex items-center h-11 px-4 rounded-full border-0 text-[15px] font-medium cursor-pointer"
            style={{ color: "var(--soft)" }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`${destructive ? "quiet hover:opacity-90" : "glbtn"} inline-flex items-center h-11 px-5 rounded-full border-0 text-[15px] font-medium cursor-pointer`}
            style={
              destructive
                ? { background: "var(--danger)", color: "var(--btn-primary-ink)" }
                : {
                    background: "var(--btn-primary)",
                    boxShadow: "var(--ring-primary)",
                    color: "var(--btn-primary-ink)",
                  }
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
