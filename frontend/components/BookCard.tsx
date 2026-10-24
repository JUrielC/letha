"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { api, BookSummary, VoiceItem, getBaseUrl } from "@/lib/api";
import { Check, Headphones, Pause, Trash2 } from "lucide-react";
import { ConfirmModal } from "@/components/ConfirmModal";
import { usePlayer } from "@/components/Player";
import { useI18n } from "@/lib/i18n";
import { voiceLabel } from "@/lib/voices";

const COVER_PALETTES = [
  { bg: "#2f4a3a", ink: "#efe9dc" },
  { bg: "#1f2326", ink: "#e9e6df" },
  { bg: "#6b2430", ink: "#f1e6e0" },
  { bg: "#c9b98f", ink: "#2a241a" },
  { bg: "#8f9aa0", ink: "#1d2124" },
  { bg: "#3b5568", ink: "#eef0ee" },
  { bg: "#d9d3c4", ink: "#2b2a26" },
  { bg: "#b8a24f", ink: "#231f12" },
  { bg: "#5b4a3f", ink: "#efe6da" },
];

function pickCoverPalette(id: string) {
  let sum = 0;
  for (let i = 0; i < id.length; i++) {
    sum += id.charCodeAt(i);
  }
  return COVER_PALETTES[sum % COVER_PALETTES.length];
}

interface BookCardProps {
  book: BookSummary;
  voices: VoiceItem[];
  onDelete: (id: string) => void;
  onVoiceChange?: (bookId: string, newVoice: string) => void;
}

export function BookCard({
  book,
  voices,
  onDelete,
  onVoiceChange,
}: BookCardProps) {
  const [selectedVoice, setSelectedVoice] = useState(
    book.voice || "es-MX-DaliaNeural"
  );
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setSelectedVoice(book.voice || "es-MX-DaliaNeural");
  }, [book.voice]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { t, locale } = useI18n();
  const player = usePlayer();
  const playingThis = player.bookId === book.id && player.isPlaying;

  const bookVoices = voices.filter(
    (v) =>
      v.locale.toLowerCase().startsWith(`${book.language}-`) ||
      v.short_name === selectedVoice
  );
  const voiceOptions = bookVoices.length > 0 ? bookVoices : voices;

  const totalPages = Math.max(1, book.total_chapters || book.total_pages);
  const currentPage = Math.min(
    Math.max(1, book.current_chapter_idx + 1),
    totalPages
  );
  const isStarted =
    book.current_chapter_idx > 0 || book.current_sentence_idx > 0;
  const isCompleted = currentPage >= totalPages && isStarted;
  const progressPct = !isStarted
    ? 0
    : isCompleted
    ? 100
    : Math.min(100, Math.round((currentPage / totalPages) * 100));

  const coverSrc =
    book.cover_url && !imgFailed ? `${getBaseUrl()}${book.cover_url}` : null;
  const palette = pickCoverPalette(book.id);

  const handleSelectVoice = async (newVoice: string) => {
    setSelectedVoice(newVoice);
    await api.updateSettings(book.id, newVoice, book.speed).catch(console.error);
    if (onVoiceChange) onVoiceChange(book.id, newVoice);
  };

  return (
    <article className="relative flex flex-col gap-3.5 min-w-0">
      <Link
        href={`/reader?id=${book.id}`}
        aria-label={t.library.open(book.title)}
        className="cover-card group relative block aspect-[2/3] w-full overflow-hidden rounded-[8px] no-underline"
        style={{
          boxShadow: "var(--shadow-cover)",
          backgroundColor: palette.bg,
          color: palette.ink,
        }}
      >
        {coverSrc ? (
          <img
            src={coverSrc}
            alt={book.title}
            onError={() => setImgFailed(true)}
            className="w-full h-full object-cover transition duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="w-full h-full p-4 pl-5 flex flex-col justify-between box-border select-none">
            <span className="text-[11px] font-medium tracking-[0.01em] line-clamp-1">
              {book.author || t.common.unknownAuthor}
            </span>
            <span className="font-serif text-[21px] leading-[1.14] overflow-wrap-anywhere line-clamp-4">
              {book.title}
            </span>
          </div>
        )}

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[8px]"
          style={{
            background:
              "linear-gradient(155deg, rgba(255, 255, 255, 0.34) 0%, rgba(255, 255, 255, 0) 38%), linear-gradient(90deg, rgba(0, 0, 0, 0.14) 0px, rgba(0, 0, 0, 0) 10px)",
          }}
        />
      </Link>

      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3
              className="m-0 text-sm font-medium leading-[1.35] truncate"
              title={book.title}
              style={{ color: "var(--ink)" }}
            >
              {book.title}
            </h3>
            <p className="m-0 mt-0.5 text-[13px] truncate" style={{ color: "var(--muted)" }}>
              {book.author || t.common.unknownAuthor}
            </p>
          </div>

          <button
            type="button"
            aria-label={playingThis ? t.player.pauseBook(book.title) : t.player.listenTo(book.title)}
            title={playingThis ? t.reader.pause : t.common.listen}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (playingThis) player.togglePlay();
              else player.openBook(book.id, { autoplay: true });
            }}
            className="quiet shrink-0 w-8 h-8 -mt-1 rounded-full flex items-center justify-center cursor-pointer border-0 hover:bg-[var(--hover)] transition"
            style={{ color: playingThis ? "var(--accent)" : "var(--soft)" }}
          >
            {playingThis ? <Pause className="w-4 h-4 fill-current" /> : <Headphones className="w-4 h-4" />}
          </button>

          <button
            type="button"
            aria-label={t.book.deleteNamed(book.title)}
            title={t.book.deleteBook}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setConfirmingDelete(true);
            }}
            className="quiet shrink-0 w-8 h-8 -mr-1.5 -mt-1 rounded-full flex items-center justify-center cursor-pointer border-0 text-[var(--soft)] hover:text-[var(--danger)] hover:bg-[var(--hover)] transition"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {progressPct === 100 ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium tabular-nums" style={{ color: "var(--soft)" }}>
            <Check className="w-3.5 h-3.5 text-[var(--accent)]" strokeWidth={2.2} />
            <span>{t.book.finished(totalPages)}</span>
          </span>
        ) : isStarted ? (
          <div className="flex flex-col gap-1 mt-0.5">
            <div
              role="progressbar"
              aria-label={t.library.progressOf(book.title)}
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-[3px] rounded-full overflow-hidden w-full"
              style={{ background: "var(--track)" }}
            >
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${progressPct}%`, background: "var(--fill)" }}
              />
            </div>
            <span className="text-xs tabular-nums" style={{ color: "var(--muted)" }}>
              {t.common.pageOf(currentPage, totalPages)} · {progressPct}%
            </span>
          </div>
        ) : (
          <span className="text-xs tabular-nums" style={{ color: "var(--muted)" }}>
            {t.book.notStarted(totalPages)}
          </span>
        )}

        {voiceOptions.length > 0 && (
          <div className="flex flex-col gap-1 pt-2 border-t mt-1" style={{ borderColor: "var(--track)" }}>
            <label
              htmlFor={`voice-select-${book.id}`}
              className="text-[11px] font-medium"
              style={{ color: "var(--muted)" }}
            >
              {t.book.voice}
            </label>
            <select
              id={`voice-select-${book.id}`}
              value={selectedVoice}
              onChange={(e) => handleSelectVoice(e.target.value)}
              className="glass w-full h-[34px] text-xs font-medium rounded-[10px] px-2.5 border-0 cursor-pointer truncate focus:outline-none"
              style={{
                background: "var(--glass-seg)",
                boxShadow: "var(--ring-seg)",
                color: "var(--ink)",
              }}
              title={t.book.voiceHint}
            >
              {voiceOptions.map((v) => (
                <option
                  key={v.short_name}
                  value={v.short_name}
                  className="bg-white text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  {voiceLabel(v, locale, t)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={confirmingDelete}
        title={t.book.deleteBook}
        message={t.book.deleteMessage(book.title)}
        confirmLabel={t.book.delete}
        destructive
        onConfirm={() => {
          setConfirmingDelete(false);
          onDelete(book.id);
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    </article>
  );
}
