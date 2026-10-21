#!/usr/bin/env bash
# Detiene todos los procesos de Frontend y Backend de Letha.
set -euo pipefail

# Resolver symlinks para obtener siempre la raíz real del repositorio
SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
    DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
    SOURCE="$(readlink "$SOURCE")"
    [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PID_FILE="$ROOT/.dev.pids"

echo "Deteniendo servicios de Letha..."

# 1. Matar PIDs registrados
if [ -f "$PID_FILE" ]; then
    while read -r pid; do
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
        fi
    done < "$PID_FILE"
    rm -f "$PID_FILE"
fi

# 2. Liberar puertos 47830 (FastAPI) y 3000 (Next.js)
PIDS=$(lsof -ti:47830,3000 2>/dev/null || true)
if [ -n "$PIDS" ]; then
    echo "$PIDS" | xargs kill -9 2>/dev/null || true
fi

# 3. Limpiar cualquier proceso residual de Python con letha
pkill -f "letha.api" 2>/dev/null || true

echo "✓ Frontend y Backend detenidos por completo."
