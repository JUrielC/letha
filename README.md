# Letha 📖🎧

Lector de libros en PDF y audiolibro interactivo para macOS. Lee tus libros en una interfaz limpia mientras los escuchas narrados con voces neurales ultra-realistas (las mismas que usa Microsoft Edge), con el texto resaltado en tiempo real estilo karaoke.

---

## Características

- 📑 **Extracción limpia de PDFs:** Usa `PyMuPDF` para estructurar capítulos, detectar la tabla de contenidos (TOC) y filtrar encabezados y números de página que arruinarían la lectura de voz.
- 🎙️ **Voces Neurales Gratuitas:** Integración con `edge-tts` (el mismo motor utilizado en `pyvideotrans`), con decenas de voces humanas de alta fidelidad en español (México, España, Argentina, etc.) y otros idiomas.
- ⚡ **Efecto Karaoke (Sincronización exacta):** Captura eventos de `SentenceBoundary` para sincronizar y resaltar la frase que se está reproduciendo en cada milisegundo con auto-desplazamiento suave.
- 🎯 **Navegación Interactiva:** Haz clic en cualquier oración del texto para saltar la reproducción inmediatamente a ese punto exacto.
- 🎨 **Experiencia de Lectura:** Modos **Claro**, **Sepia cálido** y **Oscuro**, tamaños de tipografía ajustables y control de velocidad de reproducción (0.75x a 2.0x).
- 🔒 **100% Local y Privado:** Sin costos de servidores en la nube. Tus libros y audios generados se guardan localmente en tu disco.

---

## Instalación

Necesitas una Mac con Apple Silicon (M1 o posterior). Abre la app **Terminal** (⌘ + espacio, escribe "Terminal"), pega esta línea y pulsa Enter:

```bash
curl -fsSL https://raw.githubusercontent.com/JUrielC/letha/master/scripts/install.sh | sh
```

Cuando termine, Letha queda en tu carpeta de **Aplicaciones**: ábrelo con Spotlight (⌘ + espacio, "Letha") o con doble clic.

### ¿Por qué se instala por Terminal?
macOS bloquea las aplicaciones descargadas desde el navegador si no pagan la cuota de desarrollador y notarización de Apple. Lo que se instala desde la Terminal con `uv` no lleva la marca de cuarentena (`com.apple.quarantine`), por lo que se abre sin advertencias de Gatekeeper.

### Actualizar o desinstalar

Para **actualizar**, vuelve a ejecutar el mismo comando de instalación.

Para **desinstalar**:
```bash
uv tool uninstall letha && rm -rf ~/Applications/Letha.app ~/.cache/letha ~/.local/share/letha
```

---

## Desarrollo local

Si quieres clonar el repositorio y modificarlo:

### Requisitos
- [uv](https://docs.astral.sh/uv/) (instalador de Python)
- [Node.js](https://nodejs.org/) o [Bun](https://bun.sh/)
- `swiftc` (incluido en las Command Line Tools de macOS: `xcode-select --install`)

### 1. Backend (FastAPI + PyMuPDF + Edge-TTS)
```bash
cd backend
uv venv --python 3.12 .venv
source .venv/bin/activate
uv pip install -e ".[dev]"
python -m letha.api
```
El servidor backend escuchará en `http://127.0.0.1:47830` con documentación interactiva en `/docs`.

### 2. Frontend (Next.js + Tailwind CSS)
En otra pestaña:
```bash
cd frontend
bun install   # o npm install
bun dev       # o npm run dev
```
Abre `http://localhost:3000` en tu navegador.

### 3. Compilar Release para Distribución
Para generar el paquete empaquetado (Next.js compilado + ventana Swift + wheel de Python):
```bash
./scripts/build-release.sh
```
El archivo distribuible quedará en `dist/letha-<versión>-py3-none-macosx_12_0_arm64.whl`.

---

## Licencia

Distribuido bajo licencia MIT.
