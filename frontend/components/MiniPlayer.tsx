"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Headphones, Loader2, Pause, Play, RotateCcw, RotateCw, X } from "lucide-react";
import { getBaseUrl } from "@/lib/api";
import { TOTAL_PARTS, usePlayer, usePlayerTime } from "@/components/Player";
import { useI18n } from "@/lib/i18n";
import { personaName } from "@/lib/voices";

export function MiniPlayer() {
  const pathname = usePathname();
  const player = usePlayer();
  const currentTime = usePlayerTime();
  const { t } = useI18n();
  const { book } = player;

  if (!player.bookId || !book || pathname?.startsWith("/reader")) return null;

  const readerHref = `/reader?id=${book.id}`;
  const narrator = personaName(player.voice, player.voices, t);
  const pageProgress = player.duration > 0 ? Math.min(100, (currentTime / player.duration) * 100) : 0;

  let status: string;
  if (player.loadError) status = player.loadError;
  else if (player.voiceUnavailable) status = t.reader.offlineVoicesMissing;
  else if (!player.audioReady && player.isSynthesizing)
    status = t.reader.loadingVoicePart(Math.max(1, player.loadedParts), TOTAL_PARTS);
  else status = `${t.common.pageOf((player.chapterIdx ?? 0) + 1, book.total_chapters)} · ${narrator}`;

  return (
    <div className="fixed bottom-5 left-0 right-0 z-30 px-4 pointer-events-none flex justify-center">
      <section
        aria-label={t.player.label}
        className="glass-strong pointer-events-auto relative w-full max-w-[600px] rounded-[26px] p-2 pr-3 flex items-center gap-3 overflow-hidden box-border"
        style={{ background: "var(--glass-dock)", boxShadow: "var(--shadow-dock)", color: "var(--ink)" }}
      >
        <Link
          href={readerHref}
          title={t.player.openReader}
          className="shrink-0 w-10 h-[60px] rounded-[6px] overflow-hidden flex items-center justify-center no-underline"
          style={{ background: "var(--hl)", boxShadow: "var(--shadow-cover)" }}
        >
          {book.cover_url ? (
            <img src={`${getBaseUrl()}${book.cover_url}`} alt="" className="w-full h-full object-cover" />
          ) : (
            <Headphones className="w-4 h-4" style={{ color: "var(--accent)" }} />
          )}
        </Link>

        <Link href={readerHref} title={t.player.openReader} className="flex-1 min-w-0 no-underline">
          <p className="m-0 text-sm font-medium truncate" style={{ color: "var(--ink)" }}>
            {book.title}
          </p>
          <p className="m-0 mt-0.5 text-xs truncate tabular-nums" style={{ color: "var(--muted)" }}>
            {status}
          </p>
        </Link>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            disabled={!player.audioReady}
            onClick={() => player.seekRelative(-10)}
            aria-label={t.reader.back10}
            className="quiet w-10 h-10 rounded-full flex items-center justify-center border-0 disabled:opacity-30 cursor-pointer relative"
            style={{ color: "var(--ink)" }}
          >
            <RotateCcw className="w-5 h-5" strokeWidth={1.5} />
            <span className="absolute inset-0 flex items-center justify-center text-[7px] font-semibold pt-0.5 pointer-events-none tabular-nums">
              10
            </span>
          </button>
          <button
            type="button"
            disabled={!player.audioReady}
            onClick={player.togglePlay}
            aria-label={player.isPlaying ? t.reader.pause : t.reader.play}
            className="glbtn glbtn-primary w-11 h-11 rounded-full border-0 flex items-center justify-center cursor-pointer disabled:opacity-40"
            style={{ background: "var(--btn-primary)", boxShadow: "var(--ring-primary)", color: "var(--btn-primary-ink)" }}
          >
            {!player.audioReady && player.isSynthesizing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : player.isPlaying ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current ml-0.5" />
            )}
          </button>
          <button
            type="button"
            disabled={!player.audioReady}
            onClick={() => player.seekRelative(10)}
            aria-label={t.reader.forward10}
            className="quiet w-10 h-10 rounded-full flex items-center justify-center border-0 disabled:opacity-30 cursor-pointer relative"
            style={{ color: "var(--ink)" }}
          >
            <RotateCw className="w-5 h-5" strokeWidth={1.5} />
            <span className="absolute inset-0 flex items-center justify-center text-[7px] font-semibold pt-0.5 pointer-events-none tabular-nums">
              10
            </span>
          </button>
          <button
            type="button"
            onClick={player.close}
            aria-label={t.player.close}
            title={t.player.close}
            className="quiet w-9 h-9 ml-1 rounded-full flex items-center justify-center border-0 cursor-pointer"
            style={{ color: "var(--muted)" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div aria-hidden="true" className="absolute left-0 right-0 bottom-0 h-[3px]" style={{ background: "var(--track)" }}>
          <div className="h-full transition-[width] duration-300" style={{ width: `${pageProgress}%`, background: "var(--fill)" }} />
        </div>
      </section>
    </div>
  );
}
