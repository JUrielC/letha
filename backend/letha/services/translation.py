"""
Traducción con una cadena de proveedores sin clave (Microsoft, Google y los modelos descargados en
el equipo, en el orden elegido en Configuración) y caché local: cada texto se traduce una sola vez
por par de idiomas.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Dict, Iterator, List, Optional, Sequence, Tuple

from letha import database
from letha.services import offline_translation

# Deben ser los idiomas en los que está traducida la interfaz (frontend/lib/i18n/messages)
NATIVE_LANGUAGES = {
    "es": "Español",
    "en": "English",
    "fr": "Français",
    "it": "Italiano",
    "pt": "Português",
}

FAILURE_COOLDOWN_SECONDS = 300
REQUEST_TIMEOUT_SECONDS = 10
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0"
)


class ProviderError(Exception):
    pass


def _post_json(url: str, body: bytes, content_type: str):
    request = urllib.request.Request(
        url, data=body, headers={"Content-Type": content_type, "User-Agent": USER_AGENT}
    )
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            return json.load(response)
    except (urllib.error.URLError, OSError, ValueError) as e:
        raise ProviderError(str(e)) from e


class Provider:
    name = ""
    max_items = 1
    max_chars = 1

    def available(self, source: str, target: str) -> bool:
        return True

    def translate(self, texts: List[str], source: str, target: str) -> List[str]:
        raise NotImplementedError


class MicrosoftProvider(Provider):
    """Endpoint interno que usa Microsoft Edge para traducir páginas; no está documentado."""

    name = "microsoft"
    max_items = 100
    max_chars = 20000

    def translate(self, texts: List[str], source: str, target: str) -> List[str]:
        query = urllib.parse.urlencode(
            {"from": source, "to": target, "isEnterpriseClient": "false"}
        )
        data = _post_json(
            f"https://edge.microsoft.com/translate/translatetext?{query}",
            json.dumps(texts).encode(),
            "application/json",
        )
        try:
            return [item["translations"][0]["text"] for item in data]
        except (KeyError, IndexError, TypeError) as e:
            raise ProviderError("Respuesta inesperada de Microsoft") from e


class GoogleProvider(Provider):
    """Endpoint gratuito del traductor de Google (client=gtx); no está documentado."""

    name = "google"
    max_items = 40
    max_chars = 4500

    def translate(self, texts: List[str], source: str, target: str) -> List[str]:
        query = urllib.parse.urlencode({"client": "gtx", "sl": source, "tl": target})
        data = _post_json(
            f"https://translate.googleapis.com/translate_a/t?{query}",
            urllib.parse.urlencode([("q", t) for t in texts]).encode(),
            "application/x-www-form-urlencoded",
        )
        if not isinstance(data, list):
            raise ProviderError("Respuesta inesperada de Google")
        # Con detección automática del idioma cada elemento llega como [traducción, idioma]
        return [item[0] if isinstance(item, list) else item for item in data]


class OfflineProvider(Provider):
    """Modelos descargados desde Configuración; solo responde por los pares que estén instalados."""

    name = "offline"
    max_items = 32
    max_chars = 8000

    def available(self, source: str, target: str) -> bool:
        return offline_translation.is_available(source, target)

    def translate(self, texts: List[str], source: str, target: str) -> List[str]:
        try:
            return offline_translation.translate(texts, source, target)
        except (LookupError, OSError, RuntimeError, ValueError) as e:
            raise ProviderError(str(e)) from e


PROVIDERS: List[Provider] = [MicrosoftProvider(), GoogleProvider(), OfflineProvider()]
_down_until: Dict[str, float] = {}


def _batches(texts: Sequence[str], provider: Provider) -> Iterator[List[str]]:
    batch: List[str] = []
    chars = 0
    for text in texts:
        if batch and (len(batch) >= provider.max_items or chars + len(text) > provider.max_chars):
            yield batch
            batch, chars = [], 0
        batch.append(text)
        chars += len(text)
    if batch:
        yield batch


def _ordered_providers() -> List[Provider]:
    order = database.get_translation_order()
    return sorted(PROVIDERS, key=lambda p: order.index(p.name) if p.name in order else len(order))


def _translate_with_providers(
    texts: List[str], source: str, target: str
) -> Tuple[Optional[List[str]], Optional[str]]:
    for provider in _ordered_providers():
        if _down_until.get(provider.name, 0) > time.time() or not provider.available(source, target):
            continue
        try:
            result: List[str] = []
            for batch in _batches(texts, provider):
                translated = provider.translate(batch, source, target)
                if len(translated) != len(batch):
                    raise ProviderError(f"{provider.name} devolvió {len(translated)} de {len(batch)} textos")
                result.extend(translated)
            return result, provider.name
        except ProviderError:
            _down_until[provider.name] = time.time() + FAILURE_COOLDOWN_SECONDS
    return None, None


def translate(texts: Sequence[str], source: str, target: str) -> Dict[str, object]:
    """
    Traduce los textos de `source` a `target`. Devuelve las traducciones en el mismo orden
    (None si ningún proveedor respondió) y el proveedor usado ("cache" si no hizo falta ninguno).
    """
    if source == target:
        return {"translations": list(texts), "provider": None}

    known = database.get_cached_translations(source, target, texts)
    missing = [t for t in dict.fromkeys(texts) if t not in known and t.strip()]
    provider: Optional[str] = "cache"
    if missing:
        result, provider = _translate_with_providers(missing, source, target)
        if result is not None:
            fresh = dict(zip(missing, result))
            database.store_translations(source, target, fresh, provider)
            known.update(fresh)

    return {"translations": [known.get(t) for t in texts], "provider": provider}
