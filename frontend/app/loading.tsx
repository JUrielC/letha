"use client";

import { Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export default function Loading() {
  const { t } = useI18n();
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center gap-3"
      style={{ color: "var(--muted)" }}
    >
      <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--accent)" }} />
      <span className="text-sm" style={{ color: "var(--muted)" }}>{t.common.loading}</span>
    </div>
  );
}
