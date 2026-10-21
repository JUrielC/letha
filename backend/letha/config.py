"""
Configuración y rutas de almacenamiento para Letha.
"""

from __future__ import annotations

import os
from pathlib import Path

# Directorios de datos del usuario
APP_NAME = "letha"

DATA_DIR = Path(os.environ.get("LETHA_DATA_DIR", Path.home() / ".local" / "share" / APP_NAME))
CACHE_DIR = Path(os.environ.get("LETHA_CACHE_DIR", Path.home() / ".cache" / APP_NAME))

BOOKS_DIR = DATA_DIR / "books"
COVERS_DIR = DATA_DIR / "covers"
AUDIO_DIR = DATA_DIR / "audio"
DB_PATH = DATA_DIR / "library.db"

# Asegurar que existan
for d in (DATA_DIR, CACHE_DIR, BOOKS_DIR, COVERS_DIR, AUDIO_DIR):
    d.mkdir(parents=True, exist_ok=True)

# Voces recomendadas por defecto
DEFAULT_VOICE = "es-MX-DaliaNeural"
DEFAULT_SPEED = 1.0
