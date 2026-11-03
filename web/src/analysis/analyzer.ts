/* Streaming analyzer: one pass over the decoded samples computes what the
   panel gets from its three ffmpeg runs. Memory is bounded by the
   ebur128 3 s window and the true-peak filter history, whatever the
   length of the stream, and results do not depend on chunk boundaries. */

import { OverallStats, WindowRms } from "./astats";
import { printed } from "./cfmt";
import { Ebur128 } from "./ebur128";
import { parseSilence, SilenceDetect } from "./silence";
import { TruePeak } from "./truepeak";
import type { Metrics, ProbeInfo, StreamFormat } from "./types";

export class Analyzer {
  private readonly fmt: StreamFormat;
  private readonly dblScale: number;
  private readonly ebur: Ebur128;
  private readonly tp: TruePeak;
  private readonly overall: OverallStats;
  private readonly windows: WindowRms;
  private readonly silence: SilenceDetect;
  private quietest: number | null = null;
  private scratch = new Float64Array(0);
  private frames = 0;

  constructor(fmt: StreamFormat) {
    this.fmt = fmt;
    const { sampleRate, channels, sampleFormat } = fmt;
    // swresample's conversion to DBL for ebur128: s16 / 2^15, s32 / 2^31.
    this.dblScale = sampleFormat === "s16" ? 1 / 32768 : sampleFormat === "s32" ? 1 / 2147483648 : 1;
    this.ebur = new Ebur128(sampleRate, fmt.weights);
    this.tp = new TruePeak(sampleRate, channels);
    this.overall = new OverallStats(channels, sampleFormat);
    // The panel sizes the window as Math.round((sampleRateHz || 48000) / 2).
    this.windows = new WindowRms(channels, sampleFormat, Math.round(sampleRate / 2), (db) => {
      // ametadata prints "%f"; the panel keeps values above -100 dB.
      const v = printed(db, 6);
      if (v !== null && v > -100 && (this.quietest === null || v < this.quietest)) this.quietest = v;
    });
    this.silence = new SilenceDetect(sampleRate, channels, sampleFormat);
  }

  /** Interleaved raw decoder values (see SampleFormat). */
  push(data: Float64Array, frames: number): void {
    if (frames <= 0) return;
    const n = frames * this.fmt.channels;
    let dbl = data;
    if (this.dblScale !== 1) {
      if (this.scratch.length < n) this.scratch = new Float64Array(n);
      dbl = this.scratch;
      const k = this.dblScale;
      for (let i = 0; i < n; i++) dbl[i] = data[i] * k;
    }
    this.ebur.process(dbl, frames);
    this.tp.process(dbl, frames);
    this.overall.process(data, frames);
    this.windows.process(data, frames);
    this.silence.process(data, frames);
    this.frames += frames;
  }

  get framesProcessed(): number {
    return this.frames;
  }

  /** Metrics exactly as the panel's analyze() assembles them. */
  finish(probe: ProbeInfo): Metrics {
    this.windows.finish();
    this.silence.finish();
    const loud = this.ebur.result();
    const stats = this.overall.result();
    const sil = parseSilence(this.silence.events, probe.duration);
    const minMomentary = loud.minMomentary;
    return {
      ...probe,
      // Summary: "I: %5.1f LUFS", "LRA: %5.1f LU" (no sign allowed by the
      // panel's regex), "Peak: %5.1f dBFS".
      lufsI: printed(loud.integrated, 1),
      lra: printed(loud.lra, 1, false),
      truePeak: printed(20 * Math.log10(this.tp.result()), 1),
      minMomentary,
      // astats "RMS level dB: %f", "Peak level dB: %f".
      rmsDb: printed(stats.rmsDb, 6),
      samplePeakDb: printed(stats.peakDb, 6),
      headSilence: sil.headSilence,
      tailSilence: sil.tailSilence,
      noiseFloor: this.quietest !== null ? this.quietest : minMomentary,
    };
  }
}
