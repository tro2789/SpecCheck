/* The analyzer reads files in chunks: results must not depend on where
   the chunks split, and memory must not grow with the length of the file. */

import { describe, expect, it } from "vitest";
import { Analyzer } from "../src/analysis/analyzer";
import type { ProbeInfo, StreamFormat } from "../src/analysis/types";
import { analyzeFile } from "../src/analyze-file";
import { fixtureReader } from "./helpers";

const probe = (sr: number, ch: number, seconds: number): ProbeInfo => ({
  codec: "test", sampleRateHz: sr, channels: ch, bitrateKbps: null, duration: seconds,
});

/** 7 s of stereo noise bursts over near-silence, with a hard edge at the
    start so the true-peak start-up path matters. */
function signal(sr: number): Float64Array {
  const n = sr * 7;
  const out = new Float64Array(n * 2);
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647 - 0.5;
  };
  for (let i = 0; i < n; i++) {
    const burst = Math.floor(i / (sr * 0.35)) % 3 !== 2 && i > sr * 1.5 && i < sr * 5.5;
    const g = burst ? 0.6 : 0.0008;
    out[2 * i] = rnd() * g;
    out[2 * i + 1] = rnd() * g * 0.7;
  }
  return out;
}

function runChunked(data: Float64Array, fmt: StreamFormat, frames: number) {
  const a = new Analyzer(fmt);
  const total = data.length / fmt.channels;
  for (let f = 0; f < total; f += frames) {
    const n = Math.min(frames, total - f);
    a.push(data.subarray(f * fmt.channels, (f + n) * fmt.channels), n);
  }
  return a.finish(probe(fmt.sampleRate, fmt.channels, total / fmt.sampleRate));
}

describe("chunk-size independence", () => {
  for (const sr of [48000, 44100]) {
    it(`analyzer core gives identical results for any chunk size (${sr} Hz)`, () => {
      const data = signal(sr);
      const fmt: StreamFormat = { sampleRate: sr, channels: 2, sampleFormat: "flt", weights: [1, 1] };
      const whole = runChunked(data, fmt, data.length / 2);
      expect(whole.lufsI).not.toBeNull();
      expect(whole.headSilence).toBeGreaterThan(1);
      for (const frames of [1, 7, 33, 4096, 65536]) {
        expect(runChunked(data, fmt, frames), `${frames} frames per chunk`).toEqual(whole);
      }
    });
  }

  for (const file of ["roomtone-mono-48k-s24.wav", "speech-stereo-16k-s32.wav", "roomtone-stereo-48k-vbr.mp3"]) {
    it(`file reads give identical results for any byte chunk size (${file})`, async () => {
      const results = [];
      for (const chunkBytes of [7, 1001, 65536, 1 << 20]) {
        const { read, size, close } = fixtureReader(file);
        results.push(await analyzeFile(read, size, { chunkBytes }).finally(close));
      }
      for (const r of results.slice(1)) expect(r).toEqual(results[0]);
    });
  }
});

describe("long streams", () => {
  it("analyzes 20 minutes of 48 kHz stereo with bounded memory", () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    const heap = (): number => {
      gc?.();
      return process.memoryUsage().heapUsed;
    };
    const sr = 48000;
    const frames = 48000;
    const chunk = new Float64Array(frames * 2);
    let seed = 3;
    for (let i = 0; i < chunk.length; i++) {
      seed = (seed * 16807) % 2147483647;
      chunk[i] = seed / 2147483647 - 0.5;
    }
    const quiet = chunk.map((v) => v * 0.05);
    const a = new Analyzer({ sampleRate: sr, channels: 2, sampleFormat: "flt", weights: [1, 1] });
    const seconds = 20 * 60;
    let base = 0;
    let maxGrowth = 0;
    for (let s = 0; s < seconds; s++) {
      a.push(s % 3 === 0 ? quiet : chunk, frames);
      if (s === 60) base = heap();
      if (s > 60 && s % 300 === 0) maxGrowth = Math.max(maxGrowth, heap() - base);
    }
    const m = a.finish(probe(sr, 2, seconds));
    maxGrowth = Math.max(maxGrowth, heap() - base);
    // 20 minutes of stereo samples would be 921 MB as doubles; the analyzer
    // keeps a few seconds of history at most.
    expect(a.framesProcessed).toBe(seconds * sr);
    expect(maxGrowth).toBeLessThan(8 * 2 ** 20);
    expect(m.lufsI).not.toBeNull();
    expect(m.truePeak).not.toBeNull();
  });
});
