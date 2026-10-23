"""
Pruebas de la API y del servidor empaquetado de Letha con TestClient.
"""

import asyncio
import hashlib
import io
import json
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
        conn.execute("DELETE FROM app_settings WHERE key = 'paragraphs_extracted'")

    stale_audio = config.AUDIO_DIR / f"{book_id}_c0_en-US-AvaNeural_0.85.mp3"
    kept_audio = config.AUDIO_DIR / f"{book_id}_c1_en-US-AvaNeural_0.85.mp3"
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


class FakeProvider:
    def __init__(self, name, fail=False, prefix=""):
        self.name = name
        self.fail = fail
        self.prefix = prefix or f"{name}:"
        self.max_items = 100
        self.max_chars = 100000
        self.calls = []

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


def test_edge_tts_default_rate_is_85_percent():
    """Verifica que la velocidad base nativa de edge-tts sea 85% (-15%) por defecto y sea configurable."""
    from letha.services import tts as tts_service

    database.init_db()
    client = TestClient(api.app)

    res_get = client.get("/api/settings")
    assert res_get.status_code == 200
    assert res_get.json()["edge_base_speed"] == 0.85
    assert res_get.json()["auto_advance_sentence"] is True
    assert res_get.json()["auto_advance_page"] is True
    assert res_get.json()["boundary_type"] == "SentenceBoundary"
    assert tts_service.EDGE_BASE_SPEED == 0.85
    assert tts_service.format_rate(1.0) == "-15%"

    # Cambiar velocidad nativa a 90% (-10%), modo solo al clickear, sin pasar página y WordBoundary
    res_put = client.put(
        "/api/settings",
        json={
            "edge_base_speed": 0.90,
            "auto_advance_sentence": False,
            "auto_advance_page": False,
            "boundary_type": "WordBoundary",
        },
    )
    assert res_put.status_code == 200
    assert res_put.json()["edge_base_speed"] == 0.90
    assert res_put.json()["auto_advance_sentence"] is False
    assert res_put.json()["auto_advance_page"] is False
    assert res_put.json()["boundary_type"] == "WordBoundary"
    assert tts_service.format_rate(1.0) == "-10%"
    assert tts_service.AUDIO_CACHE_TAG == "0.90_wb"

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

    # Restaurar al 85%, lectura en automático y SentenceBoundary por defecto
    client.put(
        "/api/settings",
        json={
            "edge_base_speed": 0.85,
            "auto_advance_sentence": True,
            "boundary_type": "SentenceBoundary",
        },
    )
    assert tts_service.format_rate(1.0) == "-15%"
    assert tts_service.AUDIO_CACHE_TAG == "0.85"


