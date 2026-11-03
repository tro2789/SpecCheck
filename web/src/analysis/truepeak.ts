/* True peak as ffmpeg 7.1 ebur128=peak=true measures it: libswresample
   upsamples the input to 192 kHz with its default polyphase filter
   (Kaiser windowed sinc, beta 9, 32 taps, cutoff 0.97, exact rational
   phases, linear interpolation only when the ratio is inexact) and the
   peak is the largest absolute output sample. Like the filter, the
   resampler is never flushed: outputs whose taps reach past the last input
   sample are not produced. The first L+1 input samples are mirrored into
   the filter history, as swresample's invert_initial_buffer() does. */

const OUT_RATE = 192000;

/** av_bessel_i0() from libavutil/mathematics.c. */
function besselI0(x: number): number {
  const p1 = [
    -2.2335582639474375249e15, -5.5050369673018427753e14, -3.2940087627407749166e13,
    -8.4925101247114157499e11, -1.1912746104985237192e10, -1.0313066708737980747e8,
    -5.9545626019847898221e5, -2.4125195876041896775e3, -7.093534744921054919,
    -1.5453977791786851041e-2, -2.5172644670688975051e-5, -3.0517226450451067446e-8,
    -2.6843448573468483278e-11, -1.5982226675653184646e-14, -5.24878666279456998e-18,
  ];
  const q1 = [
    -2.2335582639474375245e15, 7.8858692566751002988e12, -1.2207067397808979846e10,
    1.0377081058062166144e7, -4.8527560179962773045e3, 1.0,
  ];
  const p2 = [
    -2.2210262233306573296e-4, 1.3067392038106924055e-2, -4.4700805721174453923e-1,
    5.5674518371240761397, -2.3517945679239481621e1, 3.1611322818701131207e1,
    -9.609002196865618,
  ];
  const q2 = [
    -5.5194330231005480228e-4, 3.2547697594819615062e-2, -1.1151759188741312645,
    1.3982595353892851542e1, -6.0228002066743340583e1, 8.55395632580129296e1,
    -3.14466902751354915e1, 1.0,
  ];
  const poly = (c: number[], v: number): number => {
    let sum = c[c.length - 1];
    for (let i = c.length - 2; i >= 0; --i) {
      sum *= v;
      sum += c[i];
    }
    return sum;
  };
  if (x === 0) return 1.0;
  x = Math.abs(x);
  if (x <= 15) {
    const y = x * x;
    return poly(p1, y) / poly(q1, y);
  }
  const y = 1 / x - 1.0 / 15;
  const r = poly(p2, y) / poly(q2, y);
  return (Math.exp(x) / Math.sqrt(x)) * r;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

export class TruePeak {
  private readonly ch: number;
  private readonly passthrough: boolean;
  private L = 0;
  private P = 0;
  private alloc = 0;
  private bank = new Float64Array(0);
  /** Largest sum of |coefficients| over all phases, for the skip bound. */
  private maxAbsSum = 0;
  private srcIncr = 0;
  private divIncr = 0;
  private modIncr = 0;
  private linear = false;

  /** Planar history per channel; buf[c][i] holds x[bufStart + i]. */
  private buf: Float64Array[];
  private bufStart = 0;
  private bufLen = 0;
  private total = 0;
  private started = false;
  private pending: number[][] = [];

  /** Resampler state: first tap index s (in input samples), phase, frac. */
  private s = 0;
  private index = 0;
  private frac = 0;

  private peak = 0;

  constructor(inRate: number, channels: number) {
    this.ch = channels;
    this.buf = [];
    this.passthrough = inRate === OUT_RATE;
    if (this.passthrough) return;

    // resample_init()
    const cutoff = 0.97;
    const factor = Math.min((OUT_RATE * cutoff) / inRate, 1.0);
    let phaseCount = 1 << 10;
    let L = Math.max(Math.trunc(Math.ceil(32 / factor)), 1);
    if (L > 1) L = (L + 1) & ~1;
    const g = gcd(OUT_RATE, inRate);
    if (OUT_RATE / g <= phaseCount) phaseCount = OUT_RATE / g;
    const P = phaseCount;
    const alloc = (L + 7) & ~7;
    const bank = new Float64Array(alloc * (P + 1));
    buildFilter(bank, factor, L, alloc, P, 9);
    // Phase P is phase 0 shifted by one tap, for linear interpolation.
    bank.copyWithin(alloc * P + 1, 0, alloc - 1);
    bank[alloc * P] = bank[alloc - 1];

    let num = OUT_RATE;
    let den = inRate * P;
    const g2 = gcd(num, den);
    num /= g2; // src_incr
    den /= g2; // dst_incr
    let src = num;
    let dst = den;
    while (dst < 1 << 20 && src < 1 << 20) {
      dst *= 2;
      src *= 2;
    }

    let maxAbsSum = 0;
    for (let ph = 0; ph <= P; ph++) {
      let a = 0;
      for (let i = 0; i < L; i++) a += Math.abs(bank[ph * alloc + i]);
      if (a > maxAbsSum) maxAbsSum = a;
    }

    this.L = L;
    this.P = P;
    this.alloc = alloc;
    this.bank = bank;
    this.maxAbsSum = maxAbsSum;
    this.srcIncr = src;
    this.divIncr = Math.trunc(dst / src);
    this.modIncr = dst % src;
    this.linear = dst % src !== 0;
    // index starts at -P*((L-1)/2); invert_initial_buffer() walks it back
    // to phase 0 with the first output centred on x[0].
    this.s = -Math.trunc((L - 1) / 2);
    this.index = 0;
    for (let c = 0; c < channels; c++) {
      this.buf.push(new Float64Array(0));
      this.pending.push([]);
    }
  }

  /** Interleaved samples in ffmpeg's DBL scale. */
  process(data: Float64Array, frames: number): void {
    const ch = this.ch;
    if (this.passthrough) {
      let p = this.peak;
      for (let i = 0, n = frames * ch; i < n; i++) {
        const a = Math.abs(data[i]);
        if (a > p) p = a;
      }
      this.peak = p;
      return;
    }
    if (!this.started) {
      // Wait for L+1 samples before starting, as swresample does.
      for (let n = 0; n < frames; n++)
        for (let c = 0; c < ch; c++) this.pending[c].push(data[n * ch + c]);
      this.total += frames;
      if (this.total < this.L + 1) return;
      this.start();
      this.run();
      return;
    }
    this.append(data, frames);
    this.run();
  }

  private start(): void {
    const { L, ch } = this;
    const n = this.pending[0].length;
    for (let c = 0; c < ch; c++) {
      const b = new Float64Array(Math.max(4 * (L + n), 1 << 16));
      const src = this.pending[c];
      // x[-k] = x[k] for k = 1..L
      for (let k = 1; k <= L; k++) b[L - k] = src[k];
      for (let i = 0; i < n; i++) b[L + i] = src[i];
      this.buf[c] = b;
    }
    this.bufStart = -L;
    this.bufLen = L + n;
    this.pending = [];
    this.started = true;
  }

  private append(data: Float64Array, frames: number): void {
    const ch = this.ch;
    // Drop history before the next output's first tap.
    const keepFrom = this.s - this.bufStart;
    if (keepFrom > 0) {
      for (let c = 0; c < ch; c++) this.buf[c].copyWithin(0, keepFrom, this.bufLen);
      this.bufStart += keepFrom;
      this.bufLen -= keepFrom;
    }
    if (this.bufLen + frames > this.buf[0].length) {
      const size = Math.max(2 * (this.bufLen + frames), 1 << 16);
      for (let c = 0; c < ch; c++) {
        const b = new Float64Array(size);
        b.set(this.buf[c].subarray(0, this.bufLen));
        this.buf[c] = b;
      }
    }
    for (let c = 0; c < ch; c++) {
      const b = this.buf[c];
      let o = this.bufLen;
      for (let n = 0, k = c; n < frames; n++, k += ch) b[o++] = data[k];
    }
    this.bufLen += frames;
    this.total += frames;
  }

  /** Produce every output whose taps are all available. */
  private run(): void {
    const { L, P, alloc, bank, ch, srcIncr, divIncr, modIncr, linear, maxAbsSum } = this;
    const lastS = this.bufStart + this.bufLen - L; // largest allowed first tap
    const BLOCK = 256;
    let s = this.s;
    let index = this.index;
    let frac = this.frac;
    let peak = this.peak;
    const inv = 1.0 / srcIncr;

    while (s <= lastS) {
      const blockEnd = Math.min(s + BLOCK, lastS + 1);
      // Bound every output in this block by max|x| over its taps; skip the
      // block when no output can exceed the peak found so far.
      let mx = 0;
      const from = s - this.bufStart;
      const to = blockEnd - 1 + L - this.bufStart;
      for (let c = 0; c < ch; c++) {
        const b = this.buf[c];
        for (let i = from; i < to; i++) {
          const a = Math.abs(b[i]);
          if (a > mx) mx = a;
        }
      }
      const skip = mx * maxAbsSum * (1 + 1e-9) <= peak;

      // Replay the block's outputs once per channel (as swresample does),
      // then keep the state reached at the end of the block.
      let s1 = s;
      let index1 = index;
      let frac1 = frac;
      for (let c = 0; c < (skip ? 1 : ch); c++) {
        const b = this.buf[c];
        s1 = s;
        index1 = index;
        frac1 = frac;
        while (s1 < blockEnd) {
          if (!skip) {
            const base = s1 - this.bufStart;
            const f = alloc * index1;
            let v: number;
            if (!linear) {
              let val = 0;
              let val2 = 0;
              let i = 0;
              for (; i + 1 < L; i += 2) {
                val += b[base + i] * bank[f + i];
                val2 += b[base + i + 1] * bank[f + i + 1];
              }
              if (i < L) val += b[base + i] * bank[f + i];
              v = val + val2;
            } else {
              let val = 0;
              let v2 = 0;
              for (let i = 0; i < L; i++) {
                val += b[base + i] * bank[f + i];
                v2 += b[base + i] * bank[f + alloc + i];
              }
              v = val + (v2 - val) * inv * frac1;
            }
            const a = v < 0 ? -v : v;
            if (a > peak) peak = a;
          }
          frac1 += modIncr;
          index1 += divIncr;
          if (frac1 >= srcIncr) {
            frac1 -= srcIncr;
            index1++;
          }
          while (index1 >= P) {
            s1++;
            index1 -= P;
          }
        }
      }
      s = s1;
      index = index1;
      frac = frac1;
    }
    this.s = s;
    this.index = index;
    this.frac = frac;
    this.peak = peak;
  }

  /** Largest absolute 192 kHz sample (linear), 0 if none was produced. */
  result(): number {
    return this.peak;
  }
}

/** build_filter() for AV_SAMPLE_FMT_DBLP with scale 1. */
function buildFilter(
  filter: Float64Array, factor: number, tapCount: number, alloc: number,
  phaseCount: number, kaiserBeta: number,
): void {
  const phNb = phaseCount % 2 ? phaseCount : phaseCount / 2 + 1;
  const tab = new Float64Array(tapCount + 1);
  const sinLut = new Float64Array(phNb);
  const center = Math.trunc((tapCount - 1) / 2);
  let norm = 0;
  if (factor > 1.0) factor = 1.0;
  if (factor === 1.0) {
    for (let ph = 0; ph < phNb; ph++)
      sinLut[ph] = Math.sin((Math.PI * ph) / phaseCount) * (center & 1 ? 1 : -1);
  }
  for (let ph = 0; ph < phNb; ph++) {
    let s = sinLut[ph];
    for (let i = 0; i < tapCount; i++) {
      const x = Math.PI * ((i - center) - ph / phaseCount) * factor;
      let y: number;
      if (x === 0) y = 1.0;
      else if (factor === 1.0) y = s / x;
      else y = Math.sin(x) / x;
      const w = (2.0 * x) / (factor * tapCount * Math.PI);
      y *= besselI0(kaiserBeta * Math.sqrt(Math.max(1 - w * w, 0)));
      tab[i] = y;
      s = -s;
      if (!ph) norm += y;
    }
    for (let i = 0; i < tapCount; i++) filter[ph * alloc + i] = (tab[i] * 1) / norm;
    if (phaseCount % 2) continue;
    for (let i = 0; i < tapCount; i++)
      filter[(phaseCount - ph) * alloc + tapCount - 1 - i] = filter[ph * alloc + i];
  }
}
