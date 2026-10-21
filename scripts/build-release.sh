#!/usr/bin/env bash
# Construye el paquete distribuible de Letha: un wheel de Python con
# la interfaz Next.js ya compilada y la ventana nativa de macOS dentro.
#
# Salida: dist/letha-<versión>-py3-none-macosx_12_0_arm64.whl
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB="$ROOT/backend/letha/web"
BIN="$ROOT/backend/letha/bin"

echo "→ 1. Compilando la interfaz estática Next.js..."
(cd "$ROOT/frontend" && LETHA_STATIC=1 bun run build)

rm -rf "$WEB"
mkdir -p "$WEB"
cp -R "$ROOT/frontend/out/"* "$WEB/"

echo "→ 2. Compilando la ventana nativa de macOS en Swift..."
mkdir -p "$BIN"
xcrun swiftc -O -target arm64-apple-macos12 \
  "$ROOT/native/macos/main.swift" -o "$BIN/letha-window" \
  -framework Cocoa -framework WebKit

echo "→ 3. Construyendo el wheel de Python con uv..."
rm -rf "$ROOT/dist"
(cd "$ROOT/backend" && uv build --wheel --out-dir "$ROOT/dist")

# Marcar el wheel para macOS ARM64 debido al binario nativo de Swift
uvx --quiet --from wheel wheel tags --remove --platform-tag macosx_12_0_arm64 "$ROOT"/dist/*.whl >/dev/null 2>&1 || true

WHEEL="$(ls "$ROOT"/dist/*.whl | head -1)"
echo "✓ Listo: $WHEEL ($(du -h "$WHEEL" | cut -f1))"
