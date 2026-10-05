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
    Write-Host 'Node.js вручную ставить не нужно: служебные файлы загрузятся автоматически. Запускайте от обычного пользователя.'
    exit 0
}
function Assert-RuntimePath([string]$Target) {
    $part=[IO.Path]::GetFullPath($Target)
    while ($part) {
        if (Test-Path -LiteralPath $part) {
            $item=Get-Item -LiteralPath $part -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {throw "Папка служебных файлов содержит ссылку: $part"}
        }
        $parent=Split-Path -Parent $part
        if ($parent -eq $part) {break}
        $part=$parent
    }
}
function Get-PrivateNode {
    $arch=$env:PROCESSOR_ARCHITEW6432
    if (-not $arch) {$arch=$env:PROCESSOR_ARCHITECTURE}
    switch ($arch) {'ARM64' {$arch='arm64'} 'AMD64' {$arch='x64'} default {throw 'Автоматическая загрузка доступна только для ARM64 и x64.'}}
    $base=$env:LOCALAPPDATA
    if (-not $base) {$base=Join-Path $env:USERPROFILE 'AppData\Local'}
    $root=Join-Path $base 'docker-russian-runtime'
    Assert-RuntimePath $root
    $owner=Join-Path $root 'owner'
    if (Test-Path -LiteralPath $root) {
        Assert-RuntimePath $owner
        if (-not (Test-Path -LiteralPath $owner -PathType Leaf) -or (Get-Content -LiteralPath $owner -Raw).Trim() -ne 'docker-russian-node-runtime-v1') {throw "Каталог не принадлежит русификатору: $root"}
        $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        $actualOwner=([Security.Principal.NTAccount]::new((Get-Acl -LiteralPath $root).Owner)).Translate([Security.Principal.SecurityIdentifier]).Value
        if ($sid -ne $actualOwner) {throw 'Каталог служебных файлов принадлежит другому пользователю.'}
    } else {
        New-Item -ItemType Directory -Path $root | Out-Null
        Set-Content -LiteralPath $owner -Value 'docker-russian-node-runtime-v1' -Encoding ASCII
    }
    $current=Join-Path $root 'current.json'
    Assert-RuntimePath $current
    if (Test-Path -LiteralPath $current -PathType Leaf) {
        $saved=Get-Content -LiteralPath $current -Raw | ConvertFrom-Json
        if ($saved.sha -notmatch '^[a-f0-9]{64}$' -or $saved.path -notmatch '^node-v24\.[0-9]+\.[0-9]+-win-(arm64|x64)-[a-f0-9]+\\node.exe$') {throw 'Некорректные сведения о служебных файлах.'}
        $exe=Join-Path $root $saved.path;Assert-RuntimePath $exe
        if (-not (Test-Path -LiteralPath $exe -PathType Leaf) -or (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $saved.sha) {throw 'Служебная копия Node.js повреждена: контрольная сумма SHA-256 не совпадает.'}
        return $exe
    }
    $temp=Join-Path ([IO.Path]::GetTempPath()) ('docker_ru_node_'+[Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $temp | Out-Null
    try {
        [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
        Write-Host 'Готовлю служебные файлы — Node.js вручную устанавливать не нужно…'
        $sums=(Invoke-WebRequest -Uri 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt' -UseBasicParsing -TimeoutSec 180).Content
        $matchesFound=@([regex]::Matches($sums,"(?m)^([a-f0-9]{64})\s+(node-v24\.\d+\.\d+-win-$arch\.zip)\s*$"))
        if ($matchesFound.Count -ne 1) {throw 'Официальный сайт вернул некорректные сведения о Node.js.'}
        $expected=$matchesFound[0].Groups[1].Value;$archive=$matchesFound[0].Groups[2].Value
        $name=$archive.Substring(0,$archive.Length-4);$version=$name.Split('-')[1]
        $zip=Join-Path $temp 'node.zip'
        Invoke-WebRequest -Uri "https://nodejs.org/dist/$version/$archive" -OutFile $zip -UseBasicParsing -TimeoutSec 300
        if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {throw 'Контрольная сумма SHA-256 не совпадает. Служебные файлы не запускались.'}
        # Extract only these two known entries, never paths supplied by the ZIP.
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $package=Join-Path $root ($name+'-'+[Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $package | Out-Null
        $handle=[IO.Compression.ZipFile]::OpenRead($zip)
        try {
            foreach ($leaf in @('node.exe','LICENSE')) {
                $entry=$handle.GetEntry("$name/$leaf")
                if (-not $entry) {throw 'В архиве нет служебных файлов.'}
                [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,(Join-Path $package $leaf),$false)
            }
        } finally {$handle.Dispose()}
        $exe=Join-Path $package 'node.exe'
        $record=@{path=(Split-Path -Leaf $package)+'\node.exe';sha=(Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()} | ConvertTo-Json
        $newCurrent=Join-Path $root ('current-'+[Guid]::NewGuid().ToString('N')+'.tmp')
        Set-Content -LiteralPath $newCurrent -Value $record -Encoding ASCII
        Move-Item -LiteralPath $newCurrent -Destination $current
        return $exe
    } finally {if (Test-Path -LiteralPath $temp) {Remove-Item -LiteralPath $temp -Recurse -Force}}
}
function Test-CompatibleNode([string]$Executable) {
    $previous=$ErrorActionPreference
    try {
        # Windows PowerShell 5.1 otherwise treats native stderr as terminating.
        $ErrorActionPreference='Continue'
        & $Executable -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' 2>$null | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch {return $false} finally {$ErrorActionPreference=$previous}
}
$TaskNodePath=$null
$TaskNode=Get-Command node.exe -ErrorAction SilentlyContinue
if ($TaskNode) {
    if (Test-CompatibleNode $TaskNode.Source) {$TaskNodePath=$TaskNode.Source}
}
if (-not $TaskNodePath) {$TaskNodePath=Get-PrivateNode}
if (-not (Test-CompatibleNode $TaskNodePath)) {throw 'Служебные файлы не запускаются на этой системе. См. раздел ошибок в README.'}
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
    & $TaskNodePath @TaskArgs
    $TaskExit=$LASTEXITCODE
} finally {
    if ($TaskTemp -and (Test-Path -LiteralPath $TaskTemp)) {Remove-Item -LiteralPath $TaskTemp -Recurse -Force}
}
exit $TaskExit
