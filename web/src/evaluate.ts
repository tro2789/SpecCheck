/* The panel's scoring and value formatting (js/main.js score() and
   fmtVal()), ported line for line. A check compares the value as the panel
   holds it (already rounded the way ffmpeg prints it) with min/max; a
   missing value is neither pass nor fail. */

import type { Metrics } from "./analysis/types";
import { METRICS, type Check, type MetricDef } from "./presets";

export interface CheckResult {
  required: string;
  pass: boolean | null;
}

export interface Score {
  byMetric: Partial<Record<string, CheckResult>>;
  pass: boolean;
  failCount: number;
  unknown: number;
}

export function fmtVal(def: MetricDef, v: number | null | undefined): string {
  if (v === null || v === undefined) return "?";
  if (def.time) {
    const t = Math.round(v);
    const h = Math.floor(t / 3600);
    const mm = Math.floor(t / 60) % 60;
    const ss = t % 60;
    const pad = (n: number): string => (n < 10 ? "0" : "") + n;
    return (h ? h + ":" + pad(mm) : String(mm)) + ":" + pad(ss);
  }
  return (def.int ? String(Math.round(v)) : v.toFixed(1)) + def.unit;
}

export function score(metrics: Partial<Metrics> | null, checks: Check[]): Score {
  const by: Partial<Record<string, CheckResult>> = {};
  let pass = true;
  let fails = 0;
  let unknown = 0;
  for (const c of checks) {
    const v = metrics ? metrics[c.m] : null;
    const def = METRICS.find((d) => d.key === c.m) ?? null;
    const fb = (n: number): string => (def && def.time ? fmtVal(def, n) : String(n));
    const req = c.min !== undefined && c.max !== undefined
      ? (c.min === c.max ? "= " + fb(c.min) : fb(c.min) + " to " + fb(c.max))
      : c.min !== undefined ? "≥ " + fb(c.min) : "≤ " + fb(c.max as number);
    let ok: boolean | null = null;
    if (v !== null && v !== undefined) {
      ok = (c.min === undefined || v >= c.min) && (c.max === undefined || v <= c.max);
      if (!ok) { pass = false; fails++; }
    } else {
      unknown++;
    }
    by[c.m] = { required: req, pass: ok };
  }
  return { byMetric: by, pass, failCount: fails, unknown };
}

/** The verdict sentence above the results. */
export function verdict(s: Score, checkCount: number, presetName: string): string {
  return s.pass
    ? `Passes ${presetName}`
    : `Fails ${s.failCount} of ${checkCount} checks for ${presetName}`;
}
