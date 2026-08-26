# Downloads a version-pinned ffmpeg (essentials build, includes ffprobe) into the
# INSTALLED extension dir so the panel finds it at tools\ffmpeg\bin\ffmpeg.exe.
# Run once after install.ps1. ~90 MB download.
$ErrorActionPreference = "Stop"

$version = "8.1.2"
$urls = @(
    "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-$version-essentials_build.zip",
    "https://github.com/GyanD/codexffmpeg/releases/download/$version/ffmpeg-$version-essentials_build.zip"
)

$dest = "$env:APPDATA\Adobe\CEP\extensions\com.tohare.speccheck\tools\ffmpeg"
if (Test-Path "$dest\bin\ffmpeg.exe") {
    Write-Host "ffmpeg already present at $dest - nothing to do."
    exit 0
}

$zip = Join-Path $env:TEMP "ffmpeg-$version-essentials_build.zip"
$ok = $false
foreach ($u in $urls) {
    try {
        Write-Host "Downloading $u ..."
        Invoke-WebRequest -Uri $u -OutFile $zip -UseBasicParsing
        $ok = $true; break
    } catch { Write-Warning "Failed: $u" }
}
if (-not $ok) { throw "Could not download ffmpeg $version from any mirror." }

$tmp = Join-Path $env:TEMP "ffmpeg-extract"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive $zip -DestinationPath $tmp

$inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
Move-Item $inner.FullName $dest -Force
Remove-Item $zip -Force

& "$dest\bin\ffmpeg.exe" -version | Select-Object -First 1
Write-Host "ffmpeg $version installed to $dest"
