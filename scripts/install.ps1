# Instala Letha en Windows (Windows 10 / 11):
#
# En PowerShell:
#   irm https://github.com/JUrielC/letha/releases/latest/download/install.ps1 | iex
#
# En CMD (Símbolo del sistema):
#   powershell -ExecutionPolicy Bypass -c "irm https://github.com/JUrielC/letha/releases/latest/download/install.ps1 | iex"
#
# Los textos van sin acentos: GitHub sirve los assets sin charset y Windows PowerShell 5.1 los decodificaría mal.

$ErrorActionPreference = "Stop"
$Repo = "JUrielC/letha"

Write-Host ""
Write-Host "Instalando Letha para Windows..." -ForegroundColor Yellow

# 1. Asegurar que uv esté en el PATH o instalarlo
$UvPaths = @(
    "$env:USERPROFILE\.local\bin",
    "$env:USERPROFILE\.cargo\bin"
)
foreach ($p in $UvPaths) {
    if ((Test-Path $p) -and ($env:Path -notlike "*$p*")) {
        $env:Path = "$p;$env:Path"
    }
}

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host "-> Instalando uv (instalador ultrarrapido de Python)..."
    Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
    foreach ($p in $UvPaths) {
        if ((Test-Path $p) -and ($env:Path -notlike "*$p*")) {
            $env:Path = "$p;$env:Path"
        }
    }
}

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    throw "No se pudo instalar uv. Verifica tu conexion a internet e intentalo de nuevo."
}

# 2. Obtener el wheel de la última release de GitHub
$Wheel = $env:LETHA_WHEEL
if ([string]::IsNullOrWhiteSpace($Wheel)) {
    $Headers = @{ "User-Agent" = "letha-installer" }
    try {
        $Release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers $Headers
        $Asset = $Release.assets | Where-Object { $_.name -like "*.whl" } | Select-Object -First 1
        if ($Asset) { $Wheel = $Asset.browser_download_url }
    } catch {}

    if ([string]::IsNullOrWhiteSpace($Wheel)) {
        try {
            $Releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases?per_page=10" -Headers $Headers
            foreach ($r in $Releases) {
                $Asset = $r.assets | Where-Object { $_.name -like "*.whl" } | Select-Object -First 1
                if ($Asset) {
                    $Wheel = $Asset.browser_download_url
                    break
                }
            }
        } catch {}
    }

    if ([string]::IsNullOrWhiteSpace($Wheel)) {
        throw "No se encontro ninguna version publicada (.whl) en los Releases de $Repo."
    }
}

Write-Host "-> Instalando paquete Letha con uv..."
uv tool install --force --python 3.12 "$Wheel"

# 3. Localizar pythonw.exe dentro del entorno de la herramienta para abrir sin consola negra
$ToolDir = (uv tool dir --color never).Trim()
$Pythonw = Join-Path $ToolDir "letha\Scripts\pythonw.exe"
if (-not (Test-Path $Pythonw)) {
    $Pythonw = Join-Path $ToolDir "letha\Scripts\python.exe"
}
if (-not (Test-Path $Pythonw)) {
    throw "La instalacion finalizo pero no se encontro el ejecutable de Letha en $ToolDir."
}

# 4. Crear accesos directos en el Menú Inicio y en el Escritorio
$WshShell = New-Object -ComObject WScript.Shell
$StartMenuShortcut = Join-Path ([Environment]::GetFolderPath("Programs")) "Letha.lnk"
$DesktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Letha.lnk"

foreach ($ShortcutPath in @($StartMenuShortcut, $DesktopShortcut)) {
    $Shortcut = $WshShell.CreateShortcut($ShortcutPath)
    $Shortcut.TargetPath = $Pythonw
    $Shortcut.Arguments = "-m letha.app"
    $Shortcut.WorkingDirectory = $env:USERPROFILE
    $Shortcut.Description = "Letha - Lector de PDFs y Audiolibro Sincronizado"
    $Shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,21"
    $Shortcut.Save()
}

Write-Host ""
Write-Host "Listo. Letha se ha instalado correctamente:" -ForegroundColor Green
Write-Host "  - Acceso directo en tu Escritorio (Letha)"
Write-Host "  - Acceso directo en tu Menu Inicio (presiona la tecla Windows y escribe 'Letha')"
Write-Host ""
Write-Host "Para desinstalar:"
Write-Host '  uv tool uninstall letha; Remove-Item "$env:USERPROFILE\Desktop\Letha.lnk", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Letha.lnk", "$env:USERPROFILE\.cache\letha", "$env:USERPROFILE\.local\share\letha" -Recurse -Force -ErrorAction SilentlyContinue'

if ([string]::IsNullOrWhiteSpace($env:LETHA_NO_LAUNCH)) {
    Start-Process -FilePath $Pythonw -ArgumentList "-m letha.app"
}
