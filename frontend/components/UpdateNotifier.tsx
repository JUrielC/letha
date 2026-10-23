"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sparkles, X } from "lucide-react";
import { api, UpdateInfo } from "@/lib/api";
import { UpdateDialog } from "@/components/UpdateDialog";
import { useI18n } from "@/lib/i18n";

const DISMISSED_KEY = "letha_update_dismissed";

export function UpdateNotifier() {
  const pathname = usePathname();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [hidden, setHidden] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    api
      .getUpdates()
      .then((data) => {
        setInfo(data);
        try {
          if (data.latest_version && sessionStorage.getItem(DISMISSED_KEY) === data.latest_version) {
            setHidden(true);
          }
        } catch {}
      })
      .catch(() => {});
  }, []);

  if (!info || hidden || pathname?.startsWith("/reader")) return null;

  const mode = info.updated_from ? "updated" : info.update_available && !info.skipped ? "available" : null;
  if (!mode) return null;

  const dismiss = () => {
    setHidden(true);
    setDialogOpen(false);
    if (mode === "updated") {
      api.acknowledgeUpdate().catch(() => {});
      return;
    }
    try {
      sessionStorage.setItem(DISMISSED_KEY, info.latest_version || "");
    } catch {}
  };

  const skip = () => {
    setHidden(true);
    setDialogOpen(false);
    if (info.latest_version) api.skipUpdate(info.latest_version).catch(() => {});
  };

  return (
    <>
      <div
        role="status"
        className="glass-strong fixed bottom-5 right-5 z-40 flex items-center gap-2 pl-4 pr-1.5 py-1.5 rounded-full max-w-[calc(100vw-40px)]"
        style={{ background: "var(--dialog)", boxShadow: "var(--ring-dialog)", color: "var(--ink)" }}
      >
        <Sparkles className="w-4 h-4 shrink-0" style={{ color: "var(--accent)" }} />
        <span className="text-sm truncate">
          {mode === "updated"
            ? t.updates.updatedTo(info.current_version)
            : t.updates.newVersion(info.latest_version ?? "")}
        </span>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="glbtn shrink-0 inline-flex items-center h-9 px-3.5 rounded-full border-0 text-sm font-medium cursor-pointer"
          style={{ background: "var(--btn-primary)", color: "var(--btn-primary-ink)" }}
        >
          {t.updates.seeWhatsNew}
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t.updates.dismiss}
          className="quiet shrink-0 w-9 h-9 rounded-full flex items-center justify-center border-0 cursor-pointer"
          style={{ background: "transparent", color: "var(--muted)" }}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {dialogOpen && (
        <UpdateDialog info={info} mode={mode} onClose={dismiss} onSkip={skip} />
      )}
    </>
  );
}
