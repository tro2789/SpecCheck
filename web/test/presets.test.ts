/* The web app must judge files exactly as the Premiere panel does. These
   tests run the panel's own code, extracted from ../js/main.js. */

import { describe, expect, it } from "vitest";
import { panelMetricDefs, panelPresets, panelScoring } from "../scripts/panel-source.mjs";
import type { Metrics } from "../src/analysis/types";
import { fmtVal, score } from "../src/evaluate";
import { BUILTIN_PRESETS, METRICS } from "../src/presets";
import { loadReference } from "./helpers";

describe("drift from the panel", () => {
  it("BUILTIN_PRESETS equals the panel's", () => {
    expect(BUILTIN_PRESETS).toEqual(panelPresets());
  });

  it("METRICS (order, labels, units, formatting) equals the panel's", () => {
    expect(METRICS).toEqual(panelMetricDefs());
  });
});

/** Reference values plus values on, just inside, and just outside every
    preset boundary, and missing values. */
function cases(): { name: string; metrics: Partial<Metrics> }[] {
  const out: { name: string; metrics: Partial<Metrics> }[] = loadReference().fixtures.map((f) => ({
    name: f.file,
    metrics: f.metrics,
  }));
  for (const checks of Object.values(BUILTIN_PRESETS)) {
    for (const c of checks) {
      for (const edge of [c.min, c.max]) {
        if (edge === undefined) continue;
        for (const d of [-0.1, 0, 0.1]) out.push({ name: `${c.m}=${edge + d}`, metrics: { [c.m]: edge + d } });
      }
      out.push({ name: `${c.m}=null`, metrics: { [c.m]: null } });
    }
  }
  return out;
}

describe("evaluation equals the panel's score() on every preset", () => {
  for (const [name, checks] of Object.entries(BUILTIN_PRESETS)) {
    it(name, () => {
      const panel = panelScoring(checks);
      for (const c of cases()) {
        expect(score(c.metrics, checks), c.name).toEqual(panel.score(c.metrics));
      }
    });
  }

  it("formats every reference value like the panel's fmtVal()", () => {
    const panel = panelScoring([]);
    for (const { metrics } of loadReference().fixtures) {
      for (const def of METRICS) {
        expect(fmtVal(def, metrics[def.key])).toBe(panel.fmtVal(def, metrics[def.key]));
      }
    }
  });
});
