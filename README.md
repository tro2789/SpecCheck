# Spec Check

CEP panel for Premiere Pro: measure a mix against a delivery spec (Audible/ACX,
Apple Podcasts, Spotify, broadcast, custom) and show a pass/fail scoreboard.

**Status: Phase 0 spike.** Plan: `~/Repos/docs/plans/premiere-audio-qc-panel.md`
(on the Debian VM). Current code proves two things inside CEP's Node runtime:

1. Spawn ffmpeg/ffprobe and parse the full metric set (integrated LUFS, LRA,
   true peak, overall RMS, sample peak, head/tail silence, format info).
2. Watch-folder completion detection: a new render is "done" when its size is
   stable for 2 s AND an exclusive open succeeds (writer released its lock).

## Spike setup (Windows)

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
powershell -ExecutionPolicy Bypass -File setup-ffmpeg.ps1   # once, ~90 MB
```

Restart Premiere, then **Window > Extensions > Spec Check**.

## Spike protocol

1. Open the panel. Confirm the log shows Node access and the ffmpeg version.
2. Click **Analyze file...** on a finished episode WAV or MP3. Check the
   numbers against RX / your references. Note the analysis time.
3. Enter your normal AME export folder under **Watch folder**, start watching,
   then export any sequence from Premiere via AME into it.
4. Watch the log. The key line reports, for the growing file:
   `size stable 2s (...), exclusive open=OK/BLOCKED <code>`.
   - If open stays BLOCKED until the encode ends: lock-release detection works.
   - If open succeeds while AME is still writing: size stability alone must
     carry completion detection. Either way, the spike answered the question.
5. Anything surprising goes into premiere-uxp-dev-notes.

## Repo

Source of truth: `ssh://gitea@192.168.0.245:2222/tro2789/SpecCheck.git`.
Push there only; a GitHub mirror gets added at first public release.

`tools/` (the ffmpeg download) is gitignored and lives only in the installed
extension dir.
