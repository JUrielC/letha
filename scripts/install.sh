#!/bin/sh
# Instala Letha en una Mac con Apple Silicon:
#
#   curl -fsSL https://github.com/JUrielC/letha/releases/latest/download/install.sh | sh
#
set -eu

REPO="JUrielC/letha"
APP_DIR="${LETHA_APP_DIR:-$HOME/Applications}"
APP="$APP_DIR/Letha.app"
LOG="$HOME/Library/Logs/letha.log"

say() { printf '%s\n' "$*"; }
fail() { printf '\n%s\n' "$*" >&2; exit 1; }

say ""
say "Installing Letha…"

[ "$(uname -s)" = "Darwin" ] || fail "For now, Letha only runs on macOS."
[ "$(uname -m)" = "arm64" ] || fail "Letha needs a Mac with Apple Silicon (M1 or later)."

export PATH="$HOME/.local/bin:$PATH"
if ! command -v uv >/dev/null 2>&1; then
  say "→ Installing uv (fast Python installer)…"
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
command -v uv >/dev/null 2>&1 || fail "uv could not be installed. Check your internet connection."

first_wheel() {
  grep -o '"browser_download_url": *"[^"]*\.whl"' | head -1 | sed 's/.*"\(https[^"]*\)"/\1/'
}

WHEEL="${LETHA_WHEEL:-}"
if [ -z "$WHEEL" ]; then
  WHEEL="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null | first_wheel || true)"
  if [ -z "$WHEEL" ]; then
    WHEEL="$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=10" 2>/dev/null | first_wheel || true)"
  fi
  [ -n "$WHEEL" ] || fail "No published version of Letha was found yet."
fi

VERSION="$(basename "$WHEEL" | sed -n 's/^letha-\([^-]*\)-.*\.whl$/\1/p')"
VERSION="${VERSION:-0.1.0}"

say "→ Installing Letha ${VERSION}…"
uv tool install --force --python 3.12 "$WHEEL"

BIN="$(uv tool dir --bin --color never)/letha"
[ -x "$BIN" ] || fail "The installation finished but the letha command was not found."

say "→ Creating the shortcut in $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"

PYTHON="$(uv tool dir --color never)/letha/bin/python"
WINDOW="$("$PYTHON" -c 'import letha.app as a; print(a.NATIVE_WINDOW if a.NATIVE_WINDOW.exists() else "")' 2>/dev/null || true)"

if [ -n "$WINDOW" ]; then
  cp "$WINDOW" "$APP/Contents/MacOS/letha"
  EXTRA_KEYS="  <key>LethaCommand</key><string>$BIN</string>
  <key>NSHighResolutionCapable</key><true/>"
else
  cat > "$APP/Contents/MacOS/letha" <<EOF
#!/bin/sh
mkdir -p "\$HOME/Library/Logs"
exec "$BIN" >> "$LOG" 2>&1
EOF
  EXTRA_KEYS="  <key>LSUIElement</key><true/>"
fi
chmod +x "$APP/Contents/MacOS/letha"

ICON="$("$PYTHON" -c 'import letha.app as a; print(a.MAC_ICON if a.MAC_ICON.exists() else "")' 2>/dev/null || true)"
ICON_KEY=""
if [ -n "$ICON" ]; then
  mkdir -p "$APP/Contents/Resources"
  cp "$ICON" "$APP/Contents/Resources/letha.icns"
  ICON_KEY="  <key>CFBundleIconFile</key><string>letha</string>"
fi

cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Letha</string>
  <key>CFBundleDisplayName</key><string>Letha</string>
  <key>CFBundleIdentifier</key><string>app.letha.reader</string>
  <key>CFBundleExecutable</key><string>letha</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
$ICON_KEY
$EXTRA_KEYS
</dict>
</plist>
EOF

codesign --force --sign - "$APP" >/dev/null 2>&1 || true
# El Dock y Finder guardan el icono de la versión anterior hasta que se vuelve a registrar la app
touch "$APP"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP" >/dev/null 2>&1 || true

say ""
say "✓ Done. Letha is in your Applications folder: find it with Spotlight (⌘ + space, 'Letha')."
say "To update it: run this command again."
say "To uninstall it: uv tool uninstall letha && rm -rf \"$APP\" ~/.cache/letha ~/.local/share/letha"

if [ -z "${LETHA_NO_LAUNCH:-}" ]; then
  open "$APP"
fi
