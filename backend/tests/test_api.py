"""
Pruebas de la API y del servidor empaquetado de Letha con TestClient.
"""

import io
import json
from fastapi.testclient import TestClient
import pymupdf

from letha import api, config, database
from letha.app import build_app


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


def create_blank_pdf() -> bytes:
    doc = pymupdf.open()
    doc.new_page()
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


def test_health():
    client = TestClient(api.app)
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "app": "letha"}


def test_build_app_initializes_fresh_db_and_enforces_token(tmp_path):
    """
    Verifica que en una instalación limpia (base de datos inexistente), build_app()
    crea las tablas automáticamente y exige el token de sesión en /api/*.
    """
    assert not config.DB_PATH.exists()

    token = "secreto-prueba-123"
    web_dir = tmp_path / "web"
    web_dir.mkdir(exist_ok=True)
    (web_dir / "index.html").write_text("<html><head></head><body>Letha</body></html>", encoding="utf-8")

    packaged_app = build_app(token=token, web_dir=web_dir)
    assert config.DB_PATH.exists()

    client = TestClient(packaged_app, base_url="http://127.0.0.1")

    # /api/health sigue público para el chequeo de instancia y KeepAlive
    res_health = client.get("/api/health")
    assert res_health.status_code == 200

    # Sin token ni cookie debe ser rechazado con 401
    res_unauth = client.get("/api/books")
    assert res_unauth.status_code == 401

    # Con cabecera X-Letha-Token funciona y devuelve lista vacía en DB recién creada
    res_books = client.get("/api/books", headers={"X-Letha-Token": token})
    assert res_books.status_code == 200
    assert res_books.json() == []

    # Al cargar el HTML principal (/), se establece la cookie HttpOnly SameSite=Strict
    # que autoriza recursos multimedia (<img>, <audio>) sin exponer ?token= en la URL
    res_home = client.get("/")
    assert res_home.status_code == 200
    assert "letha_token" in res_home.cookies
    res_cookie_auth = client.get("/api/books")
    assert res_cookie_auth.status_code == 200


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


def test_rejects_scanned_pdf_without_text():
    """Verifica que un PDF sin texto extraíble se rechace con 400 y limpie archivos."""
    database.init_db()
    client = TestClient(api.app)
    blank_bytes = create_blank_pdf()

    files = {"file": ("escaneado.pdf", io.BytesIO(blank_bytes), "application/pdf")}
    res = client.post("/api/books/upload", files=files)
    assert res.status_code == 400
    assert "texto extraíble" in res.json()["detail"]
    assert list(config.BOOKS_DIR.glob("*.pdf")) == []
    assert list(config.COVERS_DIR.glob("*.png")) == []


def test_rejects_invalid_voice_name():
    """Verifica que nombres de voz con caracteres de ruta sean rechazados."""
    database.init_db()
    client = TestClient(api.app)

    res = client.get("/api/voices/preview?voice=../../etc/passwd")
    assert res.status_code == 400


def test_upload_read_voice_switch_and_legacy_audio_cleanup():
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

    # Simular un audio cacheado a 1.00x para Dalia y comprobar cambio de voz
    dalia_audio = config.AUDIO_DIR / f"{book_id}_c0_es-MX-DaliaNeural_1.00.mp3"
    dalia_align = config.AUDIO_DIR / f"{book_id}_c0_es-MX-DaliaNeural_1.00.json"
    dalia_audio.write_bytes(b"fake-mp3")
    dalia_align.write_text(
        json.dumps([{"index": 0, "text": "Hola.", "start": 0.0, "end": 1.5}]),
        encoding="utf-8",
    )
    database.update_chapter_audio(
        book_id, 0, str(dalia_audio), str(dalia_align), 1.5, [{"index": 0, "text": "Hola.", "start": 0.0, "end": 1.5}]
    )

    assert client.get(f"/api/books/{book_id}/chapters/0").json()["has_audio"] is True

    # Cambiar a otra voz que aún no tiene audio sintetizado -> has_audio pasa a False
    res_set = client.put(
        f"/api/books/{book_id}/settings", json={"voice": "es-ES-AlvaroNeural"}
    )
    assert res_set.status_code == 200
    assert client.get(f"/api/books/{book_id}/chapters/0").json()["has_audio"] is False

    # Volver a Dalia -> recupera automáticamente el caché 1.00x de Dalia
    client.put(f"/api/books/{book_id}/settings", json={"voice": "es-MX-DaliaNeural"})
    assert client.get(f"/api/books/{book_id}/chapters/0").json()["has_audio"] is True

    # Simular un audio antiguo con velocidad != 1.00 (_1.50.mp3) y verificar que init_db lo limpia
    with database.get_connection() as conn:
        conn.execute(
            "UPDATE chapters SET audio_path = ? WHERE book_id = ? AND idx = 0",
            (str(config.AUDIO_DIR / f"{book_id}_c0_es-MX-DaliaNeural_1.50.mp3"), book_id),
        )
        conn.commit()
    database.init_db()
    assert client.get(f"/api/books/{book_id}/chapters/0").json()["has_audio"] is False

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
