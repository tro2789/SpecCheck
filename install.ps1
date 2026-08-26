# Installs/updates the Spec Check CEP panel for the current user.
# Re-run after any code change, then restart Premiere.
$src  = $PSScriptRoot
$dest = "$env:APPDATA\Adobe\CEP\extensions\com.tohare.speccheck"

New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item "$src\CSXS" "$dest\" -Recurse -Force
Copy-Item "$src\jsx"  "$dest\" -Recurse -Force
Copy-Item "$src\js"   "$dest\" -Recurse -Force
Copy-Item "$src\index.html" "$dest\" -Force

# Unsigned panels need PlayerDebugMode (already 1 on this machine, but keep idempotent)
foreach ($v in '11','12') {
    $key = "HKCU:\Software\Adobe\CSXS.$v"
    if (-not (Test-Path $key)) { New-Item $key -Force | Out-Null }
    Set-ItemProperty $key -Name PlayerDebugMode -Value '1' -Type String
}

Write-Host "Installed to $dest"
Write-Host "If ffmpeg is not set up yet, run setup-ffmpeg.ps1 next."
Write-Host "Then restart Premiere - Window > Extensions > Spec Check"
