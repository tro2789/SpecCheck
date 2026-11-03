/* The two astats uses in the panel, ported from ffmpeg 7.1 af_astats.c:
   - "Overall" RMS level and Peak level of the whole stream
     (astats=measure_perchannel=none), and
   - the quietest 0.5 s window: asetnsamples=n=<rate/2> (which zero-pads
     the final partial window, pad=1 by default) feeding
     astats=metadata=1:reset=1, read as lavfi.astats.Overall.RMS_level.

   Overall values pool every channel: RMS is sqrt(sum of squares over all
   channels / total sample count) and Peak is max(-min, max) over all
   channels. astats normalizes integer samples by INT16_MAX or INT32_MAX
   (not 2^15 / 2^31); float samples are used as is. */

import type { SampleFormat } from "./types";

export function astatsNorm(fmt: SampleFormat): number {
  return fmt === "s16" ? 32767 : fmt === "s32" ? 2147483647 : 1;
}

const linearToDb = (x: number): number => Math.log10(x) * 20;

export class OverallStats {
  private readonly ch: number;
  private readonly norm: number;
  private readonly sigmaX2: Float64Array;
  private nbFrames = 0;
  private min = Number.MAX_VALUE;
  private max = -Number.MAX_VALUE;

  constructor(channels: number, fmt: SampleFormat) {
    this.ch = channels;
    this.norm = astatsNorm(fmt);
    this.sigmaX2 = new Float64Array(channels);
  }

  /** Interleaved raw decoder values. */
  process(data: Float64Array, frames: number): void {
    const { ch, norm, sigmaX2 } = this;
    let min = this.min;
    let max = this.max;
    for (let c = 0; c < ch; c++) {
      let s2 = sigmaX2[c];
      if (norm === 1) {
        for (let k = c, n = frames * ch; k < n; k += ch) {
          const d = data[k];
          if (d < min) min = d;
          if (d > max) max = d;
          s2 += d * d;
        }
      } else {
        for (let k = c, n = frames * ch; k < n; k += ch) {
          const d = data[k];
          if (d < min) min = d;
          if (d > max) max = d;
          const nd = d / norm;
          s2 += nd * nd;
        }
      }
      sigmaX2[c] = s2;
    }
    this.min = min;
    this.max = max;
    this.nbFrames += frames;
  }

  /** Unrounded "RMS level dB" and "Peak level dB". */
  result(): { rmsDb: number; peakDb: number } {
    let s = 0;
    for (let c = 0; c < this.ch; c++) s += this.sigmaX2[c];
    const nb = this.nbFrames * this.ch;
    const nmin = this.min / this.norm;
    const nmax = this.max / this.norm;
    return {
      rmsDb: linearToDb(Math.sqrt(s / nb)),
      peakDb: nb ? linearToDb(Math.max(-nmin, nmax)) : NaN,
    };
  }
}

/** Per-window Overall.RMS_level over fixed windows of `size` frames. */
export class WindowRms {
  private readonly ch: number;
  private readonly norm: number;
  private readonly size: number;
  private readonly acc: Float64Array;
  private fill = 0;
  private readonly onWindow: (rmsDb: number) => void;

  constructor(channels: number, fmt: SampleFormat, size: number, onWindow: (rmsDb: number) => void) {
    this.ch = channels;
    this.norm = astatsNorm(fmt);
    this.size = size;
    this.acc = new Float64Array(channels);
    this.onWindow = onWindow;
  }

  process(data: Float64Array, frames: number): void {
    const { ch, norm, size, acc } = this;
    let n = 0;
    while (n < frames) {
      const take = Math.min(size - this.fill, frames - n);
      for (let c = 0; c < ch; c++) {
        let s2 = acc[c];
        for (let k = n * ch + c, e = (n + take) * ch; k < e; k += ch) {
          const nd = data[k] / norm;
          s2 += nd * nd;
        }
        acc[c] = s2;
      }
      n += take;
      this.fill += take;
      if (this.fill === size) this.emit();
    }
  }

  /** End of stream: the partial window is zero-padded to full size. */
  finish(): void {
    if (this.fill > 0) this.emit();
  }

  private emit(): void {
    let s = 0;
    for (let c = 0; c < this.ch; c++) s += this.acc[c];
    this.onWindow(linearToDb(Math.sqrt(s / (this.size * this.ch))));
    this.acc.fill(0);
    this.fill = 0;
  }
}
