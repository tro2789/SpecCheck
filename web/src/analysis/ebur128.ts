/* Port of the loudness part of ffmpeg 7.1 libavfilter/f_ebur128.c
   (integrated loudness, LRA, momentary loudness per 100 ms tick).
   Same filter coefficients, running sums, 1e-12 power floor, histogram
   gating and LRA percentile walk, in the same order of operations. */

import { printed } from "./cfmt";

const ABS_THRES = -70;
const HIST_GRAIN = 100;
const HIST_SIZE = (10 - ABS_THRES) * HIST_GRAIN + 1;
const I_GATE_THRES = -10;
const LRA_GATE_THRES = -20;
const LRA_LOWER_PRC = 10;
const LRA_HIGHER_PRC = 95;
const M_LOG2_10 = 3.32192809488736234787;

const loudnessOf = (energy: number): number => -0.691 + 10 * Math.log10(energy);
const energyOf = (loudness: number): number => Math.pow(2, M_LOG2_10 * ((loudness + 0.691) / 10));
const histPos = (v: number): number => {
  const p = Math.trunc((v - ABS_THRES) * HIST_GRAIN);
  return p < 0 ? 0 : p > HIST_SIZE - 1 ? HIST_SIZE - 1 : p;
};

let histLoudness: Float64Array | null = null;
let histEnergy: Float64Array | null = null;
function histTables(): [Float64Array, Float64Array] {
  if (!histLoudness || !histEnergy) {
    histLoudness = new Float64Array(HIST_SIZE);
    histEnergy = new Float64Array(HIST_SIZE);
    for (let i = 0; i < HIST_SIZE; i++) {
      histLoudness[i] = i / HIST_GRAIN + ABS_THRES;
      histEnergy[i] = energyOf(histLoudness[i]);
    }
  }
  return [histLoudness, histEnergy];
}

class Integrator {
  readonly cache: Float64Array[];
  readonly sum: Float64Array;
  readonly hist = new Uint32Array(HIST_SIZE);
  readonly size: number;
  pos = 0;
  filled = false;
  sumKeptPowers = 0;
  nbKeptPowers = 0;
  relThreshold = 0;

  constructor(channels: number, size: number, weights: number[]) {
    this.size = size;
    this.sum = new Float64Array(channels);
    this.cache = weights.map((w) => new Float64Array(w ? size : 0));
  }

  /** gate_update(): returns the histogram position of the relative gate. */
  gateUpdate(power: number, loudness: number, gateThres: number): number {
    this.hist[histPos(loudness)]++;
    this.sumKeptPowers += power;
    this.nbKeptPowers++;
    let rel = this.sumKeptPowers / this.nbKeptPowers;
    if (!rel) rel = 1e-12;
    this.relThreshold = loudnessOf(rel) + gateThres;
    return histPos(this.relThreshold);
  }
}

export interface LoudnessResult {
  /** Summary "I:" value (LUFS), unrounded. */
  integrated: number;
  /** Summary "LRA:" value (LU), unrounded. */
  lra: number;
  /** Quietest per-tick "M:" value as the panel parses it (> -100 only). */
  minMomentary: number | null;
}

export class Ebur128 {
  private readonly ch: number;
  private readonly w: number[];
  private readonly preB0: number;
  private readonly preB1: number;
  private readonly preB2: number;
  private readonly preA1: number;
  private readonly preA2: number;
  private readonly rlbA1: number;
  private readonly rlbA2: number;
  private readonly x: Float64Array;
  private readonly y: Float64Array;
  private readonly z: Float64Array;
  private readonly i400: Integrator;
  private readonly i3000: Integrator;
  private readonly tickLen: number;
  private sampleCount = 0;
  private lastGate400 = -1;
  private lastGate3000 = -1;
  private minM: number | null = null;

  constructor(sampleRate: number, weights: number[]) {
    this.ch = weights.length;
    this.w = weights;

    let f0 = 1681.974450955533;
    const G = 3.999843853973347;
    let Q = 0.7071752369554196;
    let K = Math.tan((Math.PI * f0) / sampleRate);
    const Vh = Math.pow(10.0, G / 20.0);
    const Vb = Math.pow(Vh, 0.4996667741545416);
    const a0 = 1.0 + K / Q + K * K;
    this.preB0 = (Vh + (Vb * K) / Q + K * K) / a0;
    this.preB1 = (2.0 * (K * K - Vh)) / a0;
    this.preB2 = (Vh - (Vb * K) / Q + K * K) / a0;
    this.preA1 = (2.0 * (K * K - 1.0)) / a0;
    this.preA2 = (1.0 - K / Q + K * K) / a0;

    f0 = 38.13547087602444;
    Q = 0.5003270373238773;
    K = Math.tan((Math.PI * f0) / sampleRate);
    this.rlbA1 = (2.0 * (K * K - 1.0)) / (1.0 + K / Q + K * K);
    this.rlbA2 = (1.0 - K / Q + K * K) / (1.0 + K / Q + K * K);

    this.x = new Float64Array(this.ch * 3);
    this.y = new Float64Array(this.ch * 3);
    this.z = new Float64Array(this.ch * 3);
    this.i400 = new Integrator(this.ch, Math.trunc((sampleRate * 4) / 10), weights);
    this.i3000 = new Integrator(this.ch, sampleRate * 3, weights);
    this.tickLen = Math.trunc(sampleRate / 10);
  }

  /** Interleaved samples already converted to ffmpeg's DBL scale. */
  process(data: Float64Array, frames: number): void {
    const { ch, w, x, y, z, i400, i3000 } = this;
    const { preB0, preB1, preB2, preA1, preA2, rlbA1, rlbA2 } = this;
    let k = 0;
    for (let n = 0; n < frames; n++) {
      const b400 = i400.pos;
      const b3000 = i3000.pos;
      if (++i400.pos === i400.size) { i400.filled = true; i400.pos = 0; }
      if (++i3000.pos === i3000.size) { i3000.filled = true; i3000.pos = 0; }

      for (let c = 0; c < ch; c++, k++) {
        const o = c * 3;
        x[o] = data[k];
        if (!w[c]) continue;
        y[o + 2] = y[o + 1];
        y[o + 1] = y[o];
        y[o] = x[o] * preB0 + x[o + 1] * preB1 + x[o + 2] * preB2 - y[o + 1] * preA1 - y[o + 2] * preA2;
        x[o + 2] = x[o + 1];
        x[o + 1] = x[o];
        z[o + 2] = z[o + 1];
        z[o + 1] = z[o];
        z[o] = y[o] * 1.0 + y[o + 1] * -2.0 + y[o + 2] * 1.0 - z[o + 1] * rlbA1 - z[o + 2] * rlbA2;
        const bin = z[o] * z[o];
        const c400 = i400.cache[c];
        const c3000 = i3000.cache[c];
        i400.sum[c] = i400.sum[c] + bin - c400[b400];
        i3000.sum[c] = i3000.sum[c] + bin - c3000[b3000];
        c400[b400] = bin;
        c3000[b3000] = bin;
      }

      if (++this.sampleCount === this.tickLen) {
        this.sampleCount = 0;
        this.tick();
      }
    }
  }

  private tick(): void {
    const { ch, w, i400, i3000 } = this;
    let p400 = 1e-12;
    let p3000 = 1e-12;
    if (i400.filled) {
      for (let c = 0; c < ch; c++) p400 += w[c] * i400.sum[c];
      p400 /= i400.size;
    }
    const l400 = loudnessOf(p400);
    if (i3000.filled) {
      for (let c = 0; c < ch; c++) p3000 += w[c] * i3000.sum[c];
      p3000 /= i3000.size;
    }
    const l3000 = loudnessOf(p3000);

    // The histograms only change on these ticks, so the summary values
    // (computed from the state at the last such tick) are derived in result().
    if (l400 >= ABS_THRES) this.lastGate400 = i400.gateUpdate(p400, l400, I_GATE_THRES);
    if (l3000 >= ABS_THRES) this.lastGate3000 = i3000.gateUpdate(p3000, l3000, LRA_GATE_THRES);

    // Frame log "M:%6.1f", read back by the panel's /M:\s*(-?[\d.]+)/ and
    // kept when above -100. NaN prints "nan" and never matches.
    const v = printed(l400, 1);
    if (v !== null && v > -100 && (this.minM === null || v < this.minM)) this.minM = v;
  }

  result(): LoudnessResult {
    const [hL, hE] = histTables();
    let integrated = ABS_THRES;
    if (this.lastGate400 >= 0) {
      const h = this.i400.hist;
      let sum = 0;
      let nb = 0;
      for (let i = this.lastGate400; i < HIST_SIZE; i++) {
        const v = h[i];
        nb += v;
        sum += v * hE[i];
      }
      if (nb) integrated = loudnessOf(sum / nb);
    }

    let lra = 0;
    if (this.lastGate3000 >= 0) {
      const h = this.i3000.hist;
      const gate = this.lastGate3000;
      let nbPowers = 0;
      for (let i = gate; i < HIST_SIZE; i++) nbPowers += h[i];
      if (nbPowers) {
        let low = 0;
        let high = 0;
        let n = 0;
        let nbPow = Math.floor(LRA_LOWER_PRC * nbPowers * 0.01 + 0.5);
        for (let i = gate; i < HIST_SIZE; i++) {
          n += h[i];
          if (n >= nbPow) { low = hL[i]; break; }
        }
        n = nbPowers;
        nbPow = Math.floor(LRA_HIGHER_PRC * nbPowers * 0.01 + 0.5);
        for (let i = HIST_SIZE - 1; i >= 0; i--) {
          n -= Math.min(n, h[i]);
          if (n < nbPow) { high = hL[i]; break; }
        }
        lra = high - low;
      }
    }
    return { integrated, lra, minMomentary: this.minM };
  }
}
