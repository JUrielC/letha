"""
app.py — Letha como aplicación local multiplataforma (macOS y Windows):
arranca el backend de FastAPI, sirve la interfaz compilada y la abre en la ventana
nativa de macOS (main.swift), en modo App de Edge/Chrome en Windows, o en el navegador.
"""

from __future__ import annotations

import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

from letha.config import CACHE_DIR

WEB_DIR = Path(__file__).resolve().parent / "web"
NATIVE_WINDOW = Path(__file__).resolve().parent / "bin" / "letha-window"

READY_PREFIX = "LETHA_APP_READY"
PREFERRED_PORT = 47830
STATE_FILE = CACHE_DIR / "instance.json"
LOG_FILE = CACHE_DIR / "letha.log"
LOCAL_HOSTS = ["127.0.0.1", "localhost"]
IDLE_SECONDS = 90

_last_seen = time.monotonic()


def _ensure_stdio() -> None:
    """
    En Windows con `pythonw.exe` (sin consola), sys.stdout y sys.stderr son None.
    Redirigirlos a un archivo de log evita que print() o el logger de uvicorn fallen.
    """
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if sys.stdout is None:
        sys.stdout = open(LOG_FILE, "a", encoding="utf-8", buffering=1)
    if sys.stderr is None:
        sys.stderr = open(LOG_FILE, "a", encoding="utf-8", buffering=1)


def build_app(token: str, web_dir: Path = WEB_DIR):
    """
    Envuelve la API de FastAPI con el servicio de los archivos estáticos compilados de Next.js.
    """
    from starlette.applications import Starlette
    from starlette.middleware import Middleware
    from starlette.middleware.trustedhost import TrustedHostMiddleware
    from starlette.responses import HTMLResponse
    from starlette.routing import Mount, Route
    from starlette.staticfiles import StaticFiles

    from letha import api

    web_dir = web_dir.resolve()
    index_file = web_dir / "index.html"
    config = json.dumps({"api": "", "token": token})

    def render_html_file(file_path: Path) -> HTMLResponse:
        if not file_path.is_file():
            return HTMLResponse(
                "<h1>Letha Backend Running</h1>", headers={"Cache-Control": "no-store"}
            )
        content = file_path.read_text(encoding="utf-8")
        injected = content.replace(
            "<head>", f"<head><script>window.__LETHA__ = {config};</script>", 1
        )
        return HTMLResponse(injected, headers={"Cache-Control": "no-store"})

    async def home(request):
        _touch()
        return render_html_file(index_file)

    static = StaticFiles(directory=web_dir) if web_dir.is_dir() else None

    async def dispatch(scope, receive, send):
        _touch()
        if static and scope["type"] == "http":
            rel_path = scope["path"].lstrip("/")
            target = (web_dir / rel_path).resolve() if rel_path else index_file

            if target.is_file() and target.is_relative_to(web_dir):
                if target.suffix == ".html":
                    res = render_html_file(target)
                    await res(scope, receive, send)
                    return
                await static(scope, receive, send)
                return

            html_target = (web_dir / f"{rel_path}.html").resolve()
            if html_target.is_file() and html_target.is_relative_to(web_dir):
                res = render_html_file(html_target)
                await res(scope, receive, send)
                return

        await api.app(scope, receive, send)

    routes = [Route("/", home)] if static else []
    routes.append(Mount("/", app=dispatch))

    return Starlette(
        routes=routes,
        middleware=[Middleware(TrustedHostMiddleware, allowed_hosts=LOCAL_HOSTS)],
    )


def _touch() -> None:
    global _last_seen
    _last_seen = time.monotonic()


def _shutdown_when_idle(server, idle_seconds: float = IDLE_SECONDS, poll: float = 10.0) -> None:
    """Cierra el servidor automáticamente cuando la ventana lleva cerrada más de `idle_seconds`."""
    while not server.should_exit:
        time.sleep(poll)
        if time.monotonic() - _last_seen > idle_seconds:
            server.should_exit = True


def _bind(port: int) -> socket.socket:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind(("127.0.0.1", port))
    except OSError:
        sock.close()
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind(("127.0.0.1", 0))
    return sock


def _running_instance() -> str | None:
    try:
        url = json.loads(STATE_FILE.read_text(encoding="utf-8"))["url"]
        with urllib.request.urlopen(f"{url}/api/health", timeout=1) as response:
            return url if response.status == 200 else None
    except (OSError, ValueError, KeyError):
        return None


def _find_windows_app_browser() -> str | None:
    """Busca Microsoft Edge o Google Chrome en Windows para abrir en modo ventana nativa (--app)."""
    candidates = [
        shutil.which("msedge"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
        shutil.which("chrome"),
        os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
    ]
    for path in candidates:
        if path and Path(path).is_file():
            return str(path)
    return None


def open_ui(url: str) -> None:
    """Abre la interfaz como ventana de escritorio en macOS y Windows."""
    if sys.platform == "darwin" and NATIVE_WINDOW.is_file() and os.access(NATIVE_WINDOW, os.X_OK):
        subprocess.Popen([str(NATIVE_WINDOW), url])
        return

    if sys.platform == "win32":
        browser_exe = _find_windows_app_browser()
        if browser_exe:
            subprocess.Popen([browser_exe, f"--app={url}", "--new-window"])
            return

    webbrowser.open(url)


def main():
    _ensure_stdio()
    import uvicorn

    existing = _running_instance()
    if existing:
        print(f"Letha ya está en ejecución en {existing}. Abriendo interfaz...", flush=True)
        open_ui(existing)
        return

    sock = _bind(PREFERRED_PORT)
    port = sock.getsockname()[1]
    token = secrets.token_urlsafe(16)
    url = f"http://127.0.0.1:{port}"

    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps({"url": url, "token": token, "port": port}), encoding="utf-8")

    is_native = os.environ.get("LETHA_NATIVE") == "1"

    print(f"{READY_PREFIX} {url}", flush=True)

    if not is_native:
        threading.Timer(0.6, lambda: open_ui(url)).start()

    server_app = build_app(token)

    config = uvicorn.Config(
        server_app,
        host="127.0.0.1",
        port=port,
        log_level="info",
    )
    server = uvicorn.Server(config)

    if not is_native:
        threading.Thread(
            target=_shutdown_when_idle, args=(server,), daemon=True
        ).start()

    server.run(sockets=[sock])


if __name__ == "__main__":
    main()
