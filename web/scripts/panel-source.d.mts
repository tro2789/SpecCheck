export function readPanelSource(): string;
export function extractBalanced(src: string, start: RegExp, open?: string): string;
export function panelPresets(src?: string): Record<string, { m: string; min?: number; max?: number }[]>;
export function panelMetricDefs(src?: string): { key: string; label: string; unit: string; int?: boolean; time?: boolean }[];
export function panelParsers(src?: string): {
  parseEbur128(stderr: string): { lufsI: number | null; lra: number | null; truePeak: number | null; minMomentary: number | null };
  parseAstats(stderr: string): { rmsDb: number | null; samplePeakDb: number | null };
  parseSilence(stderr: string, duration: number | null): { headSilence: number; tailSilence: number };
};
export function panelScoring(
  checks: { m: string; min?: number; max?: number }[],
  src?: string,
): {
  score(metrics: Record<string, unknown> | null): {
    byMetric: Record<string, { required: string; pass: boolean | null }>;
    pass: boolean;
    failCount: number;
    unknown: number;
  };
  fmtVal(def: { unit: string; int?: boolean; time?: boolean }, v: number | null | undefined): string;
};
