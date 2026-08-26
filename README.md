# Spec Check

CEP panel for Premiere Pro: measure a mix against a delivery spec (Audible/ACX,
Apple Podcasts, Spotify, broadcast, custom) and show a pass/fail scoreboard.

**Status: Phase 1** (Phase 0 spike passed 2026-08-26). Plan:
`~/Repos/docs/plans/premiere-audio-qc-panel.md` (on the Debian VM).

## How it works

- Every analysis computes the **full metric set**: integrated LUFS, LRA,
  true peak, overall RMS, sample peak, min-momentary (noise-floor
  approximation), head/tail silence, sample rate, bitrate, channels.
- A **preset is only a checklist** of ranges over those metrics. Switching
  presets re-scores cached results instantly, with no re-analysis. Metrics
  the preset does not check still display, greyed.
- Built-in presets: ACX/Audible, Apple Podcasts, Spotify, EBU R128,
  YouTube. Custom presets and a QC report file come in Phase 3.
- **Analyze file...** measures picked files directly. **Watch folder**
  (recursive) auto-analyzes every new render that lands, using
  size-stable-2s + lock-release completion detection.

## Setup (Windows)

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
powershell -ExecutionPolicy Bypass -File setup-ffmpeg.ps1   # once, ~90 MB
```

Restart Premiere, then **Window > Extensions > Spec Check**.

## Known limits

- Noise floor is approximated as the quietest momentary (400 ms) loudness
  window above digital silence, not a marked room-tone region. Good enough
  to flag ACX problems; the exact room-tone measurement comes later.
- Watching stops when the panel closes (CEP panels only run while open).

## Repo

Source of truth: `ssh://gitea@192.168.0.245:2222/tro2789/SpecCheck.git`.
Push there only; a GitHub mirror gets added at first public release.

`tools/` (the ffmpeg download) is gitignored and lives only in the installed
extension dir.
