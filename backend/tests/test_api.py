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
    chap0_initial = client.get(f"/api/books/{book_id}/chapters/0").json()
    aligned_mock = [
        {"index": s["index"], "text": s["text"], "start": float(i), "end": float(i + 1)}
        for i, s in enumerate(chap0_initial["sentences"])
    ]

    # Simular un audio cacheado a velocidad base (0.85) para Dalia y comprobar cambio de voz
    dalia_audio = config.AUDIO_DIR / f"{book_id}_c0_es-MX-DaliaNeural_0.85.mp3"
    dalia_align = config.AUDIO_DIR / f"{book_id}_c0_es-MX-DaliaNeural_0.85.json"
    dalia_audio.write_bytes(b"fake-mp3")
    dalia_align.write_text(
        json.dumps(aligned_mock),
        encoding="utf-8",
    )
    database.update_chapter_audio(
        book_id, 0, str(dalia_audio), str(dalia_align), 2.0, aligned_mock
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


def test_progressive_5_part_synthesis(monkeypatch):
    """
    Verifica que la síntesis de una página se divide en 5 partes por oraciones completas:
    las partes aún no cargadas mantienen start=None (tono opaco en la UI) y las cargadas
    tienen marcas de tiempo numéricas.
    """
    from letha.services import tts as tts_service

    database.init_db()
    client = TestClient(api.app)

    doc = pymupdf.open()
    page = doc.new_page()
    five_sentences = (
        "Sentence one for English pronunciation.\n"
        "Sentence two in context.\n"
        "Sentence three continues reading.\n"
        "Sentence four builds fluency.\n"
        "Sentence five completes the page."
    )
    page.insert_text((50, 120), five_sentences)
    pdf_bytes = doc.tobytes()
    doc.close()

    res = client.post(
        "/api/books/upload",
        files={"file": ("english_book.pdf", io.BytesIO(pdf_bytes), "application/pdf")},
        data={"voice": "en-US-AndrewNeural"},
    )
    assert res.status_code == 200
    book_id = res.json()["id"]

    async def fake_synthesize_group(sentence_texts, voice="en-US-AndrewNeural", speed=1.0):
        # 6000 bytes = 1.0s exacto por oración
        n = len(sentence_texts)
        audio = b"\x00" * (6000 * n)
        timings = [(float(i), float(i + 1)) for i in range(n)]
        return audio, float(n), timings

    monkeypatch.setattr(tts_service, "synthesize_sentence_group", fake_synthesize_group)

    # Solicitar parte 0 (1 de 5) — p.ej. precargada al terminar la página anterior
    r0 = client.post(
        f"/api/books/{book_id}/chapters/0/synthesize?voice=en-US-AndrewNeural&part=0&total_parts=5"
    )
    assert r0.status_code == 200
    d0 = r0.json()
    assert d0["part"] == 1
    assert d0["total_parts"] == 5
    assert d0["is_complete"] is False
    # La primera oración ya tiene timestamp; las siguientes siguen en None (opacas)
    assert isinstance(d0["sentences"][0]["start"], (int, float))
    assert d0["sentences"][4]["start"] is None

    # Al abrir la página, GET /chapters/0 reporta loaded_parts=1 con el fragmento 1 ya listo
    chap_after_preload = client.get(
        f"/api/books/{book_id}/chapters/0?voice=en-US-AndrewNeural"
    ).json()
    assert chap_after_preload["loaded_parts"] == 1
    assert chap_after_preload["has_audio"] is False
    assert isinstance(chap_after_preload["sentences"][0]["start"], (int, float))
    assert chap_after_preload["sentences"][4]["start"] is None

    # Solicitar partes 1..4 hasta completar 5 de 5 (empezando desde la segunda solicitud)
    for p in range(1, 5):
        rp = client.post(
            f"/api/books/{book_id}/chapters/0/synthesize?voice=en-US-AndrewNeural&part={p}&total_parts=5"
        )
        assert rp.status_code == 200
        dp = rp.json()
        assert dp["part"] == p + 1

    assert dp["is_complete"] is True
    assert all(isinstance(s["start"], (int, float)) for s in dp["sentences"])


def test_incomplete_sentence_carried_over_to_next_page():
    """
    Verifica que si una página termina con una oración incompleta (como 'It was'),
    la página actual termina en su última oración completa y 'It was' pasa al inicio
    de la página siguiente para formar 'It was a place that she would like.'.
    """
    database.init_db()
    client = TestClient(api.app)

    doc = pymupdf.open()
    page1 = doc.new_page()
    page1.insert_text(
        (50, 120),
        '"I hope she\'s rich. If she\'s traveling in Africa, she\'s OK."\n'
        '"She\'s probably not in Africa," I said.\n'
        "But I could imagine her there. It was",
    )
    page2 = doc.new_page()
    page2.insert_text(
        (50, 120),
        "a place that she would like.\nShe always dreamed of traveling far away.",
    )
    pdf_bytes = doc.tobytes()
    doc.close()

    res = client.post(
        "/api/books/upload",
        files={"file": ("breakfast.pdf", io.BytesIO(pdf_bytes), "application/pdf")},
        data={"voice": "en-US-AndrewNeural"},
    )
    assert res.status_code == 200
    book_id = res.json()["id"]

    chap0 = client.get(f"/api/books/{book_id}/chapters/0").json()
    chap1 = client.get(f"/api/books/{book_id}/chapters/1").json()

    chap0_sentences = [s["text"] for s in chap0["sentences"]]
    chap1_sentences = [s["text"] for s in chap1["sentences"]]

    # Página 1 termina en la última oración completa y no incluye "It was"
    assert chap0_sentences[-1] == "But I could imagine her there."
    assert not any(s == "It was" for s in chap0_sentences)

    # Página 2 comienza con la oración completa unida ("It was a place that she would like.")
    assert chap1_sentences[0] == "It was a place that she would like."


def test_edge_tts_default_rate_is_85_percent():
    """Verifica que la velocidad base nativa de edge-tts sea 85% (-15%) por defecto y sea configurable."""
    from letha.services import tts as tts_service

    database.init_db()
    client = TestClient(api.app)

    res_get = client.get("/api/settings")
    assert res_get.status_code == 200
    assert res_get.json()["edge_base_speed"] == 0.85
    assert res_get.json()["auto_advance_sentence"] is True
    assert tts_service.EDGE_BASE_SPEED == 0.85
    assert tts_service.format_rate(1.0) == "-15%"

    # Cambiar velocidad nativa a 90% (-10%) y modo solo al clickear desde el endpoint de configuración
    res_put = client.put(
        "/api/settings",
        json={"edge_base_speed": 0.90, "auto_advance_sentence": False},
    )
    assert res_put.status_code == 200
    assert res_put.json()["edge_base_speed"] == 0.90
    assert res_put.json()["auto_advance_sentence"] is False
    assert tts_service.format_rate(1.0) == "-10%"
    assert tts_service.AUDIO_CACHE_TAG == "0.90"

    # Restaurar al 85% y lectura en automático por defecto
    client.put(
        "/api/settings",
        json={"edge_base_speed": 0.85, "auto_advance_sentence": True},
    )
    assert tts_service.format_rate(1.0) == "-15%"


