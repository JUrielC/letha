/**
 * Cliente HTTP para comunicarse con el backend de Letha.
 */

export interface WordTiming {
  text: string;
  start: number;
  end: number;
}

export interface SentenceItem {
  index: number;
  text: string;
  start?: number | null;
  end?: number | null;
  words?: WordTiming[] | null;
  paragraph_start?: boolean;
}

export interface ChapterSummary {
  idx: number;
  title: string;
  start_page: number;
  end_page: number;
  has_audio: boolean;
  duration_seconds?: number;
}

export interface ChapterDetail {
  idx: number;
  book_id: string;
  title: string;
  start_page: number;
  end_page: number;
  text_content: string;
  sentences: SentenceItem[];
  has_audio: boolean;
  loaded_parts: number;
  total_parts: number;
  duration_seconds?: number;
}

export interface BookSummary {
  id: string;
  title: string;
  author: string;
  total_pages: number;
  total_chapters: number;
  cover_url?: string;
  current_chapter_idx: number;
  current_sentence_idx: number;
  voice: string;
  language: string;
  speed: number;
  created_at: number;
  last_read_at: number;
}

export interface BookDetail extends BookSummary {
  chapters: ChapterSummary[];
}

export interface VoiceItem {
  name: string;
  short_name: string;
  gender: string;
  locale: string;
  offline?: boolean;
}

export interface OfflineVoices {
  size: number;
  status: "missing" | "downloading" | "installed" | "error";
  progress: number;
  error?: string | null;
}

export interface AppSettings {
  edge_base_speed: number;
  auto_advance_sentence: boolean;
  auto_advance_page: boolean;
  boundary_type: "SentenceBoundary" | "WordBoundary";
  auto_check_updates: boolean;
  native_language: string | null;
  theme: "light" | "sepia" | "dark";
  font_size: "sm" | "base" | "lg" | "xl";
  show_translation: boolean;
  last_book_id: string | null;
  translation_order: TranslationEngine[];
}

export type TranslationEngine = "microsoft" | "google" | "offline";

export interface OfflineTranslation {
  language: string;
  model: string;
  size: number;
  status: "missing" | "downloading" | "installed" | "error";
  progress: number;
  error?: string | null;
}

export interface TranslationLanguage {
  code: string;
  name: string;
}

export interface ChapterTranslations {
  source: string;
  target: string;
  translations: (string | null)[];
  provider: string | null;
}

export interface UpdateInfo {
  current_version: string;
  platform: string;
  can_self_update: boolean;
  self_update_unavailable_reason?: string | null;
  install_command?: string | null;
  latest_version?: string | null;
  update_available: boolean;
  skipped: boolean;
  notes: string[];
  release_url?: string | null;
  published_at?: string | null;
  checked_at?: number | null;
  updated_from?: string | null;
  error?: string | null;
}

declare global {
  interface Window {
    __LETHA__?: { api: string; token: string; settings?: Partial<AppSettings> };
  }
}

export function getBaseUrl(): string {
  if (typeof window !== "undefined") {
    if (window.__LETHA__?.api !== undefined) {
      return window.__LETHA__.api;
    }
    // En desarrollo (next dev en puerto 3000), llamar directo al backend en 47830
    // para evitar el timeout del proxy de rewrites de Next.js (ECONNRESET).
    if (window.location.port === "3000") {
      return "http://127.0.0.1:47830";
    }
  }
  return "";
}

export function getToken(): string {
  if (typeof window !== "undefined" && window.__LETHA__?.token) {
    return window.__LETHA__.token;
  }
  return "";
}

export class ApiError extends Error {
  constructor(public code: string | null, message: string) {
    super(message);
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  const data = await res.json().catch(() => null);
  const detail = data?.detail;
  if (detail && typeof detail.code === "string") return new ApiError(detail.code, detail.message);
  return new ApiError(null, typeof detail === "string" ? detail : `Error ${res.status}`);
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const base = getBaseUrl();
  const url = `${base}${path}`;
  const token = getToken();
  const headers = new Headers(options?.headers || {});
  if (token) {
    headers.set("X-Letha-Token", token);
  }
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) throw await toApiError(res);
  return res.json() as Promise<T>;
}

export const api = {
  getBooks: () => request<BookSummary[]>("/api/books"),

  getBook: (id: string) => request<BookDetail>(`/api/books/${id}`),

  getChapter: (bookId: string, chapterIdx: number, voice?: string) => {
    const query = voice ? `?voice=${encodeURIComponent(voice)}` : "";
    return request<ChapterDetail>(`/api/books/${bookId}/chapters/${chapterIdx}${query}`);
  },

  getVoices: () => request<VoiceItem[]>("/api/voices"),

  getOfflineVoices: () => request<OfflineVoices>("/api/voices/offline"),

  downloadOfflineVoices: () => request<OfflineVoices>("/api/voices/offline", { method: "POST" }),

  deleteOfflineVoices: () => request<OfflineVoices>("/api/voices/offline", { method: "DELETE" }),

  getAppSettings: () => request<AppSettings>("/api/settings"),

  updateAppSettings: (payload: {
    edge_base_speed?: number;
    auto_advance_sentence?: boolean;
    auto_advance_page?: boolean;
    boundary_type?: "SentenceBoundary" | "WordBoundary";
    auto_check_updates?: boolean;
    native_language?: string;
    theme?: AppSettings["theme"];
    font_size?: AppSettings["font_size"];
    show_translation?: boolean;
    last_book_id?: string;
    translation_order?: TranslationEngine[];
  }) =>
    request<AppSettings>("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),

  getTranslationLanguages: () => request<TranslationLanguage[]>("/api/translation/languages"),

  getOfflineTranslation: () => request<OfflineTranslation[]>("/api/translation/offline"),

  downloadOfflineTranslation: (language: string) =>
    request<OfflineTranslation>(`/api/translation/offline/${language}`, { method: "POST" }),

  deleteOfflineTranslation: (language: string) =>
    request<OfflineTranslation>(`/api/translation/offline/${language}`, { method: "DELETE" }),

  getChapterTranslations: (bookId: string, chapterIdx: number) =>
    request<ChapterTranslations>(`/api/books/${bookId}/chapters/${chapterIdx}/translations`),

  getUpdates: (force = false) =>
    request<UpdateInfo>(`/api/updates${force ? "?force=true" : ""}`),

  skipUpdate: (version: string) =>
    request<{ status: string }>("/api/updates/skip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version }),
    }),

  acknowledgeUpdate: () =>
    request<{ status: string }>("/api/updates/acknowledge", { method: "POST" }),

  installUpdate: () =>
    request<{ version: string }>("/api/updates/install", { method: "POST" }),

  uninstall: (deleteLibrary: boolean) =>
    request<{ status: string }>("/api/uninstall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delete_library: deleteLibrary }),
    }),

  getVoicePreviewUrl: (voice: string) =>
    `${getBaseUrl()}/api/voices/preview?voice=${encodeURIComponent(voice)}`,

  uploadBook: async (file: File, voice?: string, language?: string): Promise<BookDetail> => {
    const base = getBaseUrl();
    const token = getToken();
    const formData = new FormData();
    formData.append("file", file);
    if (voice) {
      formData.append("voice", voice);
    }
    if (language) {
      formData.append("language", language);
    }

    const headers: Record<string, string> = {};
    if (token) {
      headers["X-Letha-Token"] = token;
    }

    const res = await fetch(`${base}/api/books/upload`, {
      method: "POST",
      headers,
      body: formData,
    });

    if (!res.ok) throw await toApiError(res);

    return res.json();
  },

  synthesizeChapter: (
    bookId: string,
    chapterIdx: number,
    voice?: string,
    part?: number,
    totalParts: number = 5,
    signal?: AbortSignal
  ) => {
    const params = new URLSearchParams();
    if (voice) params.append("voice", voice);
    if (part !== undefined) params.append("part", part.toString());
    if (totalParts !== undefined) params.append("total_parts", totalParts.toString());
    const query = params.toString() ? `?${params.toString()}` : "";
    return request<{
      status: string;
      part: number;
      total_parts: number;
      is_complete: boolean;
      audio_url: string;
      duration: number;
      sentences: SentenceItem[];
    }>(`/api/books/${bookId}/chapters/${chapterIdx}/synthesize${query}`, {
      method: "POST",
      signal,
    });
  },

  updateProgress: (bookId: string, chapterIdx: number, sentenceIdx: number) =>
    request<{ status: string }>(`/api/books/${bookId}/progress`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapter_idx: chapterIdx, sentence_idx: sentenceIdx }),
    }),

  updateSettings: (bookId: string, voice?: string, speed?: number) =>
    request<{ status: string }>(`/api/books/${bookId}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice, speed }),
    }),

  deleteBook: (bookId: string) =>
    request<{ status: string }>(`/api/books/${bookId}`, {
      method: "DELETE",
    }),
};
