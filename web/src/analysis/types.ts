/** The sample format ffmpeg's decoder hands to the filters. Integer data
    is passed as raw integer values (24-bit PCM arrives as s32, shifted
    left by 8, the way pcm_s24le decodes); float data as its value. */
export type SampleFormat = "s16" | "s32" | "flt" | "dbl";

export interface StreamFormat {
  sampleRate: number;
  channels: number;
  sampleFormat: SampleFormat;
  /** ebur128 channel weighting: 1.0 front, 1.41 surround, 0 LFE. */
  weights: number[];
}

/** What the panel reads from ffprobe. */
export interface ProbeInfo {
  codec: string;
  sampleRateHz: number | null;
  channels: number | null;
  bitrateKbps: number | null;
  duration: number | null;
}

/** The panel's metric set (plus minMomentary, its noise-floor fallback). */
export interface Metrics extends ProbeInfo {
  lufsI: number | null;
  lra: number | null;
  truePeak: number | null;
  minMomentary: number | null;
  rmsDb: number | null;
  samplePeakDb: number | null;
  noiseFloor: number | null;
  headSilence: number | null;
  tailSilence: number | null;
}
