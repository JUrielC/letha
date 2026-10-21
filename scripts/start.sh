#!/usr/bin/env bash
# Arranca tanto el Backend como el Frontend en paralelo para desarrollo.
# Al presionar Ctrl+C se apagan ambos limpiamente.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT/.dev.pids"

cleanup() {
    echo ""
    echo "→ Deteniendo servicios..."
    if [ -f "$PID_FILE" ]; then
        while read -r pid; do
            if kill -0 "$pid" 2>/dev/null; then
                kill "$pid" 2>/dev/null || true
            fi
        done < "$PID_FILE"
        rm -f "$PID_FILE"
    fi
    # Liberar puertos por seguridad
    lsof -ti:47830,3000 2>/dev/null | xargs kill -9 2>/dev/null || true
    echo "✓ Servicios detenidos correctamente."
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# Detener instancias previas que puedan estar ocupando los puertos
lsof -ti:47830,3000 2>/dev/null | xargs kill -9 2>/dev/null || true

echo "=========================================="
echo "  Iniciando Letha en modo desarrollo"
echo "=========================================="

echo "→ 1. Arrancando Backend (FastAPI en http://127.0.0.1:47830)..."
(cd "$ROOT/backend" && .venv/bin/python -m letha.api) &
BACKEND_PID=$!

echo "→ 2. Arrancando Frontend (Next.js en http://localhost:3000)..."
if command -v bun >/dev/null 2>&1; then
    (cd "$ROOT/frontend" && bun dev) &
else
    (cd "$ROOT/frontend" && npm run dev) &
fi
FRONTEND_PID=$!

echo "$BACKEND_PID" > "$PID_FILE"
echo "$FRONTEND_PID" >> "$PID_FILE"

echo ""
echo "✓ Servicios activos:"
echo "  • Frontend: http://localhost:3000"
echo "  • Backend:  http://127.0.0.1:47830 (Docs: /docs)"
echo ""
echo "Presiona Ctrl+C en esta terminal para detener ambos."
echo "=========================================="

wait
