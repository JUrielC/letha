"""
Pruebas de la API y del servidor empaquetado de Letha con TestClient.
"""

import asyncio
import hashlib
import io
import json
import os
import platform
import shlex
import sqlite3
import subprocess
import sys
import time
from pathlib import Path
from fastapi.testclient import TestClient
import pymupdf
import pytest

from letha import api, config, database
from letha.app import build_app


ENGLISH_TEXT = (
    "The morning Julian arrived in Seattle, the sky was a strange color, somewhere between gray and gold. "
    "He had traveled for almost twelve hours, carrying an old backpack and three books he had no intention "
    "of returning. Who would be waiting for him at the station? No one, of course: his aunt had written "
    "that she would be busy until half past six. He had read the letter twice, though he still was not "
    "sure where she lived, and there was nothing to do but walk."
)


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


def create_structured_pdf() -> bytes:
    """Página con título, subtítulo, párrafos, una oración partida entre bloques y un índice."""
    doc = pymupdf.open()
    page1 = doc.new_page()
    page1.insert_text((72, 90), "CHAPTER ONE")
    page1.insert_text((72, 125), "What Happened to Holly Golightly?")
    page1.insert_text(
        (72, 160), "I sometimes visit places where I lived in the past. I like to see\nthem again."
    )
    page1.insert_text((72, 220), "I didn't write about Holly in those days. Holly was another")
    page1.insert_text((72, 260), "tenant in the old brown stone house, in the apartment below mine.")
    page1.insert_text((72, 320), "Contents\nChapter 1\nChapter 2")
    page1.insert_text((72, 700), "CHAPTER TWO")
    page2 = doc.new_page()
    page2.insert_text((72, 90), "It was a quiet morning. Nobody came to the bar.")
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


STRUCTURED_PAGE_1 = [
    ("CHAPTER ONE", True),
    ("What Happened to Holly Golightly?", True),
    ("I sometimes visit places where I lived in the past.", True),
    ("I like to see them again.", False),
    ("I didn't write about Holly in those days.", True),
    ("Holly was another tenant in the old brown stone house, in the apartment below mine.", False),
    ("Contents", True),
    ("Chapter 1", True),
    ("Chapter 2", True),
    ("CHAPTER TWO", True),
]


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


def test_ui_preferences_are_saved_in_the_database():
    database.init_db()
    client = TestClient(api.app)

    defaults = client.get("/api/settings").json()
    assert (defaults["theme"], defaults["font_size"], defaults["show_translation"], defaults["last_book_id"]) == (
        "light",
        "base",
        True,
        None,
    )

    res = client.put(
        "/api/settings",
        json={"theme": "dark", "font_size": "xl", "show_translation": False, "last_book_id": "3001c887e8c1"},
    )
    assert res.status_code == 200
    saved = client.get("/api/settings").json()
    assert (saved["theme"], saved["font_size"], saved["show_translation"], saved["last_book_id"]) == (
        "dark",
        "xl",
        False,
        "3001c887e8c1",
    )
    assert database.get_setting("ui_theme") == "dark"

    assert client.put("/api/settings", json={"theme": "neon"}).status_code == 422
    assert client.put("/api/settings", json={"last_book_id": "</script>"}).status_code == 422


def test_packaged_pages_carry_the_saved_preferences(tmp_path):
    from concurrent.futures import Future

    from letha.app import with_loading_screen

    web_dir = tmp_path / "web"
    web_dir.mkdir()
    (web_dir / "index.html").write_text("<html><head></head><body>Letha</body></html>", encoding="utf-8")
    packaged_app = build_app(token="secreto", web_dir=web_dir)
    database.set_ui_preferences(theme="sepia", font_size="lg")
    database.set_native_language("fr")

    def injected(html: str) -> dict:
        return json.loads(html.split("window.__LETHA__ = ", 1)[1].split(";</script>", 1)[0])

    page = TestClient(packaged_app, base_url="http://127.0.0.1").get("/").text
    assert injected(page)["settings"]["theme"] == "sepia"
    assert injected(page)["settings"]["font_size"] == "lg"
    assert injected(page)["settings"]["native_language"] == "fr"

    loading = TestClient(with_loading_screen(Future()), base_url="http://127.0.0.1").get("/").text
    assert injected(loading)["settings"] == {"theme": "sepia", "native_language": "fr"}


def test_each_launch_listens_on_a_free_port_chosen_by_the_system():
    import socket

    from letha.app import _bind

    first, second = _bind(), _bind()
    try:
        assert first.getsockname()[0] == "127.0.0.1"
        assert first.getsockname()[1] != second.getsockname()[1]
        socket.create_connection(first.getsockname(), timeout=2).close()
    finally:
        first.close()
        second.close()


def test_open_window_is_brought_to_front_only_with_the_token(monkeypatch, tmp_path):
    from letha import app as letha_app

    calls = []

    class FakeWindow:
        def restore(self):
            calls.append("restore")

        def show(self):
            calls.append("show")

    client = TestClient(build_app(token="secreto", web_dir=tmp_path / "web"), base_url="http://127.0.0.1")
    assert client.post("/api/window/show", headers={"X-Letha-Token": "secreto"}).status_code == 404

    monkeypatch.setattr(letha_app, "_window", FakeWindow())
    assert client.post("/api/window/show").status_code == 404
    assert client.post("/api/window/show", headers={"X-Letha-Token": "secreto"}).status_code == 204
    assert calls == ["restore", "show"]


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
    assert res.json()["detail"]["code"] == "pdf_without_text"
    assert list(config.BOOKS_DIR.glob("*.pdf")) == []
    assert list(config.COVERS_DIR.glob("*.png")) == []


def test_rejects_invalid_voice_name():
    """Verifica que nombres de voz con caracteres de ruta sean rechazados."""
    database.init_db()
    client = TestClient(api.app)

    res = client.get("/api/voices/preview?voice=../../etc/passwd")
    assert res.status_code == 400


def test_voices_limited_to_supported_languages(monkeypatch):
    """
    Verifica que solo se listen voces de español, inglés, francés, italiano y portugués,
    en ese orden y con la variante principal de cada idioma primero.
    """
    from letha.services import tts as tts_service

    async def fake_list_voices():
        return [
            {"ShortName": short_name, "Locale": short_name.rsplit("-", 1)[0], "Gender": "Female"}
            for short_name in (
                "pt-BR-FranciscaNeural",
                "fr-CA-SylvieNeural",
                "en-GB-SoniaNeural",
                "de-DE-KatjaNeural",
                "it-IT-ElsaNeural",
                "en-AU-NatashaNeural",
                "es-ES-ElviraNeural",
                "hi-IN-SwaraNeural",
                "fr-FR-DeniseNeural",
                "en-US-AvaNeural",
                "ja-JP-NanamiNeural",
                "es-MX-DaliaNeural",
            )
        ]

    monkeypatch.setattr(tts_service.edge_tts, "list_voices", fake_list_voices)
    database.init_db()
    client = TestClient(api.app)

    res = client.get("/api/voices")
    assert res.status_code == 200
    voices = res.json()
    assert [v["short_name"] for v in voices] == [
        "es-MX-DaliaNeural",
        "es-ES-ElviraNeural",
        "en-US-AvaNeural",
        "en-AU-NatashaNeural",
        "en-GB-SoniaNeural",
        "fr-FR-DeniseNeural",
        "fr-CA-SylvieNeural",
        "it-IT-ElsaNeural",
        "pt-BR-FranciscaNeural",
    ]
    sylvie = next(v for v in voices if v["short_name"] == "fr-CA-SylvieNeural")
    assert sylvie["name"] == "Sylvie"
    assert sylvie["locale"] == "fr-CA"


def test_voice_preview_speaks_the_voice_language(monkeypatch):
    """Verifica que la muestra de voz use una frase en el idioma de la voz."""
    from letha.services import tts as tts_service

    spoken = {}

    async def fake_synthesize(text, voice, speed, output_audio_path, output_alignment_path):
        spoken[voice] = text
        output_audio_path.write_bytes(b"mp3")
        return 0.0, []

    monkeypatch.setattr(tts_service, "synthesize_text_to_audio", fake_synthesize)
    client = TestClient(api.app)

    for voice in ("fr-FR-DeniseNeural", "it-IT-ElsaNeural", "pt-BR-FranciscaNeural", "en-US-AvaNeural", "es-MX-DaliaNeural"):
        assert client.get(f"/api/voices/preview?voice={voice}").status_code == 200

    assert spoken["fr-FR-DeniseNeural"].startswith("Bonjour, je suis Denise.")
    assert spoken["it-IT-ElsaNeural"].startswith("Ciao, sono Elsa.")
    assert spoken["pt-BR-FranciscaNeural"].startswith("Olá, eu sou Francisca.")
    assert spoken["en-US-AvaNeural"].startswith("Hello, I am Ava.")
    assert spoken["es-MX-DaliaNeural"].startswith("Hola, soy Dalia.")


def test_book_language_is_saved_and_restricts_voice_changes():
    """Verifica que el idioma elegido al importar se guarde y limite el cambio de voz."""
    database.init_db()
    client = TestClient(api.app)

    def upload(**form):
        files = {"file": ("libro.pdf", io.BytesIO(create_sample_pdf()), "application/pdf")}
        return client.post("/api/books/upload", files=files, data=form)

    res = upload(voice="en-US-AvaNeural", language="en")
    assert res.status_code == 200
    book_id = res.json()["id"]
    assert res.json()["language"] == "en"
    assert client.get("/api/books").json()[0]["language"] == "en"

    assert upload(voice="fr-FR-DeniseNeural").json()["language"] == "fr"
    assert upload(voice="es-MX-DaliaNeural", language="en").status_code == 400
    assert upload(voice="de-DE-KatjaNeural", language="de").status_code == 400
    assert len(list(config.BOOKS_DIR.glob("*.pdf"))) == 2

    res_other = client.put(f"/api/books/{book_id}/settings", json={"voice": "es-MX-DaliaNeural"})
    assert res_other.status_code == 400
    res_same = client.put(f"/api/books/{book_id}/settings", json={"voice": "en-GB-SoniaNeural"})
    assert res_same.status_code == 200
    assert client.get(f"/api/books/{book_id}").json()["voice"] == "en-GB-SoniaNeural"


def test_existing_books_get_language_from_their_text():
    """
    Verifica que los libros de una base de datos anterior obtengan el idioma de su texto
    (aunque su voz sea de otro idioma) y, si no hay texto, de su voz.
    """
    insert_book_sql = (
        "INSERT INTO books (id, title, author, file_path, total_pages, total_chapters, created_at, last_read_at, voice) "
        "VALUES (?, 'Libro', 'Autor', 'libro.pdf', 1, 1, 0, 0, ?)"
    )
    conn = sqlite3.connect(config.DB_PATH)
    conn.execute(
        """
        CREATE TABLE books (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL,
            file_path TEXT NOT NULL, cover_path TEXT, total_pages INTEGER NOT NULL,
            total_chapters INTEGER NOT NULL, created_at INTEGER NOT NULL,
            last_read_at INTEGER NOT NULL, current_chapter_idx INTEGER DEFAULT 0,
            current_sentence_idx INTEGER DEFAULT 0, voice TEXT NOT NULL, speed REAL DEFAULT 1.0
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE chapters (
            id TEXT PRIMARY KEY, book_id TEXT NOT NULL, idx INTEGER NOT NULL, title TEXT NOT NULL,
            start_page INTEGER NOT NULL, end_page INTEGER NOT NULL, text_content TEXT NOT NULL,
            sentences_json TEXT NOT NULL, audio_path TEXT, alignment_path TEXT, duration_seconds REAL
        )
        """
    )
    conn.execute(insert_book_sql, ("ingles_con_voz_es", "es-US-PalomaNeural"))
    conn.execute(
        "INSERT INTO chapters VALUES ('ingles_con_voz_es_c0', 'ingles_con_voz_es', 0, 'Uno', 1, 1, ?, '[]', NULL, NULL, NULL)",
        (ENGLISH_TEXT,),
    )
    conn.execute(insert_book_sql, ("sin_texto", "it-IT-ElsaNeural"))
    conn.commit()
    conn.close()

    database.init_db()
    assert database.get_book("ingles_con_voz_es").language == "en"
    assert database.get_book("sin_texto").language == "it"
    assert {b.language for b in database.list_books()} == {"en", "it"}

    # El lector reenvía la voz actual al cambiar la velocidad aunque sea de otro idioma
    client = TestClient(api.app)
    res_speed = client.put(
        "/api/books/ingles_con_voz_es/settings",
        json={"voice": "es-US-PalomaNeural", "speed": 1.25},
    )
    assert res_speed.status_code == 200
    assert database.get_book("ingles_con_voz_es").speed == 1.25
    res_other = client.put(
        "/api/books/ingles_con_voz_es/settings", json={"voice": "es-MX-DaliaNeural"}
    )
    assert res_other.status_code == 400

    # Un libro que una versión anterior guarde sin idioma también se completa al reiniciar
    with database.get_connection() as conn:
        conn.execute(insert_book_sql, ("version_anterior", "fr-FR-DeniseNeural"))
    database.init_db()
    assert database.get_book("version_anterior").language == "fr"
    assert database.get_book("ingles_con_voz_es").language == "en"


def test_detect_language():
    from letha.services import pdf as pdf_service

    assert pdf_service.detect_language(ENGLISH_TEXT) == "en"
    assert pdf_service.detect_language(
        "Rosario vivía en una casa angosta, pintada de azul, al final de una calle empedrada. "
        "Tenía un patio con macetas de barro, un limonero torcido y una mesa de madera donde, según ella, "
        "se resolvían todos los problemas de la familia. Julián llegó poco después de las siete y ya era "
        "tarde. Después lo abrazó sin decir nada, pero él no entendió del todo hasta que ella le dijo que "
        "los libros, como las plantas, no se empiezan: se siembran."
    ) == "es"
    assert pdf_service.detect_language(
        "Le matin où Julien est arrivé à Lyon, le ciel avait une couleur étrange, entre le gris et l'or. "
        "Il avait voyagé pendant presque douze heures, avec un vieux sac à dos et trois livres qu'il "
        "n'avait aucune intention de rendre. Personne ne l'attendait à la gare : sa tante était occupée "
        "et elle avait écrit que tout irait bien. Nous sommes dans une ville où les rues sont étroites."
    ) == "fr"
    assert pdf_service.detect_language(
        "La mattina in cui Giulio arrivò a Torino, il cielo aveva un colore strano, tra il grigio e l'oro. "
        "Aveva viaggiato per quasi dodici ore, con uno zaino vecchio e tre libri che non pensava di "
        "restituire. Nessuno lo aspettava alla stazione: la zia gli aveva scritto che sarebbe stata "
        "molto occupata. Questo era il suo primo giorno in città e anche lei era stanca, però felice."
    ) == "it"
    assert pdf_service.detect_language(
        "Na manhã em que Júlio chegou a Lisboa, o céu tinha uma cor estranha, entre o cinza e o dourado. "
        "Ele tinha viajado quase doze horas, com uma mochila velha e três livros que não pensava devolver. "
        "Ninguém o esperava na estação: a tia já tinha escrito que estaria muito ocupada até as seis. "
        "Então ele andou pela cidade, comprou um café e pensou que isso era o começo de algo novo."
    ) == "pt"
    assert pdf_service.detect_language("Hola.") is None


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

    # Simular un audio cacheado a velocidad base (0.90) para Dalia y comprobar cambio de voz
    dalia_audio = config.AUDIO_DIR / f"{book_id}_c0_es-MX-DaliaNeural_0.90.mp3"
    dalia_align = config.AUDIO_DIR / f"{book_id}_c0_es-MX-DaliaNeural_0.90.json"
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


def test_titles_and_paragraphs_are_kept_separate(monkeypatch):
    """
    Verifica que los títulos sin punto y cada párrafo queden como oraciones separadas,
    que una oración partida entre bloques se una y que un título al final de la página
    no se pase a la siguiente.
    """
    from letha.services import tts as tts_service

    database.init_db()
    client = TestClient(api.app)
    res = client.post(
        "/api/books/upload",
        files={"file": ("holly.pdf", io.BytesIO(create_structured_pdf()), "application/pdf")},
        data={"voice": "en-US-AvaNeural", "language": "en"},
    )
    assert res.status_code == 200
    book_id = res.json()["id"]

    chap0 = client.get(f"/api/books/{book_id}/chapters/0").json()
    assert [(s["text"], s["paragraph_start"]) for s in chap0["sentences"]] == STRUCTURED_PAGE_1
    chap1 = client.get(f"/api/books/{book_id}/chapters/1").json()
    assert chap1["sentences"][0]["text"] == "It was a quiet morning."

    async def fake_synthesize_group(sentence_texts, voice="en-US-AvaNeural", speed=1.0):
        n = len(sentence_texts)
        return b"\x00" * (6000 * n), float(n), [(float(i), float(i + 1)) for i in range(n)]

    monkeypatch.setattr(tts_service, "synthesize_sentence_group", fake_synthesize_group)
    synth = client.post(f"/api/books/{book_id}/chapters/0/synthesize?voice=en-US-AvaNeural").json()
    assert [(s["text"], s["paragraph_start"]) for s in synth["sentences"]] == STRUCTURED_PAGE_1


def test_titles_get_a_pause_when_spoken(monkeypatch):
    """Verifica que a un título sin puntuación se le añada un punto solo en el texto enviado a la voz."""
    from letha.services import tts as tts_service

    sent = {}

    async def fake_chunk(chunk_text, voice, rate_str, semaphore, boundary="SentenceBoundary"):
        sent["text"] = chunk_text
        return bytearray(b"\x00" * 6000), []

    monkeypatch.setattr(tts_service, "_synthesize_single_chunk", fake_chunk)
    asyncio.run(
        tts_service.synthesize_sentence_group(
            ["CHAPTER ONE", "What Happened to Holly Golightly?", '"It was late," he said.']
        )
    )
    assert sent["text"] == 'CHAPTER ONE. What Happened to Holly Golightly? "It was late," he said.'


def test_reassembling_keeps_paragraphs():
    """Verifica que volver a rearmar los capítulos ya extraídos no cambie su texto."""
    from letha.services import pdf as pdf_service

    doc = pymupdf.open(stream=create_structured_pdf(), filetype="pdf")
    chapters = pdf_service.extract_chapters(doc)
    doc.close()
    again = pdf_service.reassemble_chapters_data([dict(c) for c in chapters])
    assert [c["text_content"] for c in again] == [c["text_content"] for c in chapters]
    assert "\n\n" in chapters[0]["text_content"]


def test_a_link_without_period_does_not_swallow_the_next_text():
    """Verifica que una línea que termina en un enlace no se una al texto que sigue, en la misma página ni en la siguiente."""
    from letha.services import pdf as pdf_service

    link = "Link: https://deepdumps.com/papers/anthropic/claude-certified-architect"
    question = (
        "After the web search agent and document analysis agent complete their tasks, "
        "the coordinator invokes the synthesis agent."
    )
    chapters = pdf_service.reassemble_chapters_data(
        [
            {"title": "", "start_page": 3, "end_page": 3, "text_content": f"Total: 120 Questions\n\n{link}"},
            {"title": "", "start_page": 4, "end_page": 4, "text_content": question},
        ]
    )
    assert [s["text"] for s in chapters[0]["sentences"]] == ["Total: 120 Questions", link]
    assert [s["text"] for s in chapters[1]["sentences"]] == [question]

    assert pdf_service._join_fragments(link, question) == f"{link}\n\n{question}"
    assert pdf_service._join_fragments("See www.letha.app", "for more details.") == "See www.letha.app for more details."


def create_exam_pdf() -> bytes:
    """
    Dos páginas de un examen como el de DeepDumps: el encabezado 'Question: N' con el nombre del sitio
    se guarda al final del flujo de la página, en el margen superior o a media página.
    """
    doc = pymupdf.open()
    for number, header_y in ((1, 35), (2, 300)):
        page = doc.new_page()
        if number == 2:
            page.insert_text((50, 100), "The previous answer explains the coordinator role.")
        page.insert_text((50, header_y + 30), "after the coordinator invokes the synthesis agent, nothing happens.")
        page.insert_text((50, header_y + 50), "A. Retry the synthesis agent")
        page.insert_text((50, header_y + 68), "B. Pass the previous outputs in the prompt")
        page.insert_text((50, header_y + 110), "Answer: B")
        page.insert_text((50, 20), "Practice Exam")
        page.insert_text((290, 830), str(number))
        page.insert_text((50, header_y), f"Question: {number}\nDeep Dumps")
    data = doc.tobytes()
    doc.close()
    return data


def test_numbered_labels_keep_their_place_and_drop_the_site_name():
    from letha.services import pdf as pdf_service

    doc = pymupdf.open(stream=create_exam_pdf(), filetype="pdf")
    chapters = pdf_service.extract_chapters(doc)
    doc.close()

    question = [
        "after the coordinator invokes the synthesis agent, nothing happens.",
        "A. Retry the synthesis agent",
        "B. Pass the previous outputs in the prompt",
        "Answer: B",
    ]
    assert [s["text"] for s in chapters[0]["sentences"]] == ["Question: 1", *question]
    assert [s["text"] for s in chapters[1]["sentences"]] == [
        "The previous answer explains the coordinator role.",
        "Question: 2",
        *question,
    ]


def test_a_page_with_two_columns_keeps_the_order_of_the_pdf():
    from letha.services import pdf as pdf_service

    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((50, 120), "The left column starts the story\nand runs down the page\nfor several lines.")
    page.insert_text((320, 100), "The right column continues it\na little higher up.")
    assert pdf_service.clean_page_text(page) == (
        "The left column starts the story and runs down the page for several lines.\n\n"
        "The right column continues it a little higher up."
    )
    doc.close()


def test_a_page_ending_without_period_is_not_joined_to_a_label_on_the_next_page():
    from letha.services import pdf as pdf_service

    option = "D. Configure the web search agent to only return results from the past 6 months"
    chapters = pdf_service.reassemble_chapters_data(
        [
            {"title": "", "start_page": 4, "end_page": 4, "text_content": f"Which option is best?\n\n{option}"},
            {"title": "", "start_page": 5, "end_page": 5, "text_content": "Answer: A\n\nExplanation:"},
        ]
    )
    assert [s["text"] for s in chapters[0]["sentences"]] == ["Which option is best?", option]
    assert [s["text"] for s in chapters[1]["sentences"]] == ["Answer: A", "Explanation:"]
    assert pdf_service.split_sentences("B. Instruct the agent. Then stop.") == ["B. Instruct the agent.", "Then stop."]


def test_existing_books_get_paragraphs_from_their_pdf():
    """
    Verifica que un libro guardado con el texto aplanado se vuelva a extraer del PDF una sola
    vez, borrando solo el audio de las páginas cuyas oraciones cambiaron.
    """
    database.init_db()
    client = TestClient(api.app)
    res = client.post(
        "/api/books/upload",
        files={"file": ("holly.pdf", io.BytesIO(create_structured_pdf()), "application/pdf")},
        data={"voice": "en-US-AvaNeural", "language": "en"},
    )
    book_id = res.json()["id"]

    with database.get_connection() as conn:
        rows = conn.execute(
            "SELECT id, text_content FROM chapters WHERE book_id = ? ORDER BY idx", (book_id,)
        ).fetchall()
        for row in rows:
            conn.execute(
                "UPDATE chapters SET text_content = ? WHERE id = ?",
                (row["text_content"].replace("\n\n", " "), row["id"]),
            )
        conn.execute("DELETE FROM app_settings WHERE key = 'pdf_extraction_version'")

    stale_audio = config.AUDIO_DIR / f"{book_id}_c0_en-US-AvaNeural_0.90.mp3"
    kept_audio = config.AUDIO_DIR / f"{book_id}_c1_en-US-AvaNeural_0.90.mp3"
    stale_audio.write_bytes(b"mp3")
    kept_audio.write_bytes(b"mp3")
    assert client.get(f"/api/books/{book_id}/chapters/0").json()["sentences"][0]["text"] == (
        "CHAPTER ONE What Happened to Holly Golightly?"
    )

    database.init_db()
    chap0 = client.get(f"/api/books/{book_id}/chapters/0").json()
    assert [(s["text"], s["paragraph_start"]) for s in chap0["sentences"]] == STRUCTURED_PAGE_1
    assert not stale_audio.exists()
    assert kept_audio.exists()

    # La marca evita que se vuelva a ejecutar en cada arranque
    with database.get_connection() as conn:
        conn.execute(
            "UPDATE chapters SET text_content = 'Texto editado.' WHERE book_id = ? AND idx = 1",
            (book_id,),
        )
    database.init_db()
    assert client.get(f"/api/books/{book_id}/chapters/1").json()["text_content"] == "Texto editado."


def fake_release(version="9.9.9", assets=None):
    return {
        "version": version,
        "notes": ["Nueva función"],
        "url": f"https://github.com/JUrielC/letha/releases/tag/v{version}",
        "published_at": "2026-10-23T00:00:00Z",
        "assets": assets or {},
    }


def test_existing_page_titles_keep_only_their_section():
    """Verifica que los títulos guardados como 'Página N' o 'Pág. N — Sección' queden solo con la sección."""
    database.init_db()
    with database.get_connection() as conn:
        conn.execute(
            "INSERT INTO books (id, title, author, file_path, total_pages, total_chapters, created_at, last_read_at, voice, language) "
            "VALUES ('libro', 'Libro', 'Autor', 'libro.pdf', 3, 3, 0, 0, 'es-MX-DaliaNeural', 'es')"
        )
        for idx, title in enumerate(["Página 1", "Pág. 2 — Capítulo 1 — El inicio", "Página 3 bis"]):
            conn.execute(
                "INSERT INTO chapters (id, book_id, idx, title, start_page, end_page, text_content, sentences_json) "
                "VALUES (?, 'libro', ?, ?, ?, ?, 'Texto.', '[]')",
                (f"libro_c{idx}", idx, title, idx + 1, idx + 1),
            )
        conn.execute("DELETE FROM app_settings WHERE key = 'page_titles_localized'")
        conn.commit()

    database.init_db()
    database.init_db()
    titles = [c.title for c in database.get_book("libro").chapters]
    assert titles == ["", "Capítulo 1 — El inicio", "Página 3 bis"]


def test_update_check_reports_new_version_and_caches_it(monkeypatch):
    from letha import __version__
    from letha.services import updates as updates_service

    calls = []
    monkeypatch.setattr(updates_service, "fetch_latest_release", lambda: calls.append(1) or fake_release())
    database.init_db()
    client = TestClient(api.app)

    info = client.get("/api/updates").json()
    assert info["current_version"] == __version__
    assert info["latest_version"] == "9.9.9"
    assert info["update_available"] is True
    assert info["notes"] == ["Nueva función"]
    assert info["can_self_update"] is False

    client.get("/api/updates")
    assert len(calls) == 1
    client.get("/api/updates?force=true")
    assert len(calls) == 2

    # Una búsqueda de la apertura anterior no cuenta: al volver a abrir la app se consulta de nuevo
    monkeypatch.setattr(updates_service, "_STARTED_AT", time.time() + 1)
    client.get("/api/updates")
    assert len(calls) == 3


def test_update_check_respects_settings_and_skipped_version(monkeypatch):
    from letha.services import updates as updates_service

    calls = []
    monkeypatch.setattr(updates_service, "fetch_latest_release", lambda: calls.append(1) or fake_release())
    database.init_db()
    client = TestClient(api.app)

    client.put("/api/settings", json={"auto_check_updates": False})
    assert client.get("/api/settings").json()["auto_check_updates"] is False
    assert client.get("/api/updates").json()["update_available"] is False
    assert calls == []

    assert client.get("/api/updates?force=true").json()["update_available"] is True
    client.post("/api/updates/skip", json={"version": "9.9.9"})
    assert client.get("/api/updates?force=true").json()["skipped"] is True


def test_update_check_without_releases_or_connection(monkeypatch):
    from letha.services import updates as updates_service

    database.init_db()
    client = TestClient(api.app)

    monkeypatch.setattr(updates_service, "fetch_latest_release", lambda: None)
    info = client.get("/api/updates?force=true").json()
    assert info["latest_version"] is None
    assert info["update_available"] is False
    assert info["error"] is None

    def offline():
        raise OSError("sin red")

    monkeypatch.setattr(updates_service, "fetch_latest_release", offline)
    assert client.get("/api/updates?force=true").json()["error"] == "check_failed"


def test_manifest_from_release_script_is_installable(monkeypatch, tmp_path):
    """
    Verifica que el latest.json que genera scripts/update_manifest.py en el workflow
    lo lea la app y sirva para descargar y verificar la versión nueva.
    """
    from letha.services import updates as updates_service

    release_dir = tmp_path / "release"
    release_dir.mkdir()
    installer_name = "install.ps1" if sys.platform == "win32" else "install.sh"
    files = [release_dir / "letha-9.9.9-py3-none-any.whl", release_dir / installer_name]
    for f in files:
        f.write_bytes(f"contenido de {f.name}".encode())
    notes = tmp_path / "changes.txt"
    notes.write_text("Primer cambio\n\nSegundo cambio\n", encoding="utf-8")
    manifest = tmp_path / "latest.json"

    script = Path(__file__).resolve().parents[2] / "scripts" / "update_manifest.py"
    subprocess.run(
        [
            sys.executable, str(script),
            "--version", "9.9.9",
            "--base-url", release_dir.as_uri(),
            "--release-url", "https://github.com/JUrielC/letha/releases/tag/v9.9.9",
            "--notes-file", str(notes),
            "--output", str(manifest),
            *map(str, files),
        ],
        check=True,
    )

    monkeypatch.setattr(updates_service, "MANIFEST_URL", manifest.as_uri())
    release = updates_service.fetch_latest_release()
    assert release["version"] == "9.9.9"
    assert release["notes"] == ["Primer cambio", "Segundo cambio"]
    assert set(release["assets"]) == {f.name for f in files}

    launched = []
    monkeypatch.setattr(updates_service, "self_update_unavailable_reason", lambda: None)
    monkeypatch.setattr(updates_service, "_launch_detached", lambda script, log: launched.append(script))
    monkeypatch.setattr(updates_service, "_schedule_exit", lambda: None)
    database.init_db()
    assert updates_service.start_update() == {"version": "9.9.9"}
    assert len(launched) == 1


def test_invalid_manifest_is_reported_as_check_error(monkeypatch, tmp_path):
    from letha.services import updates as updates_service

    manifest = tmp_path / "latest.json"
    manifest.write_text('{"sin": "versión"}', encoding="utf-8")
    monkeypatch.setattr(updates_service, "MANIFEST_URL", manifest.as_uri())
    database.init_db()
    info = TestClient(api.app).get("/api/updates?force=true").json()
    assert info["update_available"] is False
    assert info["error"]


def test_updated_notice_is_shown_until_acknowledged(monkeypatch):
    from letha import __version__
    from letha.services import updates as updates_service

    monkeypatch.setattr(updates_service, "fetch_latest_release", lambda: fake_release(__version__))
    database.init_db()
    client = TestClient(api.app)

    assert client.get("/api/updates").json()["updated_from"] is None
    database.set_setting("last_seen_version", "0.0.1")
    info = client.get("/api/updates").json()
    assert info["updated_from"] == "0.0.1"
    assert info["update_available"] is False

    client.post("/api/updates/acknowledge")
    assert client.get("/api/updates").json()["updated_from"] is None


def test_install_update_refused_outside_installed_app():
    database.init_db()
    res = TestClient(api.app).post("/api/updates/install")
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "not_installer_copy"


def test_install_update_verifies_downloads_and_launches_updater(monkeypatch, tmp_path):
    from letha.services import updates as updates_service

    installer_name = "install.ps1" if sys.platform == "win32" else "install.sh"
    sources = {"letha-9.9.9-py3-none-any.whl": b"wheel", installer_name: b"installer"}
    assets = {}
    for name, content in sources.items():
        (tmp_path / name).write_bytes(content)
        assets[name] = {"url": (tmp_path / name).as_uri(), "sha256": hashlib.sha256(content).hexdigest()}

    launched, exits = [], []
    monkeypatch.setattr(updates_service, "self_update_unavailable_reason", lambda: None)
    monkeypatch.setattr(updates_service, "fetch_latest_release", lambda: fake_release(assets=assets))
    monkeypatch.setattr(updates_service, "_launch_detached", lambda script, log: launched.append(script))
    monkeypatch.setattr(updates_service, "_schedule_exit", lambda: exits.append(1))
    database.init_db()
    client = TestClient(api.app)

    res = client.post("/api/updates/install")
    assert res.status_code == 200
    assert res.json() == {"version": "9.9.9"}
    downloaded = config.CACHE_DIR / "updates" / "9.9.9"
    assert (downloaded / "letha-9.9.9-py3-none-any.whl").read_bytes() == b"wheel"
    assert str(downloaded / "letha-9.9.9-py3-none-any.whl") in launched[0].read_text()
    assert exits == [1]

    assets[installer_name]["sha256"] = "0" * 64
    res_tampered = client.post("/api/updates/install")
    assert res_tampered.status_code == 409
    assert res_tampered.json()["detail"]["code"] == "checksum_mismatch"
    assert len(launched) == 1


@pytest.mark.skipif(sys.platform == "win32", reason="El actualizador de macOS es un script de shell")
def test_updater_script_waits_for_the_app_and_runs_installer(tmp_path):
    from letha.services import updates as updates_service

    marker = tmp_path / "instalado.txt"
    installer = tmp_path / "install.sh"
    installer.write_text(f'echo "$LETHA_WHEEL" > {shlex.quote(str(marker))}\n')
    wheel = tmp_path / "letha-9.9.9-py3-none-any.whl"
    wheel.write_bytes(b"wheel")
    # Proceso huérfano para que, al terminar, no quede como zombi (kill -0 seguiría respondiendo)
    app_pid = int(subprocess.check_output(["/bin/sh", "-c", "sleep 1.5 >/dev/null 2>&1 & echo $!"]))

    script = updates_service.write_updater_script(tmp_path, wheel, installer, [app_pid])
    started = time.monotonic()
    subprocess.run(["/bin/sh", str(script)], check=True, timeout=30)
    assert time.monotonic() - started >= 1.0
    assert marker.read_text().strip() == str(wheel)


@pytest.mark.skipif(sys.platform == "win32", reason="El actualizador de macOS es un script de shell")
def test_updater_reopens_the_installed_app_when_the_installer_fails(tmp_path):
    from letha.services import updates as updates_service

    installer = tmp_path / "install.sh"
    installer.write_text("exit 1\n")
    fake_bin = tmp_path / "fake-bin"
    fake_bin.mkdir()
    opened = tmp_path / "abierto.txt"
    fake_open = fake_bin / "open"
    fake_open.write_text(f'#!/bin/sh\necho "$*" > {shlex.quote(str(opened))}\n')
    fake_open.chmod(0o755)

    script = updates_service.write_updater_script(tmp_path, tmp_path / "letha.whl", installer, [])
    subprocess.run(["/bin/sh", str(script)], env={"PATH": f"{fake_bin}:/usr/bin:/bin"}, check=True, timeout=30)
    assert opened.read_text().strip() == f"-b {updates_service.MACOS_BUNDLE_ID}"


def test_uninstall_refused_outside_installed_app():
    database.init_db()
    res = TestClient(api.app).post("/api/uninstall", json={})
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "not_installer_copy"


def test_uninstall_launches_uninstaller_and_keeps_library_unless_asked(monkeypatch, tmp_path):
    from letha.services import uninstall as uninstall_service
    from letha.services import updates as updates_service

    launched, exits = [], []
    monkeypatch.setattr(updates_service, "self_update_unavailable_reason", lambda: None)
    monkeypatch.setattr(
        updates_service, "_launch_detached", lambda script, log: launched.append(script.read_text(encoding="utf-8"))
    )
    monkeypatch.setattr(updates_service, "_schedule_exit", lambda: exits.append(1))
    monkeypatch.setattr(uninstall_service.tempfile, "mkdtemp", lambda prefix: str(tmp_path))
    monkeypatch.setattr(uninstall_service, "_macos_app_bundle", lambda: None)
    monkeypatch.setattr(uninstall_service, "_windows_shortcuts", lambda: [])
    database.init_db()
    client = TestClient(api.app)

    assert client.post("/api/uninstall", json={}).status_code == 200
    assert client.post("/api/uninstall", json={"delete_library": True}).status_code == 200

    kept, deleted = launched
    assert "tool uninstall letha" in kept
    assert str(config.CACHE_DIR) in kept
    assert str(config.DATA_DIR) not in kept
    assert str(config.DATA_DIR) in deleted
    assert exits == [1, 1]


@pytest.mark.skipif(sys.platform != "win32", reason="El desinstalador de Windows es un script de PowerShell")
def test_windows_uninstaller_removes_app_and_shortcuts_but_keeps_library(monkeypatch, tmp_path):
    from letha.services import uninstall as uninstall_service

    uv_calls = tmp_path / "uv-calls.txt"
    fake_uv = tmp_path / "uv.cmd"
    fake_uv.write_text(f'@echo %*> "{uv_calls}"\n', encoding="utf-8")
    shortcut = tmp_path / "Desktop" / "Letha.lnk"
    shortcut.parent.mkdir()
    shortcut.write_text("acceso directo", encoding="utf-8")
    (config.CACHE_DIR / "letha.log").write_text("log", encoding="utf-8")
    monkeypatch.setattr(uninstall_service, "_uv_executable", lambda: str(fake_uv))
    monkeypatch.setattr(uninstall_service, "_windows_shortcuts", lambda: [shortcut])

    script = uninstall_service.write_uninstaller_script(tmp_path, [], delete_library=False)
    subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script)], check=True, timeout=60
    )
    assert uv_calls.read_text().strip() == "tool uninstall letha"
    assert not shortcut.exists()
    assert not config.CACHE_DIR.exists()
    assert config.DATA_DIR.exists()


@pytest.mark.skipif(sys.platform != "darwin", reason="El desinstalador de macOS es un script de shell")
def test_macos_uninstaller_removes_app_and_library_when_asked(monkeypatch, tmp_path):
    from letha.services import uninstall as uninstall_service

    fake_bin = tmp_path / "fake-bin"
    fake_bin.mkdir()
    calls = tmp_path / "llamadas.txt"
    for name in ("uv", "defaults"):
        command = fake_bin / name
        command.write_text(f'#!/bin/sh\necho "{name} $*" >> {shlex.quote(str(calls))}\n')
        command.chmod(0o755)
    home = tmp_path / "home"
    bundle = home / "Applications" / "Letha.app"
    webkit = home / "Library" / "WebKit" / uninstall_service.updates.MACOS_BUNDLE_ID
    for directory in (bundle, webkit):
        directory.mkdir(parents=True)
    monkeypatch.setattr(Path, "home", lambda: home)
    monkeypatch.setattr(uninstall_service, "_uv_executable", lambda: str(fake_bin / "uv"))
    monkeypatch.setattr(uninstall_service, "_macos_app_bundle", lambda: bundle)

    script = uninstall_service.write_uninstaller_script(tmp_path, [], delete_library=True)
    subprocess.run(["/bin/sh", str(script)], env={"PATH": f"{fake_bin}:/usr/bin:/bin"}, check=True, timeout=30)
    assert calls.read_text().splitlines() == [
        "uv tool uninstall letha",
        f"defaults delete {uninstall_service.updates.MACOS_BUNDLE_ID}",
    ]
    for removed in (bundle, webkit, config.CACHE_DIR, config.DATA_DIR):
        assert not removed.exists()



@pytest.mark.skipif(
    sys.platform != "darwin" or platform.machine() != "arm64", reason="El instalador es para Macs con Apple Silicon"
)
def test_macos_installer_runs_with_a_utf8_locale(tmp_path):
    """Ejecuta scripts/install.sh con un uv falso, como lo hace el actualizador, para detectar errores del propio script."""
    fake_bin = tmp_path / "fake-bin"
    tools = tmp_path / "tools"
    for directory in (fake_bin, tools / "bin", tools / "letha" / "bin"):
        directory.mkdir(parents=True)
    executables = {
        fake_bin / "uv": '#!/bin/sh\ncase "$*" in\n  "tool dir --bin"*) echo "$FAKE_TOOLS/bin" ;;\n  "tool dir"*) echo "$FAKE_TOOLS" ;;\nesac\n',
        tools / "bin" / "letha": "#!/bin/sh\n",
        tools / "letha" / "bin" / "python": "#!/bin/sh\n",
    }
    for path, content in executables.items():
        path.write_text(content)
        path.chmod(0o755)

    installer = Path(__file__).resolve().parents[2] / "scripts" / "install.sh"
    env = {
        "PATH": f"{fake_bin}:/usr/bin:/bin",
        "HOME": str(tmp_path),
        "LC_ALL": "en_US.UTF-8",
        "FAKE_TOOLS": str(tools),
        "LETHA_WHEEL": str(tmp_path / "letha-9.9.9-py3-none-any.whl"),
        "LETHA_APP_DIR": str(tmp_path / "Applications"),
        "LETHA_NO_LAUNCH": "1",
    }
    result = subprocess.run(["/bin/sh", str(installer)], env=env, capture_output=True, text=True, errors="replace", timeout=60)
    assert result.returncode == 0, result.stderr
    assert "Installing Letha 9.9.9" in result.stdout
    info = (tmp_path / "Applications" / "Letha.app" / "Contents" / "Info.plist").read_text()
    assert "<string>9.9.9</string>" in info

class FakeProvider:
    def __init__(self, name, fail=False, prefix=""):
        self.name = name
        self.fail = fail
        self.prefix = prefix or f"{name}:"
        self.max_items = 100
        self.max_chars = 100000
        self.calls = []

    def available(self, source, target):
        return True

    def translate(self, texts, source, target):
        from letha.services.translation import ProviderError

        self.calls.append(list(texts))
        if self.fail:
            raise ProviderError("caído")
        return [f"{self.prefix}{t}" for t in texts]


def test_native_language_starts_unset_and_is_validated():
    database.init_db()
    client = TestClient(api.app)

    assert client.get("/api/settings").json()["native_language"] is None
    assert client.put("/api/settings", json={"native_language": "xx"}).status_code == 400
    res = client.put("/api/settings", json={"native_language": "es"})
    assert res.status_code == 200
    assert res.json()["native_language"] == "es"
    assert client.get("/api/settings").json()["native_language"] == "es"

    languages = client.get("/api/translation/languages").json()
    assert [language["code"] for language in languages] == ["es", "en", "fr", "it", "pt"]
    assert {"code": "es", "name": "Español"} in languages
    assert client.put("/api/settings", json={"native_language": "de"}).status_code == 400


def test_translation_falls_back_to_next_provider_and_caches(monkeypatch):
    from letha.services import translation as translation_service

    microsoft = FakeProvider("microsoft", fail=True)
    google = FakeProvider("google")
    monkeypatch.setattr(translation_service, "PROVIDERS", [microsoft, google])
    monkeypatch.setattr(translation_service, "_down_until", {})
    database.init_db()

    first = translation_service.translate(["Hello.", "Bye.", "Hello."], "en", "es")
    assert first == {"translations": ["google:Hello.", "google:Bye.", "google:Hello."], "provider": "google"}
    assert microsoft.calls == [["Hello.", "Bye."]]

    assert translation_service.translate(["Bye.", "Hello."], "en", "es")["provider"] == "cache"
    assert len(google.calls) == 1

    # Microsoft queda en pausa tras fallar, así que el siguiente texto va directo a Google
    assert translation_service.translate(["New."], "en", "es")["translations"] == ["google:New."]
    assert len(microsoft.calls) == 1

    google.fail = True
    offline = translation_service.translate(["Hello.", "Unknown."], "en", "es")
    assert offline == {"translations": ["google:Hello.", None], "provider": None}

    assert translation_service.translate(["Igual."], "es", "es")["translations"] == ["Igual."]


def test_translation_batches_respect_provider_limits():
    from letha.services import translation as translation_service

    provider = FakeProvider("x")
    provider.max_items, provider.max_chars = 2, 10
    batches = list(translation_service._batches(["aaaa", "bbbb", "cc", "dddddddddd", "e"], provider))
    assert batches == [["aaaa", "bbbb"], ["cc"], ["dddddddddd"], ["e"]]


def test_providers_parse_real_response_shapes(monkeypatch):
    from letha.services import translation as translation_service

    requests = []

    def fake_post(url, body, content_type):
        requests.append((url, body, content_type))
        if "microsoft" in url:
            return [{"translations": [{"text": "Hola.", "to": "es"}]}, {"translations": [{"text": "Adiós.", "to": "es"}]}]
        return [["Olá.", "en"], "Tchau."]

    monkeypatch.setattr(translation_service, "_post_json", fake_post)
    assert translation_service.MicrosoftProvider().translate(["Hello.", "Bye."], "en", "es") == ["Hola.", "Adiós."]
    assert translation_service.GoogleProvider().translate(["Hello.", "Bye."], "en", "pt") == ["Olá.", "Tchau."]

    ms_url, ms_body, _ = requests[0]
    assert "from=en&to=es" in ms_url and json.loads(ms_body) == ["Hello.", "Bye."]
    google_url, google_body, _ = requests[1]
    assert "sl=en&tl=pt" in google_url and google_body == b"q=Hello.&q=Bye."


def test_chapter_translations_endpoint(monkeypatch):
    from letha.services import translation as translation_service

    provider = FakeProvider("microsoft", prefix="ES: ")
    monkeypatch.setattr(translation_service, "PROVIDERS", [provider])
    monkeypatch.setattr(translation_service, "_down_until", {})
    database.init_db()
    client = TestClient(api.app)
    book_id = client.post(
        "/api/books/upload",
        files={"file": ("holly.pdf", io.BytesIO(create_structured_pdf()), "application/pdf")},
        data={"voice": "en-US-AvaNeural", "language": "en"},
    ).json()["id"]

    assert client.get(f"/api/books/{book_id}/chapters/0/translations").status_code == 409

    client.put("/api/settings", json={"native_language": "es"})
    res = client.get(f"/api/books/{book_id}/chapters/0/translations")
    assert res.status_code == 200
    data = res.json()
    sentences = [s["text"] for s in client.get(f"/api/books/{book_id}/chapters/0").json()["sentences"]]
    assert data["source"] == "en" and data["target"] == "es"
    assert data["translations"] == [f"ES: {s}" for s in sentences]
    assert data["provider"] == "microsoft"
    assert client.get(f"/api/books/{book_id}/chapters/0/translations").json()["provider"] == "cache"


def test_offline_models_cover_every_pair_of_book_languages():
    from letha.services import offline_translation
    from letha.services.tts import SUPPORTED_LANGUAGES

    for source in SUPPORTED_LANGUAGES:
        for target in SUPPORTED_LANGUAGES:
            model = offline_translation.model_for(source, target)
            assert (model is None) == (source == target)
            assert model is None or model in offline_translation.MODELS


def test_offline_translation_lists_the_book_languages_for_the_native_one():
    from letha.services import offline_translation

    database.init_db()
    client = TestClient(api.app)
    assert client.get("/api/translation/offline").json() == []
    assert client.post("/api/translation/offline/en").json()["detail"]["code"] == "native_language_required"

    client.put("/api/settings", json={"native_language": "es"})
    items = client.get("/api/translation/offline").json()
    romance = offline_translation.ROMANCE_MODEL
    assert [(i["language"], i["model"], i["status"]) for i in items] == [
        ("en", "opus-mt-tc-big-en-es", "missing"),
        ("fr", romance, "missing"),
        ("it", romance, "missing"),
        ("pt", romance, "missing"),
    ]
    assert client.post("/api/translation/offline/es").json()["detail"]["code"] == "unsupported_language"


def test_offline_model_download_is_verified_before_installing(monkeypatch, tmp_path):
    import zipfile

    from letha.services import offline_translation

    archive = tmp_path / "opus-mt-tc-big-en-es.zip"
    with zipfile.ZipFile(archive, "w") as z:
        for name in ("config.json", "model.bin", "source.spm", "target.spm"):
            z.writestr(name, "x")
    data = archive.read_bytes()
    model_dir = config.CACHE_DIR / "translation-models" / "opus-mt-tc-big-en-es"
    monkeypatch.setattr(offline_translation, "MODELS_URL", tmp_path.as_uri())
    monkeypatch.setattr(offline_translation, "_downloads", {})
    monkeypatch.setitem(
        offline_translation.MODELS,
        "opus-mt-tc-big-en-es",
        {"size": len(data), "sha256": hashlib.sha256(data).hexdigest()},
    )
    database.init_db()
    client = TestClient(api.app)
    client.put("/api/settings", json={"native_language": "es"})

    def finished(language):
        for _ in range(200):
            item = next(i for i in client.get("/api/translation/offline").json() if i["language"] == language)
            if item["status"] != "downloading":
                return item
            time.sleep(0.05)
        raise AssertionError("la descarga no terminó")

    assert client.post("/api/translation/offline/en").status_code == 200
    assert finished("en")["status"] == "installed"
    assert (model_dir / "model.bin").is_file()

    assert client.delete("/api/translation/offline/en").json()["status"] == "missing"
    assert not model_dir.exists()

    monkeypatch.setitem(offline_translation.MODELS, "opus-mt-tc-big-en-es", {"size": len(data), "sha256": "0" * 64})
    client.post("/api/translation/offline/en")
    failed = finished("en")
    assert (failed["status"], failed["error"]) == ("error", "checksum_mismatch")
    assert not model_dir.exists()


def test_offline_models_only_translate_when_online_providers_fail(monkeypatch):
    from letha.services import offline_translation
    from letha.services import translation as translation_service

    monkeypatch.setattr(translation_service, "_down_until", {})
    monkeypatch.setattr(offline_translation, "is_installed", lambda model: model == "opus-mt-tc-big-en-es")
    monkeypatch.setattr(offline_translation, "translate", lambda texts, source, target: [f"local:{t}" for t in texts])
    online = [FakeProvider("microsoft", fail=True), FakeProvider("google", fail=True)]
    monkeypatch.setattr(translation_service, "PROVIDERS", [*online, translation_service.OfflineProvider()])
    database.init_db()

    assert translation_service.translate(["Hello."], "en", "es") == {
        "translations": ["local:Hello."],
        "provider": "offline",
    }
    assert translation_service.translate(["Bonjour."], "fr", "es") == {"translations": [None], "provider": None}

    working = [FakeProvider("microsoft", prefix="ms:"), translation_service.OfflineProvider()]
    monkeypatch.setattr(translation_service, "PROVIDERS", working)
    monkeypatch.setattr(translation_service, "_down_until", {})
    assert translation_service.translate(["Good morning."], "en", "es")["provider"] == "microsoft"


def test_translation_engines_follow_the_order_chosen_in_settings(monkeypatch):
    from letha.services import translation as translation_service

    providers = [FakeProvider("microsoft", prefix="ms:"), FakeProvider("google", prefix="g:")]
    monkeypatch.setattr(translation_service, "PROVIDERS", providers)
    monkeypatch.setattr(translation_service, "_down_until", {})
    database.init_db()
    client = TestClient(api.app)

    assert client.get("/api/settings").json()["translation_order"] == ["microsoft", "google", "offline"]
    assert translation_service.translate(["Hello."], "en", "es")["provider"] == "microsoft"

    res = client.put("/api/settings", json={"translation_order": ["google", "offline", "microsoft"]})
    assert res.status_code == 200
    assert res.json()["translation_order"] == ["google", "offline", "microsoft"]
    assert client.get("/api/settings").json()["translation_order"] == ["google", "offline", "microsoft"]
    assert translation_service.translate(["Good night."], "en", "es") == {
        "translations": ["g:Good night."],
        "provider": "google",
    }

    repeated = client.put("/api/settings", json={"translation_order": ["google", "google", "microsoft"]})
    assert repeated.json()["detail"]["code"] == "invalid_translation_order"
    assert client.put("/api/settings", json={"translation_order": ["deepl", "google", "microsoft"]}).status_code == 422
    assert client.get("/api/settings").json()["translation_order"] == ["google", "offline", "microsoft"]


def test_edge_tts_default_rate_is_90_percent():
    """Verifica que la velocidad base nativa de edge-tts sea 90% (-10%) por defecto y sea configurable."""
    from letha.services import tts as tts_service

    database.init_db()
    client = TestClient(api.app)

    res_get = client.get("/api/settings")
    assert res_get.status_code == 200
    assert res_get.json()["edge_base_speed"] == 0.90
    assert res_get.json()["auto_advance_sentence"] is True
    assert res_get.json()["auto_advance_page"] is True
    assert res_get.json()["boundary_type"] == "SentenceBoundary"
    assert tts_service.EDGE_BASE_SPEED == 0.90
    assert tts_service.format_rate(1.0) == "-10%"

    # Cambiar velocidad nativa a 85% (-15%), modo solo al clickear, sin pasar página y WordBoundary
    res_put = client.put(
        "/api/settings",
        json={
            "edge_base_speed": 0.85,
            "auto_advance_sentence": False,
            "auto_advance_page": False,
            "boundary_type": "WordBoundary",
        },
    )
    assert res_put.status_code == 200
    assert res_put.json()["edge_base_speed"] == 0.85
    assert res_put.json()["auto_advance_sentence"] is False
    assert res_put.json()["auto_advance_page"] is False
    assert res_put.json()["boundary_type"] == "WordBoundary"
    assert tts_service.format_rate(1.0) == "-15%"
    assert tts_service.AUDIO_CACHE_TAG == "0.85_wb"

    # Verificar alineación de palabras por oración en modo WordBoundary
    aligned = tts_service._align_words_to_sentences(
        ["Hello world.", "It works."],
        [
            {"text": "Hello", "start": 0.1, "end": 0.4},
            {"text": "world", "start": 0.45, "end": 0.8},
            {"text": "It", "start": 1.0, "end": 1.2},
            {"text": "works", "start": 1.25, "end": 1.7},
        ],
        1.8,
    )
    assert len(aligned) == 2
    assert len(aligned[0][2]) == 2
    assert aligned[0][2][0]["text"] == "Hello"
    assert len(aligned[1][2]) == 2
    assert aligned[1][2][1]["text"] == "works"

    # Restaurar al 90%, lectura en automático y SentenceBoundary por defecto
    client.put(
        "/api/settings",
        json={
            "edge_base_speed": 0.90,
            "auto_advance_sentence": True,
            "boundary_type": "SentenceBoundary",
        },
    )
    assert tts_service.format_rate(1.0) == "-10%"
    assert tts_service.AUDIO_CACHE_TAG == "0.90"


class FakeKokoro:
    def __init__(self):
        self.calls = []

    def create(self, text, voice, speed, lang):
        import numpy as np

        self.calls.append((text, voice, speed, lang))
        seconds = np.arange(int(len(text) / 20 * 24000)) / 24000
        return (0.3 * np.sin(2 * np.pi * 220 * seconds)).astype(np.float32), 24000


def install_fake_offline_voices(monkeypatch):
    from letha.services import offline_voices

    directory = config.CACHE_DIR / "voice-models" / "kokoro"
    directory.mkdir(parents=True)
    for name in offline_voices.FILES:
        (directory / name).write_bytes(b"x")
    fake = FakeKokoro()
    monkeypatch.setattr(offline_voices, "_load", lambda: fake)
    return fake


def test_offline_voices_have_their_own_names_and_languages():
    from letha.services import offline_voices
    from letha.services import tts as tts_service

    assert tts_service.voice_language("kokoro-ef_dora") == "es"
    assert tts_service.voice_language("kokoro-bf_emma") == "en"
    assert tts_service.voice_language("kokoro-pm_santa") == "pt"
    assert tts_service._extract_persona_name("kokoro-ef_dora") == "Dora"
    assert not offline_voices.is_voice("kokoro-zf_xiaobei")
    assert {offline_voices.language_of(offline_voices.VOICE_PREFIX + v) for v in offline_voices.VOICES} == set(
        tts_service.SUPPORTED_LANGUAGES
    )


def test_offline_voices_join_the_list_once_downloaded(monkeypatch):
    from letha.services import tts as tts_service

    async def fake_list_voices():
        return [
            {"ShortName": name, "Locale": name.rsplit("-", 1)[0], "Gender": "Female"}
            for name in ("es-MX-DaliaNeural", "en-US-AvaNeural")
        ]

    monkeypatch.setattr(tts_service.edge_tts, "list_voices", fake_list_voices)
    database.init_db()
    client = TestClient(api.app)
    assert [v["short_name"] for v in client.get("/api/voices").json()] == ["es-MX-DaliaNeural", "en-US-AvaNeural"]

    install_fake_offline_voices(monkeypatch)
    voices = client.get("/api/voices").json()
    names = [v["short_name"] for v in voices]
    assert (
        names.index("es-MX-DaliaNeural")
        < names.index("kokoro-ef_dora")
        < names.index("en-US-AvaNeural")
        < names.index("kokoro-af_heart")
    )
    dora = next(v for v in voices if v["short_name"] == "kokoro-ef_dora")
    assert dora == {"name": "Dora", "short_name": "kokoro-ef_dora", "gender": "Female", "locale": "es-419", "offline": True}
    assert next(v for v in voices if v["short_name"] == "es-MX-DaliaNeural")["offline"] is False

    # Sin internet se conserva la última lista conocida de voces en línea
    async def no_connection():
        raise OSError("sin red")

    monkeypatch.setattr(tts_service.edge_tts, "list_voices", no_connection)
    assert [v["short_name"] for v in client.get("/api/voices").json()] == names


def test_offline_voice_reads_a_page_sentence_by_sentence(monkeypatch):
    from letha.services import tts as tts_service

    database.init_db()
    client = TestClient(api.app)
    files = {"file": ("libro.pdf", io.BytesIO(create_sample_pdf()), "application/pdf")}
    book = client.post("/api/books/upload", files=files, data={"voice": "kokoro-ef_dora", "language": "es"}).json()
    synthesize = f"/api/books/{book['id']}/chapters/0/synthesize?voice=kokoro-ef_dora"

    missing = client.post(synthesize)
    assert missing.status_code == 409
    assert missing.json()["detail"]["code"] == "offline_voices_missing"

    fake = install_fake_offline_voices(monkeypatch)
    res = client.post(synthesize).json()
    assert res["is_complete"] is True
    sentences = res["sentences"]
    assert all(s["end"] > s["start"] for s in sentences)
    assert all(a["end"] <= b["start"] + 0.001 for a, b in zip(sentences, sentences[1:]))
    assert 0 <= res["duration"] - sentences[-1]["end"] < 0.5
    assert {call[1:] for call in fake.calls} == {("ef_dora", tts_service.get_edge_base_speed(), "es-419")}

    audio = client.get(res["audio_url"])
    assert audio.status_code == 200
    assert audio.content[:1] == b"\xff"


def test_offline_voices_download_is_verified_before_installing(monkeypatch, tmp_path):
    from letha.services import offline_voices

    files = {"kokoro-v1.0.onnx": b"modelo", "voices-v1.0.bin": b"voces"}
    for name, data in files.items():
        (tmp_path / name).write_bytes(data)
    monkeypatch.setattr(offline_voices, "FILES_URL", tmp_path.as_uri())
    monkeypatch.setattr(offline_voices, "_download", None)
    monkeypatch.setattr(
        offline_voices,
        "FILES",
        {name: {"size": len(data), "sha256": hashlib.sha256(data).hexdigest()} for name, data in files.items()},
    )
    installed_dir = config.CACHE_DIR / "voice-models" / "kokoro"
    database.init_db()
    client = TestClient(api.app)

    def finished():
        for _ in range(200):
            item = client.get("/api/voices/offline").json()
            if item["status"] != "downloading":
                return item
            time.sleep(0.05)
        raise AssertionError("la descarga no terminó")

    assert client.get("/api/voices/offline").json() == {"size": 11, "status": "missing", "progress": 0.0, "error": None}
    assert client.post("/api/voices/offline").status_code == 200
    assert finished()["status"] == "installed"
    assert offline_voices.list_voices()

    assert client.delete("/api/voices/offline").json()["status"] == "missing"
    assert not installed_dir.exists()

    monkeypatch.setitem(offline_voices.FILES, "voices-v1.0.bin", {"size": 5, "sha256": "0" * 64})
    client.post("/api/voices/offline")
    failed = finished()
    assert (failed["status"], failed["error"]) == ("error", "checksum_mismatch")
    assert not installed_dir.exists()


@pytest.mark.skipif(not os.environ.get("LETHA_KOKORO_MODELS"), reason="Requiere los archivos del modelo descargados")
def test_offline_voice_with_the_real_model(monkeypatch):
    from letha.services import offline_voices

    monkeypatch.setattr(offline_voices, "_installed_dir", lambda: Path(os.environ["LETHA_KOKORO_MODELS"]))
    monkeypatch.setattr(offline_voices, "_kokoro", None)
    audio, duration, timings = offline_voices.synthesize(["Hola, ¿cómo estás?", "Muy bien."], "kokoro-ef_dora", 0.9)
    assert audio[:1] == b"\xff"
    assert duration > 1
    assert timings[0][1] <= timings[1][0] and timings[1][1] == duration


def test_offline_mode_remembers_each_books_online_voice(monkeypatch):
    from letha.services import tts as tts_service

    async def must_not_go_online():
        raise AssertionError("en modo sin conexión no se piden las voces en línea")

    database.init_db()
    install_fake_offline_voices(monkeypatch)
    client = TestClient(api.app)
    files = {"file": ("libro.pdf", io.BytesIO(create_sample_pdf()), "application/pdf")}
    book_id = client.post("/api/books/upload", files=files, data={"voice": "es-MX-DaliaNeural", "language": "es"}).json()["id"]
    voice = lambda: client.get(f"/api/books/{book_id}").json()["voice"]

    settings = client.put("/api/settings", json={"offline_mode": True, "offline_mode_auto": True}).json()
    assert (settings["offline_mode"], settings["offline_mode_auto"]) == (True, True)
    assert voice() == "kokoro-ef_dora"
    assert client.get("/api/books").json()[0]["voice"] == "kokoro-ef_dora"

    monkeypatch.setattr(tts_service.edge_tts, "list_voices", must_not_go_online)
    assert all(v["offline"] for v in client.get("/api/voices").json())
    client.put(f"/api/books/{book_id}/settings", json={"voice": "kokoro-em_alex"})
    assert voice() == "kokoro-em_alex"

    assert client.put("/api/settings", json={"offline_mode": False}).json()["offline_mode"] is False
    assert voice() == "es-MX-DaliaNeural"

    settings = client.put("/api/settings", json={"offline_mode": True}).json()
    assert (settings["offline_mode"], settings["offline_mode_auto"]) == (True, False)
    assert voice() == "kokoro-em_alex"


def test_offline_mode_translates_only_with_downloaded_models(monkeypatch):
    from letha.services import translation as translation_service

    providers = [FakeProvider("microsoft"), FakeProvider("google"), FakeProvider("offline")]
    monkeypatch.setattr(translation_service, "PROVIDERS", providers)
    monkeypatch.setattr(translation_service, "_down_until", {})
    database.init_db()

    assert translation_service.translate(["Hello."], "en", "es")["provider"] == "microsoft"
    database.set_offline_mode(True, automatic=True)
    assert translation_service.translate(["Bye."], "en", "es") == {"translations": ["offline:Bye."], "provider": "offline"}
    assert [len(p.calls) for p in providers] == [1, 0, 1]


def test_connectivity_check(monkeypatch, tmp_path):
    reachable = tmp_path / "respuesta.txt"
    reachable.write_text("ok")
    client = TestClient(api.app)

    monkeypatch.setattr(api, "CONNECTIVITY_URL", reachable.as_uri())
    assert client.get("/api/connectivity").json() == {"online": True}
    monkeypatch.setattr(api, "CONNECTIVITY_URL", (tmp_path / "no-existe.txt").as_uri())
    assert client.get("/api/connectivity").json() == {"online": False}
