import { api, AppSettings } from "@/lib/api";

type PreferenceChanges = Partial<Pick<AppSettings, "theme" | "font_size" | "show_translation">> & {
  last_book_id?: string;
};

// El servidor las inyecta en el HTML para aplicarlas antes de pintar; en desarrollo (next dev) no existen
export function savedSettings(): Partial<AppSettings> {
  return (typeof window !== "undefined" && window.__LETHA__?.settings) || {};
}

export function savePreferences(changes: PreferenceChanges) {
  // También se actualiza la copia inyectada: al navegar entre páginas no se vuelve a pedir el HTML
  Object.assign(savedSettings(), changes);
  return api.updateAppSettings(changes).catch((err) => console.error("No se pudo guardar la preferencia:", err));
}
