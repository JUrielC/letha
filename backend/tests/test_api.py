"""
Pruebas de la API de Letha con TestClient de FastAPI.
"""

import io
from fastapi.testclient import TestClient
import pymupdf
import pytest

from letha.api import app
from letha import database


@pytest.fixture(autouse=True)
def setup_db():
    database.init_db()


def create_sample_pdf() -> bytes:
    doc = pymupdf.open()
    page1 = doc.new_page()
    page1.insert_text((50, 50), "Capítulo 1: El Inicio\nEsta es la primera oración de prueba. Y aquí viene la segunda oración.")
    
    page2 = doc.new_page()
    page2.insert_text((50, 50), "Capítulo 2: El Desarrollo\nContinuamos con la lectura interactiva. Letha sincroniza cada frase perfectamente.")
    
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


def test_health():
    client = TestClient(app)
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "app": "letha"}


def test_upload_and_read_book():
    client = TestClient(app)
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

    # Actualizar progreso
    res_prog = client.put(f"/api/books/{book_id}/progress", json={"chapter_idx": 0, "sentence_idx": 1})
    assert res_prog.status_code == 200

    # Eliminar libro
    res_del = client.delete(f"/api/books/{book_id}")
    assert res_del.status_code == 200
