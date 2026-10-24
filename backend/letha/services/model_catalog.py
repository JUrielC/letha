"""
Catálogo de descargas publicado en letha.jurielc.com: indica de dónde bajar cada modelo para poder cambiar de
hospedaje sin actualizar la app. Las huellas SHA-256 siguen fijas en el código, así que el catálogo solo decide
la dirección, nunca el contenido de lo que se instala.
"""

from __future__ import annotations

import json
import os
import urllib.request
from typing import Dict

from letha import __version__

# Queda grabada en cada copia instalada: debe ser una URL que se controle a largo plazo
CATALOG_URL = os.environ.get("LETHA_MODELS_URL", "https://letha.jurielc.com/models/catalog.json")


def resolve(section: str, defaults: Dict[str, str]) -> Dict[str, str]:
    """Direcciones de descarga de `section`; las que falten en el catálogo, o si no responde, quedan como en `defaults`."""
    urls = dict(defaults)
    try:
        request = urllib.request.Request(CATALOG_URL, headers={"User-Agent": f"letha/{__version__}"})
        with urllib.request.urlopen(request, timeout=10) as response:
            published = json.load(response).get(section, {})
    except (OSError, ValueError, AttributeError):
        return urls
    for name in urls:
        if isinstance(published.get(name), str):
            urls[name] = published[name]
    return urls
