import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center gap-3"
      style={{ backgroundColor: "var(--bg)", color: "var(--muted)" }}
    >
      <Loader2 className="w-8 h-8 animate-spin text-[#1ea7e8]" />
      <span className="text-sm text-[#93a3b8]">Cargando...</span>
    </div>
  );
}
