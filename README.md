# Letha

Lector de libros en PDF y audiolibro interactivo para macOS y Windows. Lee tus libros en una interfaz limpia mientras los escuchas narrados con voces neurales ultra-realistas (las mismas que usa Microsoft Edge), con el texto resaltado en tiempo real estilo karaoke.

---

## Características

- **Extracción limpia de PDFs:** Usa `PyMuPDF` para estructurar páginas, detectar la tabla de contenidos (TOC) y filtrar encabezados y números de página que arruinarían la lectura de voz.
- **Voces Neurales Gratuitas:** Integración con `edge-tts`, con decenas de voces humanas de alta fidelidad en inglés, español, francés, italiano y portugués.
- **Voces sin conexión:** Desde **Configuración → Voces sin conexión** puedes descargar el modelo [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache 2.0, unos 354 MB) para escuchar tus libros sin internet en los cinco idiomas. Sus voces aparecen en el selector marcadas como sin conexión y se publican en el release [`voces-kokoro-1`](https://github.com/JUrielC/letha/releases/tag/voces-kokoro-1).
- **Efecto Karaoke (Sincronización exacta):** Captura eventos de `SentenceBoundary` para sincronizar y resaltar la frase que se está reproduciendo en cada milisegundo con auto-desplazamiento suave.
- **Navegación Interactiva:** Haz clic en cualquier oración del texto para saltar la reproducción inmediatamente a ese punto exacto.
- **Experiencia de Lectura:** Modos **Claro**, **Sepia cálido** y **Oscuro**, tamaños de tipografía ajustables y control de velocidad de reproducción (0.75x a 2.0x).
- **Traducción al idioma nativo:** Cada oración se traduce con Microsoft o, si falla, con Google. Como respaldo sin internet, desde **Configuración → Traducción sin conexión** puedes descargar modelos [Opus-MT](https://github.com/Helsinki-NLP/Opus-MT) de la Universidad de Helsinki (CC BY 4.0 y Apache 2.0), convertidos a [CTranslate2](https://github.com/OpenNMT/CTranslate2); se publican en el release [`modelos-traduccion-1`](https://github.com/JUrielC/letha/releases/tag/modelos-traduccion-1).

---

## Instalación

### Requisitos

| | macOS | Windows |
|---|---|---|
| Sistema | macOS 13 Ventura o posterior | Windows 10 u 11 de 64 bits, en Intel o AMD (Windows en ARM no está probado) |
| Equipo | Mac con Apple Silicon (M1 o posterior) | Procesador de 4 núcleos o más |
| Memoria | 8 GB de RAM recomendados | 8 GB de RAM recomendados |
| Internet | Para instalar y actualizar, y para las voces y la traducción en línea | Igual que en macOS |

> [!WARNING]
> **macOS 12 Monterey o anterior:** desde la versión 1.4.0, Letha puede no instalarse ni actualizarse en estos sistemas, porque los componentes de las voces sin conexión ya no se publican para ellos. Si tienes macOS 12, actualiza a macOS 13 o posterior: todos los Mac con Apple Silicon pueden hacerlo.

#### Para usar Letha sin conexión

Las voces y la traducción sin conexión se descargan antes desde **Configuración**:

| Descarga | Espacio |
|---|---|
| Voces sin conexión (los cinco idiomas) | 354 MB |
| Traducción sin conexión | 242 MB si tu idioma nativo es inglés; hasta 455 MB si es español, francés, italiano o portugués |
| Audio que se va generando al escuchar | Unos 22 MB por hora |

- **Memoria:** con las voces sin conexión, Letha usa unos 700 MB de RAM, y unos 300 MB más al traducir sin conexión.
- **Procesador:** la voz se genera en el equipo y tiene que ir más rápido de lo que se escucha. En un Mac con Apple Silicon va sobrada: un M3 genera una página de 95 segundos de audio en 22. En Windows conviene un procesador de 4 núcleos o más de 2020 en adelante (por ejemplo, un Ryzen 5 de la serie 4000 o un Core i5 de 11.ª generación). Un Ryzen 7 7730U tarda entre la mitad y algo más del tiempo de escucha, según qué tan ocupado esté el equipo; en equipos más lentos puede haber pausas entre las partes de una página.
- **Tarjeta gráfica:** no se usa.

### En macOS (Apple Silicon)

Abre la app **Terminal** (⌘ + espacio, escribe "Terminal"), pega esta línea y pulsa Enter:

```bash
curl -fsSL https://github.com/JUrielC/letha/releases/latest/download/install.sh | sh
```

La URL `releases/latest` siempre apunta a la versión más reciente publicada en [Releases](https://github.com/JUrielC/letha/releases), así que el mismo comando instala siempre la última versión.

Cuando termine, Letha queda en tu carpeta de **Aplicaciones**: ábrelo con Spotlight (⌘ + espacio, "Letha") o con doble clic.

### En Windows (Windows 10 / 11)

En **PowerShell**:

```powershell
irm https://github.com/JUrielC/letha/releases/latest/download/install.ps1 | iex
```

O en **CMD (Símbolo del sistema)**:

```cmd
powershell -ExecutionPolicy Bypass -c "irm https://github.com/JUrielC/letha/releases/latest/download/install.ps1 | iex"
```

Cuando termine, Letha creará un acceso directo en tu **Escritorio** y en el **Menú Inicio** (presiona la tecla Windows y escribe "Letha"), abriéndose en su propia ventana sin consola.

### ¿Por qué se instala por Terminal?
Tanto macOS (Gatekeeper) como Windows (SmartScreen) bloquean los instaladores descargados desde el navegador si no cuentan con certificados comerciales de pago. Lo que se instala desde la Terminal con `uv` crea el acceso directo en tu propio equipo, por lo que se abre con doble clic sin advertencias de seguridad.

### Actualizar o desinstalar

Para **actualizar**, Letha te avisa en la biblioteca cuando hay una versión nueva: desde el aviso (o desde **Configuración → Actualizaciones**) puedes ver las novedades y actualizar con un clic. Letha descarga la versión nueva, verifica su huella SHA-256, se cierra y vuelve a abrirse ya actualizada, conservando tu biblioteca. También puedes volver a ejecutar el comando de instalación de tu sistema.

Para **desinstalar**, abre **Configuración → Desinstalar**. Letha se cierra y se quita del equipo junto con sus accesos directos; tú eliges si también se borra tu biblioteca (libros, audios y progreso). Si prefieres hacerlo desde la terminal, estos comandos lo quitan todo, biblioteca incluida.

Para **desinstalar en macOS**:
```bash
uv tool uninstall letha && rm -rf ~/Applications/Letha.app ~/.cache/letha ~/.local/share/letha
```

Para **desinstalar en Windows (PowerShell)**:
```powershell
uv tool uninstall letha; Remove-Item "$env:USERPROFILE\Desktop\Letha.lnk", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Letha.lnk", "$env:USERPROFILE\.cache\letha", "$env:USERPROFILE\.local\share\letha" -Recurse -Force -ErrorAction SilentlyContinue
```

---

## Desarrollo local

Si quieres clonar el repositorio y modificarlo:

### Requisitos
- [uv](https://docs.astral.sh/uv/) (instalador de Python)
- [Node.js](https://nodejs.org/) o [Bun](https://bun.sh/)
- `swiftc` (en macOS, incluido en las Command Line Tools: `xcode-select --install`)

### Levantar y detener en desarrollo
```bash
./start.sh
```
Y para detener ambos servicios:
```bash
./stop.sh
```

### Compilar Release para Distribución
Para generar en local el paquete multiplataforma empaquetado (Next.js compilado + ventana Swift + wheel de Python):
```bash
./scripts/build-release.sh
```
El archivo distribuible quedará en `dist/letha-<versión>-py3-none-any.whl` (compatible tanto con macOS como con Windows), junto a copias de `install.sh` e `install.ps1`.

### Publicar una versión
Los releases los publica GitHub Actions ([`.github/workflows/release.yml`](.github/workflows/release.yml)) al subir un tag:

1. Sube la versión en `backend/pyproject.toml`, `backend/letha/__init__.py`, `backend/letha/api.py` y `frontend/package.json`, y haz commit.
2. Crea y sube el tag:
   ```bash
   git tag v<versión> && git push origin v<versión>
   ```

El workflow comprueba que el tag coincida con la versión, corre los tests, compila en macOS y publica el release con el wheel, `install.sh` e `install.ps1`. Los tres son necesarios: los comandos de instalación descargan los instaladores desde `releases/latest/download/`.

Para probar el pipeline sin publicar nada: `gh workflow run release.yml`.

### Canal de actualizaciones
La app no consulta GitHub directamente: lee el manifiesto en `https://letha.jurielc.com/updates/latest.json` (`MANIFEST_URL` en [`backend/letha/services/updates.py`](backend/letha/services/updates.py)). Cada release genera ese manifiesto (versión, cambios, y URL y huella SHA-256 de cada archivo) y el workflow [`site.yml`](.github/workflows/site.yml) lo publica en GitHub Pages, así que se puede cambiar de hosting sin afectar a las copias ya instaladas.

Las descargas de **Configuración** (traducción y voces sin conexión) siguen el mismo principio: la app lee de dónde bajar cada archivo en `https://letha.jurielc.com/models/catalog.json` (`CATALOG_URL` en [`backend/letha/services/model_catalog.py`](backend/letha/services/model_catalog.py)). Las huellas SHA-256 están fijas en el código, así que el catálogo solo decide la dirección. Si el catálogo no responde, la app usa las direcciones de los releases `modelos-traduccion-1` y `voces-kokoro-1`. Para mover los modelos a otro hospedaje basta editar [`site/models/catalog.json`](site/models/catalog.json) y subirlo a `master`: el sitio se vuelve a publicar solo.

Cada despliegue de Pages reemplaza el sitio entero, así que todo lo que se sirva en `letha.jurielc.com` (por ejemplo, la documentación en `/docs`) debe vivir en la carpeta [`site/`](site/) o armarse en ese mismo workflow.

Configuración única:
1. En el DNS, un registro `CNAME` de `letha` apuntando a `jurielc.github.io` (en Cloudflare, en modo «solo DNS»).
2. En el repo, **Settings → Pages**: *Source* = **GitHub Actions**, *Custom domain* = `letha.jurielc.com` y, cuando esté disponible, **Enforce HTTPS**.

Para probar contra otro manifiesto, arranca la app con `LETHA_UPDATE_URL=<url del manifiesto>`; para otro catálogo de modelos, con `LETHA_MODELS_URL=<url del catálogo>`.

---

## Créditos y licencias de terceros

### Modelos de traducción sin conexión

Los modelos del release [`modelos-traduccion-1`](https://github.com/JUrielC/letha/releases/tag/modelos-traduccion-1) son obras derivadas de modelos [Opus-MT](https://github.com/Helsinki-NLP/Opus-MT) del Language Technology Research Group de la Universidad de Helsinki (Helsinki-NLP). La única modificación es la conversión al formato de [CTranslate2](https://github.com/OpenNMT/CTranslate2) con cuantización int8; los pesos no se reentrenaron.

| Modelo original | Licencia |
|---|---|
| [opus-mt-tc-big-en-es](https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-en-es), [opus-mt-tc-big-en-fr](https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-en-fr), [opus-mt-tc-big-en-it](https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-en-it), [opus-mt-tc-big-en-pt](https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-en-pt), [opus-mt-tc-big-itc-itc](https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-itc-itc) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| [opus-mt-tc-bible-big-roa-en](https://huggingface.co/Helsinki-NLP/opus-mt-tc-bible-big-roa-en) | [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0) |

Referencia: Jörg Tiedemann y Santhosh Thottingal, *OPUS-MT — Building open translation services for the World*, EAMT 2020.

### Voces sin conexión

Los archivos del release [`voces-kokoro-1`](https://github.com/JUrielC/letha/releases/tag/voces-kokoro-1) son el modelo [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) de hexgrad y sus voces, en la exportación a ONNX de [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) (release `model-files-v1.1`), sin modificaciones. El modelo se distribuye bajo [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0).

### Fuentes

Las fuentes [Instrument Sans](https://fonts.google.com/specimen/Instrument+Sans) y [Literata](https://fonts.google.com/specimen/Literata) se incluyen en la interfaz compilada y se distribuyen bajo la [SIL Open Font License 1.1](https://openfontlicense.org).

### Bibliotecas y herramientas

| Proyecto | Uso en Letha | Licencia |
|---|---|---|
| [PyMuPDF](https://github.com/pymupdf/PyMuPDF) (Artifex) | Lectura de los PDF y portadas | AGPL-3.0 |
| [edge-tts](https://github.com/rany2/edge-tts) | Voces neurales de Microsoft Edge | LGPL-3.0 |
| [CTranslate2](https://github.com/OpenNMT/CTranslate2) (OpenNMT) | Traducción sin conexión | MIT |
| [SentencePiece](https://github.com/google/sentencepiece) (Google) | Tokenización de los modelos de traducción | Apache 2.0 |
| [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) | Voces sin conexión | MIT |
| [ONNX Runtime](https://github.com/microsoft/onnxruntime) (Microsoft) | Ejecución del modelo de voz | MIT |
| [eSpeak NG](https://github.com/espeak-ng/espeak-ng) (vía espeakng-loader), [phonemizer](https://github.com/bootphon/phonemizer) | Pronunciación de las voces sin conexión | GPL-3.0 |
| [lameenc](https://github.com/chrisstaite/lameenc) ([LAME](https://lame.sourceforge.io)) | Audio MP3 de las voces sin conexión | LGPL-3.0 |
| [FastAPI](https://github.com/fastapi/fastapi), [Pydantic](https://github.com/pydantic/pydantic) | API local | MIT |
| [Uvicorn](https://github.com/encode/uvicorn) | Servidor local | BSD-3-Clause |
| [python-multipart](https://github.com/Kludex/python-multipart), [aiofiles](https://github.com/Tinche/aiofiles) | Subida y lectura de archivos | Apache 2.0 |
| [pywebview](https://github.com/r0x0r/pywebview), [Python.NET](https://github.com/pythonnet/pythonnet) | Ventana nativa en Windows | BSD-3-Clause, MIT |
| [Next.js](https://github.com/vercel/next.js), [React](https://github.com/facebook/react), [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) | Interfaz | MIT |
| [Lucide](https://github.com/lucide-icons/lucide) | Iconos | ISC |
| [uv](https://github.com/astral-sh/uv) (Astral) | Instalación de Letha y de Python | MIT o Apache 2.0 |

Las voces y la traducción en línea usan servicios de Microsoft y Google, sujetos a sus propios términos.

---

## Licencia

El código de Letha se distribuye bajo licencia MIT. Las bibliotecas, fuentes y modelos de terceros conservan sus propias licencias (ver arriba).
