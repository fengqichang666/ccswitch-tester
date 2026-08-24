$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $projectRoot

$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$version = [string]$package.version
if ([string]::IsNullOrWhiteSpace($version)) {
  throw 'package.json does not contain a version.'
}

Write-Host "Building CCSwitch Tester v$version ..." -ForegroundColor Cyan
Write-Host ''

function Invoke-DistBuild {
  param([bool]$Offline)

  if ($Offline) {
    $env:ELECTRON_BUILDER_OFFLINE = 'true'
    Write-Host 'Using electron-builder offline cache.' -ForegroundColor DarkYellow
  } else {
    Remove-Item Env:ELECTRON_BUILDER_OFFLINE -ErrorAction SilentlyContinue
  }

  & npm.cmd run dist | Out-Host
  return $LASTEXITCODE
}

$exitCode = Invoke-DistBuild -Offline:$false
if ($exitCode -ne 0) {
  Write-Warning 'Online build failed. Retrying with the local electron-builder cache ...'
  $exitCode = Invoke-DistBuild -Offline:$true
}

if ($exitCode -ne 0) {
  throw "electron-builder failed with exit code $exitCode."
}

$artifactNames = @(
  "CCSwitch-Tester-$version-x64-setup.exe",
  "CCSwitch-Tester-$version-x64-portable.exe"
)
$distRoot = Join-Path $projectRoot 'dist'
$missing = @($artifactNames | Where-Object { -not (Test-Path -LiteralPath (Join-Path $distRoot $_)) })
if ($missing.Count -gt 0) {
  throw "Build completed but these artifacts are missing: $($missing -join ', ')"
}

$releaseRoot = Join-Path $projectRoot 'release'
$latestRoot = Join-Path $releaseRoot "$version-latest"
$targetRoot = $latestRoot
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null

try {
  foreach ($name in $artifactNames) {
    Copy-Item -LiteralPath (Join-Path $distRoot $name) -Destination (Join-Path $targetRoot $name) -Force
  }
} catch {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $targetRoot = Join-Path $releaseRoot "$version-latest-$stamp"
  New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null
  foreach ($name in $artifactNames) {
    Copy-Item -LiteralPath (Join-Path $distRoot $name) -Destination (Join-Path $targetRoot $name) -Force
  }
  Write-Warning "The canonical latest directory was locked. Created $targetRoot instead."
}

$hashLines = foreach ($name in $artifactNames) {
  $file = Join-Path $targetRoot $name
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $digest = $sha256.ComputeHash([System.IO.File]::ReadAllBytes($file))
  } finally {
    $sha256.Dispose()
  }
  $hash = ([System.BitConverter]::ToString($digest) -replace '-', '').ToLowerInvariant()
  "$hash  $name"
}
Set-Content -LiteralPath (Join-Path $targetRoot 'SHA256SUMS.txt') -Value $hashLines -Encoding ascii

$buildInfo = @(
  "CCSwitch Tester v$version"
  "Built: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
  "Artifacts:"
  ($artifactNames | ForEach-Object { "- $_" })
)
Set-Content -LiteralPath (Join-Path $targetRoot 'BUILD-INFO.txt') -Value $buildInfo -Encoding utf8

Write-Host ''
Write-Host 'Build completed successfully.' -ForegroundColor Green
Write-Host "Output: $targetRoot" -ForegroundColor Green
Write-Host ''
Get-ChildItem -LiteralPath $targetRoot -File | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
