"""
Desinstalación desde la app: un script aparte espera a que Letha se cierre y quita el paquete de uv,
los accesos directos y los archivos temporales, y también la biblioteca si el usuario lo pide.
"""

from __future__ import annotations

import os
import plistlib
import shlex
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import List, Optional

from letha import config
from letha.services import updates


def _uv_executable() -> str:
    """uv con ruta absoluta: la app no siempre hereda el PATH que dejó el instalador."""
    name = "uv.exe" if sys.platform == "win32" else "uv"
    for candidate in (shutil.which("uv"), Path.home() / ".local" / "bin" / name, Path.home() / ".cargo" / "bin" / name):
        if candidate and Path(candidate).is_file():
            return str(candidate)
    return "uv"


def _macos_app_bundle() -> Optional[Path]:
    """El Letha.app de esta ventana; se comprueba su identificador para no borrar nunca otra app."""
    try:
        executable = subprocess.run(
            ["ps", "-o", "comm=", "-p", str(os.getppid())], capture_output=True, text=True, check=True
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        executable = ""
    bundles = [p for p in Path(executable).parents if p.suffix == ".app"]
    for bundle in bundles + [Path.home() / "Applications" / "Letha.app"]:
        try:
            with open(bundle / "Contents" / "Info.plist", "rb") as f:
                if plistlib.load(f).get("CFBundleIdentifier") == updates.MACOS_BUNDLE_ID:
                    return bundle
        except (OSError, ValueError):
            continue
    return None


def _windows_shortcuts() -> List[Path]:
    """Los accesos directos de install.ps1, en las carpetas reales del usuario (el Escritorio puede estar en OneDrive)."""
    import winreg

    try:
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders"
        ) as key:
            folders = [os.path.expandvars(winreg.QueryValueEx(key, name)[0]) for name in ("Desktop", "Programs")]
    except OSError:
        folders = [
            Path.home() / "Desktop",
            Path(os.environ.get("APPDATA", "")) / "Microsoft" / "Windows" / "Start Menu" / "Programs",
        ]
    return [Path(folder) / "Letha.lnk" for folder in folders]


def _paths_to_remove(delete_library: bool) -> List[Path]:
    paths = [config.CACHE_DIR]
    if delete_library:
        paths.append(config.DATA_DIR)
    if sys.platform == "win32":
        paths += _windows_shortcuts()
    if sys.platform == "darwin":
        library = Path.home() / "Library"
        bundle = _macos_app_bundle()
        paths += [bundle] if bundle else []
        paths += [
            library / "Logs" / "letha.log",
            library / "Caches" / updates.MACOS_BUNDLE_ID,
            library / "HTTPStorages" / updates.MACOS_BUNDLE_ID,
        ]
        if delete_library:
            paths.append(library / "WebKit" / updates.MACOS_BUNDLE_ID)
    return paths


def write_uninstaller_script(directory: Path, pids: List[int], delete_library: bool) -> Path:
    """Script que espera a que la app se cierre y la desinstala."""
    uv = _uv_executable()
    paths = _paths_to_remove(delete_library)

    if sys.platform == "win32":
        script = directory / "uninstall.ps1"
        lines = [
            *updates._wait_for(pids),
            f"& {updates._ps_quote(Path(uv))} tool uninstall letha",
            f"Remove-Item -LiteralPath {', '.join(map(updates._ps_quote, paths))} -Recurse -Force -ErrorAction SilentlyContinue",
        ]
    else:
        script = directory / "uninstall.sh"
        lines = [
            "#!/bin/sh",
            *updates._wait_for(pids),
            f"{shlex.quote(uv)} tool uninstall letha",
            f"rm -rf {' '.join(shlex.quote(str(p)) for p in paths)}",
        ]
        if delete_library:
            lines.append(f"defaults delete {updates.MACOS_BUNDLE_ID} 2>/dev/null")

    script.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return script


def start_uninstall(delete_library: bool) -> None:
    """Lanza el desinstalador y programa el cierre de la app."""
    reason = updates.self_update_unavailable_reason()
    if reason:
        raise updates.UpdateError(reason)
    # Fuera de CACHE_DIR: el desinstalador borra esa carpeta mientras escribe su log
    directory = Path(tempfile.mkdtemp(prefix="letha-uninstall-"))
    script = write_uninstaller_script(directory, updates._app_pids(), delete_library)
    updates._launch_detached(script, directory / "uninstall.log")
    updates._schedule_exit()
