/* Release gate: every metric, on every fixture, against what the panel
   reads from ffmpeg 7.1 (test/fixtures/reference.json, written by
   scripts/make-fixtures.mjs). Tolerances are not to be loosened. */

import { afterAll, describe, expect, it } from "vitest";
import { analyzeFile } from "../src/analyze-file";
import type { Metrics } from "../src/analysis/types";
import { fixtureReader, loadReference } from "./helpers";

const TOLERANCE: Partial<Record<keyof Metrics, number>> = {
  lufsI: 0.1,
  lra: 0.1,
  truePeak: 0.1,
  rmsDb: 0.1,
  noiseFloor: 0.1,
  minMomentary: 0.1,
  samplePeakDb: 0.01,
  headSilence: 0.05,
  tailSilence: 0.05,
  duration: 0.01,
  sampleRateHz: 0,
  channels: 0,
  bitrateKbps: 1,
};

const ref = loadReference();
const maxDelta: Record<string, { delta: number; file: string }> = {};

describe(`accuracy against ${ref.ffmpeg}`, () => {
  for (const { file, metrics: expected } of ref.fixtures) {
    it(file, async () => {
      const { read, size, close } = fixtureReader(file);
      // An odd chunk size, so chunks split samples and frames.
      const got = await analyzeFile(read, size, { chunkBytes: 65537 }).finally(close);

      expect(got.codec).toBe(expected.codec);
      for (const [key, tol] of Object.entries(TOLERANCE) as [keyof Metrics, number][]) {
        const want = expected[key] as number | null;
        const have = got[key] as number | null;
        if (want === null) {
          expect(have, `${key} should be undefined, as the panel reads it`).toBeNull();
          continue;
        }
        expect(have, `${key} missing`).not.toBeNull();
        const delta = Math.abs((have as number) - want);
        if (!maxDelta[key] || delta > maxDelta[key].delta) maxDelta[key] = { delta, file };
        expect(delta, `${key}: got ${have}, ffmpeg ${want}`).toBeLessThanOrEqual(tol + 1e-9);
      }
    });
  }

  afterAll(() => {
    const rows = Object.entries(TOLERANCE).map(([key, tol]) => ({
      metric: key,
      maxDelta: maxDelta[key] ? +maxDelta[key].delta.toFixed(6) : "n/a",
      tolerance: tol,
      worstFixture: maxDelta[key]?.file ?? "",
    }));
    console.table(rows);
  });
});
