# Spec Check (web)

Browser version of Spec Check: measures a WAV or MP3 against a delivery spec
(ACX / Audible, Audible Originals, Apple Podcasts, Spotify, EBU R128,
YouTube) and shows a pass/fail scoreboard. Decoding and analysis run in a Web
Worker. The file is read in slices and never uploaded.

## Run

```sh
npm install
npm run dev        # local dev server
npm run build      # static site in dist/
npm run preview    # serve dist/
npm run typecheck
npm test
```

Public URL: https://www.trevorohare.com/spec-check. trevorohare.com proxies
`/spec-check` and `/spec-check/*` to this Vercel project (rewrites in that
repo's `vercel.json`). The build uses `base: "/spec-check/"` because
trevorohare.com strips trailing slashes, which breaks relative asset URLs.
`web/vercel.json` maps `/spec-check/*` back to the built files, so the
project's own `.vercel.app` URL works too. On Vercel the Root Directory is
`web`; the ignored-build command skips deploys for commits that do not touch
`web/`. `public/licenses.txt` carries the MP3 decoder's MIT and LGPL-2.1
notices (linked from the footer); update it if the decoder changes.
The inline script and style in `index.html` finish trevorohare.com's page
transition (`SlateCut.tsx` there sets a `slate-arrive` sessionStorage flag
before it loads this page); keep its color and timing in step with that file.

## How it matches the panel

The panel measures with ffmpeg and parses ffmpeg's printed output. The web
version reimplements the same filters in TypeScript (`src/analysis/`), ported
from the ffmpeg 7.1 sources, and rounds each value the way ffmpeg prints it
before scoring:

- `ebur128=peak=true`: integrated loudness, LRA, momentary loudness, and true
  peak through a port of libswresample's 192 kHz polyphase resampler.
- `astats=measure_perchannel=none`: overall RMS and sample peak.
- `silencedetect=n=-60dB:d=1`: head and tail silence, read by the panel's
  `parseSilence` rules.
- Quietest 0.5 s window (`asetnsamples` with its zero-padded last window,
  `astats=metadata=1:reset=1`) for the noise floor.
- ffprobe semantics for duration, bitrate, sample rate, channels, and codec.

MP3 is decoded with [`mpg123-decoder`](https://www.npmjs.com/package/mpg123-decoder)
(WASM build of libmpg123). Its gapless mode trims the LAME encoder delay and
padding the same way ffmpeg does.

`src/presets.ts` holds the built-in specs and metric definitions;
`src/evaluate.ts` is a port of the panel's `score()` and `fmtVal()`. The tests
fail if either drifts from `../js/main.js`.

## Tests

`npm test` runs offline:

- `test/accuracy.test.ts` (release gate): every metric on every fixture
  against reference values from ffmpeg 7.1, with fixed tolerances.
- `test/presets.test.ts`: presets and metric definitions equal the panel's;
  scoring and formatting equal the panel's own `score()` and `fmtVal()`,
  extracted from `../js/main.js` and run in Node.
- `test/streaming.test.ts`: identical results for any chunk size, and bounded
  memory over a 20-minute stream.

## Regenerate fixtures

```sh
npm run fixtures   # node scripts/make-fixtures.mjs
```

Needs ffmpeg 7.1 with libmp3lame at `/usr/bin/ffmpeg` and `/usr/bin/ffprobe`
(override with `FFMPEG=` and `FFPROBE=`). The script writes the files in
`test/fixtures/` from seeded signals, runs the panel's exact ffprobe/ffmpeg
commands on each, parses the output with the panel's own parsers, and writes
`test/fixtures/reference.json`.
