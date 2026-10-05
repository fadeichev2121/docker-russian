# MIT License
# Copyright (c) 2026 fadeichev2121
# Docker Desktop Russian Localizer - Windows PowerShell Installer
[CmdletBinding()]
param(
    [ValidateSet('menu', 'install', 'status', 'restore')]
    [string]$Action = 'menu',
    [Alias('app')]
    [string]$AppPath = '',
    [switch]$Help
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$env:PYTHONIOENCODING = 'utf-8'

$OWNER = 'fadeichev2121'
$REPO = 'docker-russian'
$BRANCH = 'main'

function Show-Usage {
    Write-Host @"
===========================================================
     Русский интерфейс для Docker Desktop (Windows)
===========================================================

Использование:
  powershell -ExecutionPolicy Bypass -File .\install.ps1            — интерактивное меню
  powershell -ExecutionPolicy Bypass -File .\install.ps1 install    — установить русификатор
  powershell -ExecutionPolicy Bypass -File .\install.ps1 status     — проверить статус
  powershell -ExecutionPolicy Bypass -File .\install.ps1 restore    — вернуть оригинальный английский
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -Help      — эта справка

Параметры:
  -AppPath ПУТЬ  — указать путь к каталогу Docker Desktop вручную.

Требования:
  Windows 10/11, PowerShell 5.1+, установленный Docker Desktop и Python 3.9+.
  Перед установкой или откатом полностью закройте Docker Desktop.
"@
}

if ($Help) {
    Show-Usage
    exit 0
}

function Find-Python {
    $commands = @('py.exe', 'python.exe', 'python3.exe')
    foreach ($cmd in $commands) {
        $path = (Get-Command $cmd -ErrorAction SilentlyContinue)
        if ($path) {
            try {
                $ver = & $cmd -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
                if ($LASTEXITCODE -eq 0 -and $ver) {
                    $parts = $ver.Split('.')
                    if ([int]$parts[0] -ge 3 -and [int]$parts[1] -ge 9) {
                        return $cmd
                    }
                }
            } catch { }
        }
    }
    throw "Python 3.9+ не найден. Установите Python с python.org (отметьте 'Add Python to PATH') и повторите попытку."
}

function Assert-Administrator {
    $currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    $isAdmin = $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Warning "Для изменения файлов в Program Files могут потребоваться права администратора."
        Write-Host "Если возникнет ошибка доступа, запустите PowerShell от имени Администратора." -ForegroundColor Yellow
    }
}

$PYTHON = Find-Python

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$CoreDir = Join-Path (Split-Path -Parent $ScriptDir) "core"
$PatchPy = Join-Path $CoreDir "patch.py"

# Support running directly from windows/ folder or standalone
if (-not (Test-Path $PatchPy)) {
    $LocalCore = Join-Path $ScriptDir "core"
    $PatchPy = Join-Path $LocalCore "patch.py"
}

# If downloaded as a single standalone script, fetch required core files from GitHub
if (-not (Test-Path $PatchPy)) {
    $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("docker_ru_" + [System.Guid]::NewGuid().ToString().Substring(0, 8))
    New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
    $CoreTemp = Join-Path $TempDir "core"
    New-Item -ItemType Directory -Path $CoreTemp -Force | Out-Null

    Write-Host "Загрузка компонентов русификатора из GitHub..." -ForegroundColor Cyan
    $baseUrl = "https://raw.githubusercontent.com/$OWNER/$REPO/$BRANCH/core"
    Invoke-WebRequest -Uri "$baseUrl/asar.py" -OutFile (Join-Path $CoreTemp "asar.py") -UseBasicParsing
    Invoke-WebRequest -Uri "$baseUrl/ui-runtime.js" -OutFile (Join-Path $CoreTemp "ui-runtime.js") -UseBasicParsing
    Invoke-WebRequest -Uri "$baseUrl/ru.json" -OutFile (Join-Path $CoreTemp "ru.json") -UseBasicParsing
    Invoke-WebRequest -Uri "$baseUrl/patch.py" -OutFile (Join-Path $CoreTemp "patch.py") -UseBasicParsing

    $PatchPy = Join-Path $CoreTemp "patch.py"
}

Assert-Administrator

if ($Action -eq 'menu') {
    Clear-Host
    Write-Host "===========================================================" -ForegroundColor Cyan
    Write-Host "       Русский интерфейс для Docker Desktop (Windows)       " -ForegroundColor White
    Write-Host "===========================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Выберите действие:"
    Write-Host "  1) Установить русский язык" -ForegroundColor Green
    Write-Host "  2) Проверить статус" -ForegroundColor Yellow
    Write-Host "  3) Восстановить оригинальный английский интерфейс" -ForegroundColor Magenta
    Write-Host "  0) Выход"
    Write-Host ""
    $choice = Read-Host "Введите номер [1-3, 0]"
    switch ($choice) {
        '1' { $Action = 'install' }
        '2' { $Action = 'status' }
        '3' { $Action = 'restore' }
        '0' { exit 0 }
        default {
            Write-Error "Неверный выбор."
            exit 1
        }
    }
}

$pyArgs = @($PatchPy, $Action)
if ($AppPath -and $AppPath.Trim() -ne '') {
    $pyArgs += @('--app', $AppPath)
}

& $PYTHON @pyArgs
