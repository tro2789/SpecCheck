/* Metric display definitions and the built-in delivery specs, copied from
   the panel (js/main.js METRICS and BUILTIN_PRESETS). test/presets.test.ts
   fails if the two drift apart. */

import type { Metrics } from "./analysis/types";

export type MetricKey = keyof Omit<Metrics, "codec" | "minMomentary">;

export interface MetricDef {
  key: MetricKey;
  label: string;
  unit: string;
  int?: boolean;
  time?: boolean;
}

export interface Check {
  m: MetricKey;
  min?: number;
  max?: number;
}

// Display order and formatting for the full metric set.
export const METRICS: MetricDef[] = [
  { key: "lufsI", label: "Integrated loudness", unit: " LUFS" },
  { key: "lra", label: "Loudness range", unit: " LU" },
  { key: "truePeak", label: "True peak", unit: " dBTP" },
  { key: "rmsDb", label: "Overall RMS", unit: " dB" },
  { key: "samplePeakDb", label: "Sample peak", unit: " dBFS" },
  { key: "noiseFloor", label: "Noise floor", unit: " dB" },
  { key: "headSilence", label: "Head silence", unit: " s" },
  { key: "tailSilence", label: "Tail silence", unit: " s" },
  { key: "sampleRateHz", label: "Sample rate", unit: " Hz", int: true },
  { key: "bitrateKbps", label: "Bitrate", unit: " kbps", int: true },
  { key: "channels", label: "Channels", unit: "", int: true },
  { key: "duration", label: "Duration", unit: "", time: true },
];

// Presets: checklists only. Unlisted metrics are shown but not judged.
export const BUILTIN_PRESETS: Record<string, Check[]> = {
  "ACX / Audible": [
    { m: "rmsDb", min: -23, max: -18 },
    { m: "samplePeakDb", max: -3 },
    { m: "noiseFloor", max: -60 },
    { m: "bitrateKbps", min: 192 },
  ],
  // Encoded from an Audible Originals delivery spec sheet (2026-08).
  // LRA <= 7 LU is a recommendation in that spec, not an acceptance
  // criterion, so it is shown but not checked.
  "Audible Originals": [
    { m: "lufsI", min: -18, max: -16 },
    { m: "truePeak", max: -1 },
    { m: "noiseFloor", max: -60 },
    { m: "headSilence", max: 3 },
    { m: "tailSilence", max: 3 },
    { m: "sampleRateHz", min: 44100, max: 44100 },
    { m: "channels", min: 1, max: 2 },
    { m: "duration", max: 7140 },
  ],
  "Apple Podcasts": [
    { m: "lufsI", min: -17, max: -15 },
    { m: "truePeak", max: -1 },
  ],
  "Spotify": [
    { m: "lufsI", min: -15, max: -13 },
    { m: "truePeak", max: -1 },
  ],
  "EBU R128 broadcast": [
    { m: "lufsI", min: -23.5, max: -22.5 },
    { m: "truePeak", max: -1 },
  ],
  "YouTube": [
    { m: "lufsI", min: -15, max: -13 },
    { m: "truePeak", max: -1 },
  ],
};

export const DEFAULT_PRESET = "ACX / Audible";
