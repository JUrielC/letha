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
Write-Host "Installing Letha for Windows..." -ForegroundColor Yellow

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
    Write-Host "-> Installing uv (fast Python installer)..."
    Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
    foreach ($p in $UvPaths) {
        if ((Test-Path $p) -and ($env:Path -notlike "*$p*")) {
            $env:Path = "$p;$env:Path"
        }
    }
}

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    throw "uv could not be installed. Check your internet connection and try again."
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
        throw "No published version (.whl) was found in the $Repo releases."
    }
}

Write-Host "-> Installing the Letha package with uv..."
uv tool install --force --python 3.12 "$Wheel"

# 3. Localizar pythonw.exe dentro del entorno de la herramienta para abrir sin consola negra
$ToolDir = (uv tool dir --color never).Trim()
$Pythonw = Join-Path $ToolDir "letha\Scripts\pythonw.exe"
if (-not (Test-Path $Pythonw)) {
    $Pythonw = Join-Path $ToolDir "letha\Scripts\python.exe"
}
if (-not (Test-Path $Pythonw)) {
    throw "The installation finished but the Letha executable was not found in $ToolDir."
}

# 4. Crear accesos directos en el Menú Inicio y en el Escritorio, con el icono de Letha
$Icon = Join-Path $ToolDir "letha\Lib\site-packages\letha\assets\letha.ico"
if (Test-Path $Icon) {
    $IconLocation = "$Icon,0"
} else {
    $IconLocation = "$env:SystemRoot\System32\shell32.dll,21"
}

# Igual que WINDOWS_APP_ID en letha/app.py: así la barra de tareas une la ventana con este acceso directo
$AppId = "app.letha.reader"
if (-not ("LethaShortcut" -as [type])) {
    try {
        Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class LethaShortcut
{
    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore
    {
        void GetCount(out uint count);
        void GetAt(uint index, out PropertyKey key);
        void GetValue(ref PropertyKey key, out PropVariant value);
        void SetValue(ref PropertyKey key, ref PropVariant value);
        void Commit();
    }

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private struct PropertyKey
    {
        public Guid FormatId;
        public uint PropertyId;
    }

    [StructLayout(LayoutKind.Explicit, Size = 24)]
    private struct PropVariant
    {
        [FieldOffset(0)] public ushort Type;
        [FieldOffset(8)] public IntPtr Value;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    private static extern void SHGetPropertyStoreFromParsingName(string path, IntPtr bindContext, int flags, ref Guid iid, out IPropertyStore store);

    public static void SetAppId(string path, string appId)
    {
        Guid iid = typeof(IPropertyStore).GUID;
        IPropertyStore store;
        SHGetPropertyStoreFromParsingName(path, IntPtr.Zero, 2, ref iid, out store);
        PropertyKey key = new PropertyKey { FormatId = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), PropertyId = 5 };
        PropVariant value = new PropVariant { Type = 31, Value = Marshal.StringToCoTaskMemUni(appId) };
        try
        {
            store.SetValue(ref key, ref value);
            store.Commit();
        }
        finally
        {
            Marshal.FreeCoTaskMem(value.Value);
            Marshal.ReleaseComObject(store);
        }
    }
}
"@
    } catch {}
}

$WshShell = New-Object -ComObject WScript.Shell
$StartMenuShortcut = Join-Path ([Environment]::GetFolderPath("Programs")) "Letha.lnk"
$DesktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Letha.lnk"

foreach ($ShortcutPath in @($StartMenuShortcut, $DesktopShortcut)) {
    $Shortcut = $WshShell.CreateShortcut($ShortcutPath)
    $Shortcut.TargetPath = $Pythonw
    $Shortcut.Arguments = "-m letha.app"
    $Shortcut.WorkingDirectory = $env:USERPROFILE
    $Shortcut.Description = "Letha - Synchronized PDF reader and audiobook"
    $Shortcut.IconLocation = $IconLocation
    $Shortcut.Save()
    try { [LethaShortcut]::SetAppId($ShortcutPath, $AppId) } catch {}
}

Write-Host ""
Write-Host "Done. Letha was installed successfully:" -ForegroundColor Green
Write-Host "  - Shortcut on your Desktop (Letha)"
Write-Host "  - Shortcut in your Start menu (press the Windows key and type 'Letha')"
Write-Host ""
Write-Host "To uninstall:"
Write-Host '  uv tool uninstall letha; Remove-Item "$env:USERPROFILE\Desktop\Letha.lnk", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Letha.lnk", "$env:USERPROFILE\.cache\letha", "$env:USERPROFILE\.local\share\letha" -Recurse -Force -ErrorAction SilentlyContinue'

if ([string]::IsNullOrWhiteSpace($env:LETHA_NO_LAUNCH)) {
    Start-Process -FilePath $Pythonw -ArgumentList "-m letha.app"
}
