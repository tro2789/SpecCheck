# Spec Check

CEP panel for Premiere Pro: measure a mix against a delivery spec (Audible/ACX,
Apple Podcasts, Spotify, broadcast, custom) and show a pass/fail scoreboard.

**Status: Phase 3 feature-complete** (pending the Audible Originals
preset numbers). Plan:
`~/Repos/docs/plans/premiere-audio-qc-panel.md` (on the Debian VM).

## How it works

- Every analysis computes the **full metric set**: integrated LUFS, LRA,
  true peak, overall RMS, sample peak, noise floor (quietest 0.5 s
  flat-RMS window), head/tail silence, sample rate, bitrate, channels.
- A **preset is only a checklist** of ranges over those metrics. Switching
  presets re-scores cached results instantly, with no re-analysis. Metrics
  the preset does not check still display, greyed.
- Built-in presets: ACX/Audible, Audible Originals, Apple Podcasts,
  Spotify, EBU R128, YouTube. Custom presets: the gear opens an editor
  (name + checks with min/max per metric), saved in the panel and grouped
  in the dropdown.
- **Check mix** renders the active sequence's audio to a temp WAV via
  Media Encoder (auto-discovered WAV system preset; range: entire /
  in-out / work area) and analyzes it. Optional: a duration sequence
  marker named "roomtone" dragged across a silent section pins the
  noise-floor measurement to exactly that region.
- **Analyze file...** measures picked files directly. **Watch folder**
  (recursive) auto-analyzes every new render that lands, using
  size-stable-2s + lock-release completion detection.
- **Save report** writes `<file>.qc.txt` next to the analyzed file:
  preset, checks with pass/fail, and all measurements.
- `build.ps1` produces a signed `dist\SpecCheck-v<version>.zxp`
  (reuses the SBE publisher cert when the sibling repo is present).

## Setup (Windows)

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
powershell -ExecutionPolicy Bypass -File setup-ffmpeg.ps1   # once, ~90 MB
```

Restart Premiere, then **Window > Extensions > Spec Check**.

## Known limits

- Noise floor is the quietest 0.5 s flat-RMS window above digital
  silence, found automatically - the same units ACX and Audible specify.
  It assumes the program contains at least half a second of room tone.
- Watching stops when the panel closes (CEP panels only run while open).

## Repo

Source of truth: `ssh://gitea@192.168.0.245:2222/tro2789/SpecCheck.git`.
Push there only; a GitHub mirror gets added at first public release.

`tools/` (the ffmpeg download) is gitignored and lives only in the installed
extension dir.
