import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center gap-3"
      style={{ color: "var(--muted)" }}
    >
      <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--accent)" }} />
      <span className="text-sm" style={{ color: "var(--muted)" }}>Cargando...</span>
    </div>
  );
}
