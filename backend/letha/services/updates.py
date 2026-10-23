"""
Comprobación de actualizaciones con el manifiesto latest.json que publica cada release
e instalación de la versión nueva con los mismos instaladores (install.sh / install.ps1)
que usa el usuario.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

from letha import __version__, config, database

# Queda grabada en cada copia instalada: debe ser una URL que se controle a largo plazo
MANIFEST_URL = os.environ.get("LETHA_UPDATE_URL", "https://letha.jurielc.com/updates/latest.json")
# El servidor arranca con cada apertura de la app: se busca una vez por apertura y no en cada petición
_STARTED_AT = time.time()
# Debe coincidir con main.swift: la ventana de macOS se cierra en vez de mostrar un error
UPDATE_EXIT_CODE = 75

# Debe coincidir con CFBundleIdentifier en scripts/install.sh
MACOS_BUNDLE_ID = "app.letha.reader"

INSTALL_COMMANDS = {
    "darwin": "curl -fsSL https://github.com/JUrielC/letha/releases/latest/download/install.sh | sh",
    "win32": "irm https://github.com/JUrielC/letha/releases/latest/download/install.ps1 | iex",
}


UPDATE_ERRORS = {
    "not_installer_copy": "This copy wasn't installed with the Letha installer; update it with git pull.",
    "unsupported_platform": "Updating from the app is only available on macOS and Windows.",
    "open_from_icon": "Open Letha from its icon to update it from the app.",
    "check_failed": "Couldn't check for a new version. Check your connection.",
    "release_incomplete": "The release doesn't include the files needed to update from the app.",
    "checksum_mismatch": "The download doesn't match the fingerprint published on GitHub; the update was cancelled.",
    "already_latest": "You already have the latest version.",
    "download_failed": "Couldn't download the new version. Check your connection.",
}


class UpdateError(Exception):
    def __init__(self, code: str):
        super().__init__(UPDATE_ERRORS[code])
        self.code = code


def parse_version(version: str) -> tuple:
    return tuple(int(n) for n in re.findall(r"\d+", version)[:3])


def is_newer(candidate: str, current: str) -> bool:
    return parse_version(candidate) > parse_version(current)


def _request(url: str) -> urllib.request.Request:
    return urllib.request.Request(url, headers={"User-Agent": f"letha/{__version__}"})


def fetch_latest_release(timeout: float = 6.0) -> Optional[Dict[str, Any]]:
    """Lee el manifiesto de la última versión publicada; None si todavía no hay ninguna."""
    try:
        with urllib.request.urlopen(_request(MANIFEST_URL), timeout=timeout) as response:
            manifest = json.load(response)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    if not isinstance(manifest, dict) or not isinstance(manifest.get("version"), str):
        raise ValueError("Invalid update manifest.")
    return {
        "version": manifest["version"],
        "notes": manifest.get("notes", []),
        "url": manifest.get("release_url"),
        "published_at": manifest.get("published_at"),
        "assets": manifest.get("assets", {}),
    }


def self_update_unavailable_reason() -> Optional[str]:
    """None si esta copia puede actualizarse sola; si no, el código del motivo (ver UPDATE_ERRORS)."""
    prefix = Path(sys.prefix)
    if prefix.name != "letha" or prefix.parent.name != "tools":
        return "not_installer_copy"
    if sys.platform not in INSTALL_COMMANDS:
        return "unsupported_platform"
    if sys.platform == "darwin" and os.environ.get("LETHA_NATIVE") != "1":
        return "open_from_icon"
    return None


def check_for_updates(force: bool = False) -> Dict[str, Any]:
    reason = self_update_unavailable_reason()
    info: Dict[str, Any] = {
        "current_version": __version__,
        "platform": sys.platform,
        "can_self_update": reason is None,
        "self_update_unavailable_reason": reason,
        "install_command": INSTALL_COMMANDS.get(sys.platform),
    }

    last_seen = database.get_setting("last_seen_version")
    if last_seen is None:
        database.set_setting("last_seen_version", __version__)
    elif last_seen != __version__:
        info["updated_from"] = last_seen

    if not force and not database.get_auto_check_updates() and "updated_from" not in info:
        return info

    cached = json.loads(database.get_setting("update_check") or "null")
    if force or not cached or cached["checked_at"] < _STARTED_AT:
        try:
            cached = {"checked_at": time.time(), "release": fetch_latest_release()}
        except (OSError, ValueError):
            info["error"] = "check_failed"
            return info
        database.set_setting("update_check", json.dumps(cached))

    info["checked_at"] = cached["checked_at"]
    release = cached["release"]
    if not release:
        return info

    info.update(
        latest_version=release["version"],
        notes=release["notes"],
        release_url=release["url"],
        published_at=release["published_at"],
        update_available=is_newer(release["version"], __version__),
        skipped=database.get_setting("skipped_update_version") == release["version"],
    )
    return info


def skip_version(version: str) -> None:
    database.set_setting("skipped_update_version", version)


def acknowledge_update() -> None:
    database.set_setting("last_seen_version", __version__)


def _download_verified(asset: Optional[Dict[str, Any]], dest: Path) -> Path:
    if not asset or not asset.get("sha256"):
        raise UpdateError("release_incomplete")
    with urllib.request.urlopen(_request(asset["url"]), timeout=120) as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest() != asset["sha256"]:
        raise UpdateError("checksum_mismatch")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return dest


def _ps_quote(value: Path) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def write_updater_script(directory: Path, wheel: Path, installer: Path, pids: List[int]) -> Path:
    """
    Script que espera a que la app se cierre e instala la versión descargada, que vuelve a abrir Letha.
    Si la instalación falla, abre la versión que ya estaba instalada para no dejar al usuario sin app.
    """
    if sys.platform == "win32":
        script = directory / "update.ps1"
        script.write_text(
            "\n".join(
                [
                    f"foreach ($p in @({', '.join(map(str, pids))})) {{ Wait-Process -Id $p -Timeout 60 -ErrorAction SilentlyContinue }}",
                    f"$env:LETHA_WHEEL = {_ps_quote(wheel)}",
                    f"try {{ & {_ps_quote(installer)} }} catch {{ Start-Process -FilePath {_ps_quote(Path(sys.executable))} -ArgumentList '-m letha.app' }}",
                ]
            )
            + "\n",
            encoding="utf-8",
        )
        return script

    script = directory / "update.sh"
    script.write_text(
        "\n".join(
            [
                "#!/bin/sh",
                f"for pid in {' '.join(map(str, pids))}; do",
                "  tries=0",
                '  while kill -0 "$pid" 2>/dev/null && [ "$tries" -lt 120 ]; do sleep 0.5; tries=$((tries + 1)); done',
                "done",
                f"LETHA_WHEEL={shlex.quote(str(wheel))} /bin/sh {shlex.quote(str(installer))} || open -b {MACOS_BUNDLE_ID}",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    return script


def _launch_detached(script: Path, log: Path) -> None:
    log_file = open(log, "a", encoding="utf-8")
    if sys.platform == "win32":
        subprocess.Popen(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", str(script)],
            stdin=subprocess.DEVNULL,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
            close_fds=True,
        )
    else:
        subprocess.Popen(
            ["/bin/sh", str(script)],
            stdin=subprocess.DEVNULL,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            start_new_session=True,
            close_fds=True,
        )


def _schedule_exit() -> None:
    # El retraso deja que la respuesta HTTP llegue a la interfaz antes de cerrar
    threading.Timer(1.0, os._exit, args=(UPDATE_EXIT_CODE,)).start()


def start_update() -> Dict[str, Any]:
    """Descarga y verifica la versión nueva, lanza el actualizador y programa el cierre de la app."""
    reason = self_update_unavailable_reason()
    if reason:
        raise UpdateError(reason)
    try:
        release = fetch_latest_release()
    except (OSError, ValueError):
        raise UpdateError("check_failed")
    if not release or not is_newer(release["version"], __version__):
        raise UpdateError("already_latest")

    directory = config.CACHE_DIR / "updates" / release["version"]
    wheel_name = f"letha-{release['version']}-py3-none-any.whl"
    installer_name = "install.ps1" if sys.platform == "win32" else "install.sh"
    try:
        wheel = _download_verified(release["assets"].get(wheel_name), directory / wheel_name)
        installer = _download_verified(release["assets"].get(installer_name), directory / installer_name)
    except OSError:
        raise UpdateError("download_failed")

    # En macOS el proceso padre es la ventana nativa, que también debe cerrarse antes de reinstalar
    pids = [os.getpid()] + ([os.getppid()] if sys.platform == "darwin" else [])
    script = write_updater_script(directory, wheel, installer, pids)
    _launch_detached(script, directory / "update.log")
    _schedule_exit()
    return {"version": release["version"]}
