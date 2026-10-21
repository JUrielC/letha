"""
Pruebas de la API y del servidor empaquetado de Letha con TestClient.
"""

import io
from fastapi.testclient import TestClient
import pymupdf
import pytest

from letha import api, database
from letha.app import build_app


@pytest.fixture(autouse=True)
def reset_token():
    api.set_token(None)
    yield
    api.set_token(None)


def create_sample_pdf() -> bytes:
    doc = pymupdf.open()
    page1 = doc.new_page()
    page1.insert_text(
        (50, 50),
        "Capítulo 1: El Inicio\nEsta es la primera oración de prueba. Y aquí viene la segunda oración.",
    )

    page2 = doc.new_page()
    page2.insert_text(
        (50, 50),
        "Capítulo 2: El Desarrollo\nContinuamos con la lectura interactiva. Letha sincroniza cada frase perfectamente.",
    )

    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


def test_health():
    client = TestClient(api.app)
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "app": "letha"}


def test_build_app_initializes_fresh_db_and_enforces_token(tmp_path, monkeypatch):
    """
    Verifica que en una instalación limpia (base de datos inexistente), build_app()
    crea las tablas automáticamente y exige el token de sesión en /api/*.
    """
    fresh_db = tmp_path / "fresh_library.db"
    monkeypatch.setattr(database, "DB_PATH", fresh_db)
    assert not fresh_db.exists()

    token = "secreto-prueba-123"
    packaged_app = build_app(token=token, web_dir=tmp_path)
    assert fresh_db.exists()

    client = TestClient(packaged_app, base_url="http://127.0.0.1")

    # /api/health sigue público para el chequeo de instancia y KeepAlive
    res_health = client.get("/api/health")
    assert res_health.status_code == 200

    # Sin token debe ser rechazado con 401
    res_unauth = client.get("/api/books")
    assert res_unauth.status_code == 401

    # Con cabecera X-Letha-Token funciona y devuelve lista vacía en DB recién creada
    res_books = client.get("/api/books", headers={"X-Letha-Token": token})
    assert res_books.status_code == 200
    assert res_books.json() == []

    # Con query param ?token= (usado en <img> y <audio>) también se autoriza
    res_query = client.get(f"/api/books?token={token}")
    assert res_query.status_code == 200


def test_cors_blocks_external_origins():
    """Verifica que orígenes externos maliciosos no reciban cabeceras CORS."""
    client = TestClient(api.app)

    evil = client.options(
        "/api/books",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "DELETE",
        },
    )
    assert "access-control-allow-origin" not in evil.headers

    dev = client.options(
        "/api/books",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "DELETE",
        },
    )
    assert dev.headers.get("access-control-allow-origin") == "http://localhost:3000"


def test_upload_and_read_book(tmp_path, monkeypatch):
    fresh_db = tmp_path / "test_library.db"
    monkeypatch.setattr(database, "DB_PATH", fresh_db)
    database.init_db()

    client = TestClient(api.app)
    pdf_bytes = create_sample_pdf()

    files = {"file": ("test_libro.pdf", io.BytesIO(pdf_bytes), "application/pdf")}
    res = client.post("/api/books/upload", files=files)
    assert res.status_code == 200
    book = res.json()
    assert book["title"] == "test_libro"
    assert book["total_pages"] == 2
    assert len(book["chapters"]) >= 1

    book_id = book["id"]

    # Listar libros
    res_list = client.get("/api/books")
    assert res_list.status_code == 200
    books = res_list.json()
    assert any(b["id"] == book_id for b in books)

    # Obtener capítulo 0
    res_chap = client.get(f"/api/books/{book_id}/chapters/0")
    assert res_chap.status_code == 200
    chap = res_chap.json()
    assert len(chap["sentences"]) > 0

    # Actualizar progreso (capítulo 1, oración 1) y verificar que persiste
    res_prog = client.put(
        f"/api/books/{book_id}/progress", json={"chapter_idx": 1, "sentence_idx": 1}
    )
    assert res_prog.status_code == 200

    res_detail = client.get(f"/api/books/{book_id}")
    assert res_detail.status_code == 200
    assert res_detail.json()["current_chapter_idx"] == 1
    assert res_detail.json()["current_sentence_idx"] == 1

    # Eliminar libro
    res_del = client.delete(f"/api/books/{book_id}")
    assert res_del.status_code == 200
