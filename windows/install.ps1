# SPDX-License-Identifier: MIT
[CmdletBinding()]
param(
    [ValidateSet('menu','install','launch','status','restore','logs')]
    [string]$Action='menu',
    [Alias('app')][string]$AppPath='',
    [switch]$Help
)
Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
if ($Help) {
    Write-Host 'Docker Desktop на русском. Запуск: powershell -ExecutionPolicy Bypass -File .\docker_ru.ps1'
    Write-Host 'Меню: 1 — установить, 2 — открыть, 3 — статус, 4 — удалить, 5 — журнал, 0 — выход.'
    Write-Host 'Нужен Node.js 18+ с https://nodejs.org/. Запускайте от обычного пользователя.'
    exit 0
}
$TaskNode=Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $TaskNode) { throw 'Node.js не найден. Установите LTS с https://nodejs.org/, затем откройте PowerShell заново.' }
& $TaskNode.Source -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)'
if ($LASTEXITCODE -ne 0) { throw 'Нужен Node.js 18 или новее.' }
$TaskScriptDir=Split-Path -Parent $MyInvocation.MyCommand.Path
$TaskCore=Join-Path (Split-Path -Parent $TaskScriptDir) 'core'
$TaskControl=Join-Path $TaskCore 'control.cjs'
if (-not (Test-Path -LiteralPath $TaskControl)) {$TaskCore=Join-Path $TaskScriptDir 'core';$TaskControl=Join-Path $TaskCore 'control.cjs'}
$TaskTemp=$null
$TaskExit=1
try {
    if (-not (Test-Path -LiteralPath $TaskControl)) {
        [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
        $TaskTemp=Join-Path ([IO.Path]::GetTempPath()) ('docker_ru_'+[Guid]::NewGuid().ToString('N'))
        $TaskCore=Join-Path $TaskTemp 'core'
        New-Item -ItemType Directory -Path $TaskCore | Out-Null
        Write-Host 'Загружаю русификатор Docker из GitHub…'
        $TaskCommit=Invoke-RestMethod -Uri 'https://api.github.com/repos/fadeichev2121/docker-russian/commits/main' -Headers @{'User-Agent'='docker-russian-installer'}
        $TaskSHA=$TaskCommit.sha
        if ($TaskSHA -notmatch '^[a-f0-9]{40}$') {throw 'GitHub вернул некорректную версию.'}
        foreach ($file in @('control.cjs','launcher.cjs','cdp-pipe.cjs','ui-runtime.js','ru.json')) {
            Invoke-WebRequest -Uri "https://raw.githubusercontent.com/fadeichev2121/docker-russian/$TaskSHA/core/$file" -OutFile (Join-Path $TaskCore $file) -UseBasicParsing
        }
        $TaskControl=Join-Path $TaskCore 'control.cjs'
    }
    $TaskArgs=@($TaskControl,$Action)
    if ($AppPath) {$TaskArgs+=@('--app',$AppPath)}
    & $TaskNode.Source @TaskArgs
    $TaskExit=$LASTEXITCODE
} finally {
    if ($TaskTemp -and (Test-Path -LiteralPath $TaskTemp)) {Remove-Item -LiteralPath $TaskTemp -Recurse -Force}
}
exit $TaskExit
