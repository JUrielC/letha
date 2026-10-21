/**
 * Cliente HTTP para comunicarse con el backend de Letha.
 */

export interface SentenceItem {
  index: number;
  text: string;
  start?: number | null;
  end?: number | null;
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
  friendly_name: string;
}

declare global {
  interface Window {
    __LETHA__?: { api: string; token: string };
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

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const base = getBaseUrl();
  const url = `${base}${path}`;
  const token = getToken();
  const headers = new Headers(options?.headers || {});
  if (token) {
    headers.set("X-Letha-Token", token);
  }
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(errData.detail || `Error ${res.status}`);
  }
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

  getVoicePreviewUrl: (voice: string) =>
    `${getBaseUrl()}/api/voices/preview?voice=${encodeURIComponent(voice)}`,

  uploadBook: async (file: File, voice?: string): Promise<BookDetail> => {
    const base = getBaseUrl();
    const token = getToken();
    const formData = new FormData();
    formData.append("file", file);
    if (voice) {
      formData.append("voice", voice);
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

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Error al subir PDF" }));
      throw new Error(err.detail || "Error al subir PDF");
    }

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
