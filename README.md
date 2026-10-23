# Letha

Lector de libros en PDF y audiolibro interactivo para macOS y Windows. Lee tus libros en una interfaz limpia mientras los escuchas narrados con voces neurales ultra-realistas (las mismas que usa Microsoft Edge), con el texto resaltado en tiempo real estilo karaoke.

---

## Características

- **Extracción limpia de PDFs:** Usa `PyMuPDF` para estructurar páginas, detectar la tabla de contenidos (TOC) y filtrar encabezados y números de página que arruinarían la lectura de voz.
- **Voces Neurales Gratuitas:** Integración con `edge-tts`, con decenas de voces humanas de alta fidelidad en inglés, español, francés, italiano y portugués.
- **Efecto Karaoke (Sincronización exacta):** Captura eventos de `SentenceBoundary` para sincronizar y resaltar la frase que se está reproduciendo en cada milisegundo con auto-desplazamiento suave.
- **Navegación Interactiva:** Haz clic en cualquier oración del texto para saltar la reproducción inmediatamente a ese punto exacto.
- **Experiencia de Lectura:** Modos **Claro**, **Sepia cálido** y **Oscuro**, tamaños de tipografía ajustables y control de velocidad de reproducción (0.75x a 2.0x).

---

## Instalación

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

Para **actualizar**, vuelve a ejecutar el mismo comando de instalación de tu sistema.

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

---

## Licencia

Distribuido bajo licencia MIT.
