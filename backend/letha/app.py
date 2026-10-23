"""
app.py — Letha como aplicación local multiplataforma (macOS y Windows):
arranca el backend de FastAPI, sirve la interfaz compilada y la abre en la ventana
nativa de macOS (main.swift), en una ventana de WebView2 en Windows (o en modo App de
Edge/Chrome si WebView2 no está disponible), o en el navegador.
"""

from __future__ import annotations

import asyncio
import ctypes
import json
import os
import secrets
import shutil
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import traceback
import urllib.request
import webbrowser
from concurrent.futures import Future
from contextlib import closing
from pathlib import Path

from letha import config
from letha.config import CACHE_DIR

WEB_DIR = Path(__file__).resolve().parent / "web"
NATIVE_WINDOW = Path(__file__).resolve().parent / "bin" / "letha-window"
LOADING_PAGE = Path(__file__).resolve().parent / "loading.html"

READY_PREFIX = "LETHA_APP_READY"
STATE_FILE = CACHE_DIR / "instance.json"
LOG_FILE = CACHE_DIR / "letha.log"
LOCAL_HOSTS = ["127.0.0.1", "localhost"]
IDLE_SECONDS = 300
WINDOW_COLORS = {"light": "#f1f3f6", "sepia": "#efe8dc", "dark": "#0d0e11"}

_last_seen = time.monotonic()
_window = None


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


def _inject_config(html: str, values: dict) -> str:
    # Se escapa "<" para que un valor con "</script>" no pueda cerrar la etiqueta
    payload = json.dumps(values).replace("<", "\\u003c")
    return html.replace("<head>", f"<head><script>window.__LETHA__ = {payload};</script>", 1)


def _saved_appearance() -> dict:
    """Tema e idioma guardados, leídos sin importar letha.database, que tarda segundos en cargar."""
    try:
        with closing(sqlite3.connect(config.DB_PATH)) as conn:
            saved = dict(
                conn.execute("SELECT key, value FROM app_settings WHERE key IN ('ui_theme', 'native_language')")
            )
    except sqlite3.Error:
        saved = {}
    return {"theme": saved.get("ui_theme", "light"), "native_language": saved.get("native_language")}


def _bring_window_to_front() -> None:
    _window.restore()
    _window.show()


def build_app(token: str, web_dir: Path = WEB_DIR):
    """
    Envuelve la API de FastAPI con el servicio de los archivos estáticos compilados de Next.js.
    """
    from starlette.applications import Starlette
    from starlette.middleware import Middleware
    from starlette.middleware.trustedhost import TrustedHostMiddleware
    from starlette.responses import HTMLResponse, Response
    from starlette.routing import Mount, Route
    from starlette.staticfiles import StaticFiles

    from letha import api, database

    database.init_db()
    api.set_token(token)

    web_dir = web_dir.resolve()
    index_file = web_dir / "index.html"

    def render_html_file(file_path: Path) -> HTMLResponse:
        if not file_path.is_file():
            res = HTMLResponse(
                "<h1>Letha Backend Running</h1>", headers={"Cache-Control": "no-store"}
            )
        else:
            settings = {**database.get_ui_preferences(), "native_language": database.get_native_language()}
            injected = _inject_config(
                file_path.read_text(encoding="utf-8"), {"api": "", "token": token, "settings": settings}
            )
            res = HTMLResponse(injected, headers={"Cache-Control": "no-store"})
        res.set_cookie(
            key="letha_token",
            value=token,
            httponly=True,
            samesite="strict",
            path="/",
        )
        return res

    async def home(request):
        _touch()
        return render_html_file(index_file)

    async def show_window(request):
        if request.headers.get("X-Letha-Token") != token or _window is None:
            return Response(status_code=404)
        await asyncio.to_thread(_bring_window_to_front)
        return Response(status_code=204)

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

    routes = [Route("/api/window/show", show_window, methods=["POST"])]
    if static:
        routes.append(Route("/", home))
    routes.append(Mount("/", app=dispatch))

    return Starlette(
        routes=routes,
        middleware=[Middleware(TrustedHostMiddleware, allowed_hosts=LOCAL_HOSTS)],
    )


def with_loading_screen(app_future: Future, page: Path = LOADING_PAGE):
    """Responde / con la pantalla de carga hasta que `app_future` tenga la app real; el resto de peticiones la esperan."""
    from starlette.responses import HTMLResponse

    page_html = page.read_text(encoding="utf-8")

    async def gate(scope, receive, send):
        if scope["type"] == "lifespan":
            for phase in ("startup", "shutdown"):
                await receive()
                await send({"type": f"lifespan.{phase}.complete"})
            return
        if scope["type"] == "http" and scope["path"] == "/" and not app_future.done():
            loading = HTMLResponse(
                _inject_config(page_html, {"settings": _saved_appearance()}), headers={"Cache-Control": "no-store"}
            )
            await loading(scope, receive, send)
            return
        app = await asyncio.wrap_future(app_future)
        await app(scope, receive, send)

    return gate


def _start_build(app_future: Future, token: str) -> None:
    """Construye la app real en otro hilo y deja el resultado en `app_future`; no hace nada si ya empezó."""
    if app_future.running() or app_future.done():
        return
    app_future.set_running_or_notify_cancel()

    def build():
        try:
            app_future.set_result(build_app(token))
        except BaseException as error:
            app_future.set_exception(error)

    # Daemon: si se cierra la ventana a media carga, el proceso no espera a que termine
    threading.Thread(target=build, daemon=True).start()


def _touch() -> None:
    global _last_seen
    _last_seen = time.monotonic()


def _shutdown_when_idle(
    server, app_future: Future, idle_seconds: float = IDLE_SECONDS, poll: float = 10.0
) -> None:
    """Cierra el servidor automáticamente cuando la ventana lleva cerrada más de `idle_seconds`."""
    error = app_future.exception()
    if error:
        traceback.print_exception(error)
        server.should_exit = True
        return

    from letha import api

    while not server.should_exit:
        time.sleep(poll)
        if api.busy():
            _touch()
            continue
        if time.monotonic() - _last_seen > idle_seconds:
            server.should_exit = True


def _watch_parent(server, parent_pid: int, poll: float = 2.0) -> None:
    """En modo nativo (macOS), vigila el proceso padre (Letha.app) por si se cierra forzosamente."""
    while not server.should_exit:
        time.sleep(poll)
        if os.getppid() != parent_pid:
            server.should_exit = True
            return
        try:
            os.kill(parent_pid, 0)
        except ProcessLookupError:
            server.should_exit = True
            return
        except PermissionError:
            pass


def _bind() -> socket.socket:
    """Socket en un puerto libre que elige el sistema al azar, para no chocar con otra copia de Letha."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    # La UI se abre antes de que uvicorn arranque: escuchar ya deja las conexiones en cola en vez de rechazarlas.
    sock.listen()
    return sock


def _running_instance() -> dict | None:
    try:
        state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        # Una instancia que aún está arrancando ya acepta la conexión y responde al terminar de cargar.
        with urllib.request.urlopen(f"{state['url']}/api/health", timeout=30) as response:
            return state if response.status == 200 else None
    except (OSError, ValueError, KeyError, TypeError):
        return None


def _forget_instance(url: str) -> None:
    """Borra instance.json si sigue apuntando a esta instancia: en Windows, conectar a un puerto cerrado tarda 2 s."""
    try:
        if json.loads(STATE_FILE.read_text(encoding="utf-8")).get("url") == url:
            STATE_FILE.unlink()
    except (OSError, ValueError):
        pass


def _show_existing_window(state: dict) -> bool:
    """Pide a la instancia abierta que traiga su ventana nativa al frente; False si no tiene una."""
    if sys.platform == "win32":
        # Windows solo deja pasar al frente la ventana de otro proceso si lo autoriza este, que acaba de abrir el usuario
        ctypes.windll.user32.AllowSetForegroundWindow(-1)
    request = urllib.request.Request(
        f"{state['url']}/api/window/show", method="POST", headers={"X-Letha-Token": state.get("token", "")}
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status == 204
    except OSError:
        return False


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


def _run_in_native_window(server, sock: socket.socket, url: str, app_future: Future, token: str) -> bool:
    """
    Abre Letha en una ventana de WebView2 y apaga el servidor al cerrarla.
    False si WebView2 no está disponible, para que se use el modo App de Edge/Chrome.
    """
    try:
        import webview
        from webview.platforms import winforms
    except Exception:
        traceback.print_exc()
        return False
    # Sin WebView2, pywebview usa en silencio el motor de Internet Explorer, que no puede con la interfaz
    if winforms.renderer != "edgechromium":
        return False

    global _window
    _window = webview.create_window(
        "Letha",
        url,
        width=1100,
        height=750,
        min_size=(800, 550),
        background_color=WINDOW_COLORS.get(_saved_appearance()["theme"], WINDOW_COLORS["light"]),
        text_select=True,
    )
    # La carga pesada espera a que se vea la pantalla de carga para no competir con WebView2 por el intérprete
    _window.events.loaded += lambda: _start_build(app_future, token)
    server_thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    server_thread.start()
    try:
        webview.start(gui="edgechromium", private_mode=False, storage_path=str(CACHE_DIR / "webview"))
    except Exception:
        traceback.print_exc()
        _start_build(app_future, token)
        open_ui(url)
        _shutdown_when_idle(server, app_future)
    server.should_exit = True
    server_thread.join(timeout=10)
    return True


def main():
    _ensure_stdio()
    import uvicorn

    is_native = os.environ.get("LETHA_NATIVE") == "1"

    existing = _running_instance()
    if existing:
        if is_native:
            print(f"{READY_PREFIX} {existing['url']} owner=existing", flush=True)
        elif not _show_existing_window(existing):
            print(f"Letha ya está en ejecución en {existing['url']}. Abriendo interfaz...", flush=True)
            open_ui(existing["url"])
        return

    sock = _bind()
    port = sock.getsockname()[1]
    token = secrets.token_urlsafe(16)
    url = f"http://127.0.0.1:{port}"

    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps({"url": url, "token": token, "port": port}), encoding="utf-8")

    print(f"{READY_PREFIX} {url} owner=new", flush=True)

    if is_native:
        server_app = build_app(token)
    else:
        app_future = Future()
        server_app = with_loading_screen(app_future)

    server_config = uvicorn.Config(
        server_app,
        host="127.0.0.1",
        port=port,
        log_level="info",
        # Sin límite, una conexión que el cliente corta en Windows puede dejar el apagado colgado para siempre
        timeout_graceful_shutdown=5,
    )
    server = uvicorn.Server(server_config)

    if is_native:
        parent_pid = os.getppid()
        if parent_pid > 1:
            threading.Thread(
                target=_watch_parent, args=(server, parent_pid), daemon=True
            ).start()
    elif sys.platform == "win32" and _run_in_native_window(server, sock, url, app_future, token):
        _forget_instance(url)
        sys.stdout.flush()
        sys.stderr.flush()
        # El servidor ya se apagó; descargar .NET al salir tardaría varios segundos más sin nada que cerrar
        os._exit(0)
    else:
        _start_build(app_future, token)
        threading.Timer(0.6, lambda: open_ui(url)).start()
        threading.Thread(
            target=_shutdown_when_idle, args=(server, app_future), daemon=True
        ).start()

    server.run(sockets=[sock])
    _forget_instance(url)


if __name__ == "__main__":
    main()
