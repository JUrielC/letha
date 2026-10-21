"""
Configuración global de pytest: aísla LETHA_DATA_DIR y LETHA_CACHE_DIR en un
directorio temporal antes de importar cualquier módulo de letha, evitando que
las pruebas toquen la biblioteca o caché real del usuario.
"""

import os
from pathlib import Path
import tempfile
import pytest

_TEST_ROOT = Path(tempfile.mkdtemp(prefix="letha_pytest_"))
os.environ["LETHA_DATA_DIR"] = str(_TEST_ROOT / "data")
os.environ["LETHA_CACHE_DIR"] = str(_TEST_ROOT / "cache")


@pytest.fixture(autouse=True)
def isolate_test_storage(tmp_path, monkeypatch):
    """Aísla las rutas de datos y base de datos por cada test individual."""
    from letha import api, config

    data_dir = tmp_path / "data"
    cache_dir = tmp_path / "cache"
    books_dir = data_dir / "books"
    covers_dir = data_dir / "covers"
    audio_dir = data_dir / "audio"
    db_path = data_dir / "library.db"

    for d in (data_dir, cache_dir, books_dir, covers_dir, audio_dir):
        d.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(config, "DATA_DIR", data_dir)
    monkeypatch.setattr(config, "CACHE_DIR", cache_dir)
    monkeypatch.setattr(config, "BOOKS_DIR", books_dir)
    monkeypatch.setattr(config, "COVERS_DIR", covers_dir)
    monkeypatch.setattr(config, "AUDIO_DIR", audio_dir)
    monkeypatch.setattr(config, "DB_PATH", db_path)

    api.set_token(None)
    yield
    api.set_token(None)
