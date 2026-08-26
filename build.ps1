# Builds a signed, installable .zxp of the Spec Check panel.
# Reuses the Sequence Batch Exporter cert when the sibling repo has one
# (same publisher); otherwise generates a self-signed cert here.
# Output: dist\SpecCheck-v<version>.zxp
$ErrorActionPreference = 'Stop'
$root  = $PSScriptRoot
$tools = "$root\buildtools"
$signCmd = "$tools\ZXPSignCmd.exe"

# 1. ZXPSignCmd (Adobe CEP-Resources, 4.1.3 x64)
if (-not (Test-Path $signCmd)) {
    New-Item -ItemType Directory -Force $tools | Out-Null
    Write-Host "Downloading ZXPSignCmd 4.1.3..."
    Invoke-WebRequest 'https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/ZXPSignCMD/4.1.3/x64/ZXPSignCmd.exe' -OutFile $signCmd
}

# 2. Certificate: prefer SBE's existing publisher cert, else self-sign here
$sbeCert = "$root\..\SequenceBatchExporter\cert\cert.p12"
$sbePass = "$root\..\SequenceBatchExporter\cert\cert-password.txt"
if ((Test-Path $sbeCert) -and (Test-Path $sbePass)) {
    $cert = $sbeCert
    $pass = (Get-Content $sbePass -Raw).Trim()
    Write-Host "Using the Sequence Batch Exporter publisher cert."
} else {
    $cert = "$root\cert\cert.p12"
    $passFile = "$root\cert\cert-password.txt"
    if (-not (Test-Path $cert)) {
        New-Item -ItemType Directory -Force "$root\cert" | Out-Null
        $pass = [Guid]::NewGuid().ToString('N')
        Set-Content $passFile $pass -NoNewline
        Write-Host "Generating self-signed cert (Trevor O'Hare Productions)..."
        & $signCmd -selfSignedCert US MI "Trevor O'Hare Productions" "Trevor O'Hare Productions" $pass $cert
        if ($LASTEXITCODE -ne 0) { throw "cert generation failed" }
    }
    $pass = (Get-Content $passFile -Raw).Trim()
}

# 3. Version from manifest
[xml]$manifest = Get-Content "$root\CSXS\manifest.xml"
$version = $manifest.ExtensionManifest.ExtensionBundleVersion
if (-not $version) { throw "could not read ExtensionBundleVersion from manifest" }

# 4. Stage runtime files only (no ffmpeg - setup downloads it on first run)
$stage = "$root\dist\stage"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item "$root\CSXS" "$stage\" -Recurse
Copy-Item "$root\jsx"  "$stage\" -Recurse
Copy-Item "$root\js"   "$stage\" -Recurse
Copy-Item "$root\index.html" "$stage\"

# 5. Sign with timestamp
$zxp = "$root\dist\SpecCheck-v$version.zxp"
if (Test-Path $zxp) { Remove-Item -Force $zxp }
& $signCmd -sign $stage $zxp $cert $pass -tsa 'http://timestamp.digicert.com'
if ($LASTEXITCODE -ne 0) { throw "signing failed" }

# 6. Verify
& $signCmd -verify $zxp
if ($LASTEXITCODE -ne 0) { throw "verification failed" }

Remove-Item -Recurse -Force $stage
Write-Host "Built $zxp"
Write-Host "Users install it with ZXPInstaller (zxpinstaller.com), then run setup-ffmpeg.ps1 or point the panel at an ffmpeg on PATH."
