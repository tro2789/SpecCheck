// Generates the accuracy fixtures with ffmpeg and records reference values
// by running the panel's own ffprobe/ffmpeg commands and parsers on them.
//
//   node scripts/make-fixtures.mjs      (or: npm run fixtures)
//
// Needs ffmpeg 7.1 with libmp3lame; override with FFMPEG=... FFPROBE=...
// Source signals come from a seeded generator, so reruns produce the same
// samples; ffmpeg's muxers and encoders write the files.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { panelParsers } from "./panel-source.mjs";

const FF = process.env.FFMPEG || "/usr/bin/ffmpeg";
const FP = process.env.FFPROBE || "/usr/bin/ffprobe";
const OUT = fileURLToPath(new URL("../test/fixtures/", import.meta.url));

/* ---------- seeded signal generators ---------- */

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const db = (x) => Math.pow(10, x / 20);

/** Uniform noise with the given RMS; peaks stay under RMS * sqrt(3). */
function roomTone(n, rmsDb, seed) {
  const r = rng(seed);
  const a = db(rmsDb) * Math.sqrt(3);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (2 * r() - 1) * a;
  return out;
}

/** Speech-like phrases: voiced syllables (harmonics of a 100-220 Hz pitch)
    and noisy consonants with attack/decay envelopes, word and phrase gaps,
    and a level that changes from phrase to phrase. Added onto `out`. */
function speech(out, sr, from, to, seed, { phraseDb = [-26, -14], gapFill = 0 } = {}) {
  const r = rng(seed);
  let t = from;
  let lp = 0;
  while (t < to) {
    const level = db(phraseDb[0] + r() * (phraseDb[1] - phraseDb[0]));
    const words = 3 + Math.floor(r() * 5);
    for (let w = 0; w < words && t < to; w++) {
      const syl = 1 + Math.floor(r() * 3);
      for (let s = 0; s < syl && t < to; s++) {
        const len = Math.floor(sr * (0.09 + r() * 0.17));
        const f0 = 100 + r() * 120;
        const voiced = r() < 0.75;
        const att = Math.floor(sr * 0.015);
        const dec = Math.floor(sr * 0.04);
        for (let i = 0; i < len && t + i < to; i++) {
          const env = Math.min(1, i / att, (len - i) / dec);
          let v = 0;
          if (voiced) {
            const ph = (2 * Math.PI * f0 * i) / sr;
            for (let k = 1; k <= 12; k++) v += Math.sin(k * ph + k) / k;
            v *= 0.5;
          } else {
            lp = 0.6 * lp + 0.4 * (2 * r() - 1);
            v = (2 * r() - 1) - lp;
            v *= 0.6;
          }
          out[t + i] += v * env * level;
        }
        t += len;
      }
      t += Math.floor(sr * (0.03 + r() * 0.12));
    }
    const gap = Math.floor(sr * (0.3 + r() * 0.5));
    if (gapFill) for (let i = t; i < Math.min(t + gap, to); i++) out[i] = gapFill * (2 * r() - 1);
    t += gap;
  }
  return out;
}

const interleave = (...chans) => {
  const n = chans[0].length;
  const out = new Float32Array(n * chans.length);
  chans.forEach((c, k) => { for (let i = 0; i < n; i++) out[i * chans.length + k] = c[i]; });
  return out;
};

/* ---------- fixtures ---------- */

const sine = (sr, secs, freq, amp, phase = 0) => {
  const out = new Float32Array(Math.round(sr * secs));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr + phase);
  return out;
};

function speechMono44k() {
  // 10 s of speech with digital-silence pauses and a quieter last phrase.
  const sr = 44100;
  const x = new Float32Array(sr * 10);
  speech(x, sr, 0, sr * 7, 11);
  speech(x, sr, sr * 7, sr * 10, 12, { phraseDb: [-38, -32] });
  return x;
}

function roomToneProgram(sr, seed, secs, voices) {
  // 2 s of -65 dB room tone, speech over the bed, 1.5 s of room tone.
  // The length leaves a partial final 0.5 s window, which ffmpeg pads.
  const n = Math.round(sr * secs);
  return Array.from({ length: voices }, (_, v) => {
    const x = roomTone(n, -65, seed + v);
    speech(x, sr, sr * 2, n - Math.round(sr * 1.5), seed + 10 + v, { phraseDb: [-24, -16] });
    return x;
  });
}

const FIXTURES = [
  {
    file: "sine-1k-stereo-48k-s16.wav", sr: 48000, ch: 2, args: ["-c:a", "pcm_s16le"],
    // EBU Tech 3341 case 1: stereo 1 kHz sine at -23 dBFS reads -23.0 LUFS.
    gen: () => { const s = sine(48000, 3.5, 1000, db(-23)); return interleave(s, s); },
  },
  {
    file: "speech-mono-44k-s16.wav", sr: 44100, ch: 1, args: ["-c:a", "pcm_s16le"],
    gen: speechMono44k,
  },
  {
    file: "speech-mono-44k-cbr192.mp3", sr: 44100, ch: 1, args: ["-c:a", "libmp3lame", "-b:a", "192k"],
    gen: speechMono44k,
  },
  {
    file: "roomtone-mono-48k-s24.wav", sr: 48000, ch: 1, args: ["-c:a", "pcm_s24le"],
    gen: () => roomToneProgram(48000, 21, 6.3, 1)[0],
  },
  {
    file: "roomtone-stereo-48k-vbr.mp3", sr: 48000, ch: 2, args: ["-c:a", "libmp3lame", "-q:a", "2"],
    gen: () => interleave(...roomToneProgram(48000, 31, 6.7, 2)),
  },
  {
    // fs/4 sine at 45 degrees: samples sit at 0.707 of the waveform peak,
    // so the true peak is ~3 dB above the sample peak. Also < 3 s long.
    file: "isp-mono-44k-f32.wav", sr: 44100, ch: 1, args: ["-c:a", "pcm_f32le"],
    gen: () => sine(44100, 2.0, 11025, 0.9, Math.PI / 4),
  },
  {
    file: "silence-mono-48k-s16.wav", sr: 48000, ch: 1, args: ["-c:a", "pcm_s16le"],
    gen: () => new Float32Array(48000),
  },
  {
    file: "speech-stereo-16k-s32.wav", sr: 16000, ch: 2, args: ["-c:a", "pcm_s32le"],
    gen: () => {
      const a = speech(new Float32Array(16000 * 3), 16000, 0, 16000 * 3, 41);
      const b = speech(new Float32Array(16000 * 3), 16000, 0, 16000 * 3, 42);
      return interleave(a, b);
    },
  },
  {
    file: "speech-mono-16k-f64.wav", sr: 16000, ch: 1, args: ["-c:a", "pcm_f64le"],
    gen: () => speech(new Float32Array(16000 * 3), 16000, 0, 16000 * 3, 51, { gapFill: db(-70) }),
  },
];

/* ---------- the panel's measurement, verbatim in its steps ---------- */

const { parseEbur128, parseAstats, parseSilence } = panelParsers();

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.error) throw r.error;
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

function measure(file) {
  const metrics = {};
  const info = JSON.parse(run(FP, ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", file]).stdout);
  const a = (info.streams || []).filter((s) => s.codec_type === "audio")[0] || {};
  const f = info.format || {};
  metrics.duration = parseFloat(f.duration) || null;
  metrics.sampleRateHz = a.sample_rate ? parseInt(a.sample_rate, 10) : null;
  metrics.channels = a.channels || null;
  metrics.codec = a.codec_name || "?";
  const br = parseInt(a.bit_rate || f.bit_rate, 10);
  metrics.bitrateKbps = isNaN(br) ? null : Math.round(br / 1000);

  let r = run(FF, ["-nostats", "-i", file, "-map", "0:a:0", "-af", "ebur128=peak=true", "-f", "null", "-"]);
  const e = parseEbur128(r.stderr);
  metrics.lufsI = e.lufsI; metrics.lra = e.lra;
  metrics.truePeak = e.truePeak; metrics.minMomentary = e.minMomentary;

  r = run(FF, ["-nostats", "-i", file, "-map", "0:a:0", "-af", "astats=measure_perchannel=none", "-f", "null", "-"]);
  const s = parseAstats(r.stderr);
  metrics.rmsDb = s.rmsDb; metrics.samplePeakDb = s.samplePeakDb;

  const n = Math.round((metrics.sampleRateHz || 48000) / 2);
  r = run(FF, ["-nostats", "-i", file, "-map", "0:a:0",
    "-af", "silencedetect=n=-60dB:d=1" +
      ",asetnsamples=n=" + n +
      ",astats=metadata=1:reset=1:measure_perchannel=none" +
      ",ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=-",
    "-f", "null", "-"]);
  const sil = parseSilence(r.stderr, metrics.duration);
  metrics.headSilence = sil.headSilence; metrics.tailSilence = sil.tailSilence;
  let best = null;
  const reW = /RMS_level=(-?[\d.]+)/g;
  let mW;
  while ((mW = reW.exec(r.stdout)) !== null) {
    const vW = parseFloat(mW[1]);
    if (vW > -100 && (best === null || vW < best)) best = vW;
  }
  metrics.noiseFloor = best !== null ? best : metrics.minMomentary;
  return metrics;
}

/* ---------- main ---------- */

const version = run(FF, ["-version"]).stdout.split("\n")[0];
if (!/^ffmpeg version 7\.1/.test(version)) {
  console.warn(`warning: reference values should come from ffmpeg 7.1, found "${version}"`);
}
fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "speccheck-fixtures-"));
const reference = { ffmpeg: version, fixtures: [] };
try {
  for (const fx of FIXTURES) {
    const raw = path.join(tmp, "src.f32");
    fs.writeFileSync(raw, Buffer.from(fx.gen().buffer));
    const dest = path.join(OUT, fx.file);
    const r = run(FF, ["-v", "error", "-y", "-f", "f32le", "-ar", String(fx.sr), "-ac", String(fx.ch),
      "-i", raw, ...fx.args, dest]);
    if (r.status !== 0) throw new Error(`ffmpeg failed for ${fx.file}: ${r.stderr}`);
    const metrics = measure(dest);
    reference.fixtures.push({ file: fx.file, metrics });
    console.log(fx.file, `${(fs.statSync(dest).size / 1024).toFixed(0)} KB`, JSON.stringify(metrics));
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
fs.writeFileSync(path.join(OUT, "reference.json"), JSON.stringify(reference, null, 2) + "\n");
