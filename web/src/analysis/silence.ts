/* silencedetect=n=-60dB:d=1 from ffmpeg 7.1 af_silencedetect.c (mono=0):
   samples are scanned in interleaved order and any sample at or above the
   threshold in any channel ends a silence. The threshold is compared in
   the decoder's sample format: for integer formats ffmpeg scales it by
   INT16_MAX / INT32_MAX and truncates it to an integer. Timestamps are
   sample indices of a continuous stream starting at pts 0. */

import { tsSeconds } from "./cfmt";
import type { SampleFormat } from "./types";

const M_LOG2_10 = 3.32192809488736234787;

export interface SilenceEvents {
  /** silence_start values as the panel parses them, in log order. */
  starts: number[];
  /** silence_end values (including the one printed at end of stream). */
  ends: number[];
}

export class SilenceDetect {
  private readonly ch: number;
  private readonly sr: number;
  private readonly noise: number;
  private readonly notify: number;
  private nbNull = 0;
  private start: number | null = null; // in frames
  private pos = 0; // interleaved sample index of the next sample
  readonly events: SilenceEvents = { starts: [], ends: [] };

  constructor(sampleRate: number, channels: number, fmt: SampleFormat, noiseDb = -60, seconds = 1) {
    this.ch = channels;
    this.sr = sampleRate;
    // av_strtod("-60dB") = ff_exp10(-60 / 20)
    const n = Math.pow(2, M_LOG2_10 * (noiseDb / 20));
    if (fmt === "s16") this.noise = Math.trunc(n * 32767);
    else if (fmt === "s32") this.noise = Math.trunc(n * 2147483647);
    else if (fmt === "flt") this.noise = Math.fround(n);
    else this.noise = n;
    // duration in samples: av_rescale(1000000 * seconds, rate, 1000000)
    this.notify = Math.round(seconds * sampleRate) * channels;
  }

  process(data: Float64Array, frames: number): void {
    const { noise, notify, ch } = this;
    const n = frames * ch;
    let pos = this.pos;
    for (let i = 0; i < n; i++, pos++) {
      const v = data[i];
      if (v < noise && v > -noise) {
        if (this.start === null) {
          this.nbNull++;
          if (this.nbNull >= notify) {
            this.start = Math.trunc(pos / ch) + 1 - Math.trunc(notify / ch);
            this.events.starts.push(tsSeconds(this.start / this.sr));
          }
        }
      } else {
        if (this.start !== null) this.end(Math.trunc(pos / ch));
        this.nbNull = 0;
        this.start = null;
      }
    }
    this.pos = pos;
  }

  /** End of stream: an open silence ends at the end of the last frame. */
  finish(): void {
    if (this.start !== null) this.end(Math.trunc(this.pos / this.ch));
    this.start = null;
  }

  private end(frame: number): void {
    this.events.ends.push(tsSeconds(frame / this.sr));
  }
}

/** parseSilence() from the panel, verbatim in behavior. */
export function parseSilence(
  ev: SilenceEvents, duration: number | null,
): { headSilence: number; tailSilence: number } {
  const { starts, ends } = ev;
  const head = starts.length && starts[0] < 0.05 ? (ends[0] || duration || 0) - starts[0] : 0;
  let tail = 0;
  if (starts.length) {
    const lastStart = starts[starts.length - 1];
    const lastEnd = ends.length >= starts.length ? ends[ends.length - 1] : null;
    if (lastEnd === null || (duration && duration - lastEnd < 0.05)) {
      tail = (duration || 0) - lastStart;
    }
  }
  return { headSilence: head, tailSilence: Math.max(0, tail) };
}
