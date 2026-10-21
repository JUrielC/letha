"""
app.py — Letha como aplicación local: arranca el backend de FastAPI,
sirve la interfaz compilada (si existe) y la abre en la ventana nativa (main.swift) o en el navegador.
"""

from __future__ import annotations

import json
import os
import secrets
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

WEB_DIR = Path(__file__).resolve().parent / "web"
NATIVE_WINDOW = Path(__file__).resolve().parent / "bin" / "letha-window"

READY_PREFIX = "LETHA_APP_READY"
PREFERRED_PORT = 47830
STATE_FILE = Path.home() / ".cache" / "letha" / "instance.json"
LOCAL_HOSTS = ["127.0.0.1", "localhost"]
IDLE_SECONDS = 300

_last_seen = time.monotonic()


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
            return HTMLResponse("<h1>Letha Backend Running</h1>", headers={"Cache-Control": "no-store"})
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

            # Si el archivo exacto existe
            if target.is_file() and target.is_relative_to(web_dir):
                if target.suffix == ".html":
                    res = render_html_file(target)
                    await res(scope, receive, send)
                    return
                await static(scope, receive, send)
                return

            # Si piden /reader y existe reader.html
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
        url = json.loads(STATE_FILE.read_text())["url"]
        with urllib.request.urlopen(f"{url}/api/health", timeout=1) as response:
            return url if response.status == 200 else None
    except (OSError, ValueError, KeyError):
        return None


def open_ui(url: str) -> None:
    """Abre la UI usando la ventana nativa de Swift si existe o el navegador predeterminado."""
    if NATIVE_WINDOW.is_file() and os.access(NATIVE_WINDOW, os.X_OK):
        subprocess.Popen([str(NATIVE_WINDOW), url])
        return

    # Si no hay ventana nativa compilada todavía, abrir en el navegador
    webbrowser.open(url)


def main():
    import uvicorn

    existing = _running_instance()
    if existing:
        print(f"Letha ya está en ejecución en {existing}. Abriendo interfaz...")
        open_ui(existing)
        return

    sock = _bind(PREFERRED_PORT)
    port = sock.getsockname()[1]
    token = secrets.token_urlsafe(16)
    url = f"http://127.0.0.1:{port}"

    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps({"url": url, "token": token, "port": port}))

    is_native = os.environ.get("LETHA_NATIVE") == "1"

    # Notificar a la ventana nativa de macOS
    print(f"{READY_PREFIX} {url}", flush=True)

    if not is_native:
        # Abrir la ventana tras medio segundo para que uvicorn alcance a ligarse
        threading.Timer(0.6, lambda: open_ui(url)).start()

    server_app = build_app(token)

    config = uvicorn.Config(
        server_app,
        host="127.0.0.1",
        port=port,
        log_level="info",
    )
    server = uvicorn.Server(config)
    server.run(sockets=[sock])


if __name__ == "__main__":
    main()
