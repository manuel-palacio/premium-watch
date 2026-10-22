/** Where a value sits within its own history. */
export interface RangeStats {
  min: number;
  max: number;
  median: number;
  /** Share of observations strictly below `current`, 0–100. */
  percentile: number;
  n: number;
}

export function rangeStats(values: number[], current: number): RangeStats | null {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length < 2 || !Number.isFinite(current)) return null;
  const mid = v.length >> 1;
  const median = v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
  const below = v.filter((x) => x < current).length;
  return { min: v[0]!, max: v.at(-1)!, median, percentile: (below / v.length) * 100, n: v.length };
}

/** A % change over `days` compounded to a year. */
export function annualize(pct: number, days: number): number {
  return (Math.pow(1 + pct / 100, 365 / days) - 1) * 100;
}

/**
 * Years of coin-per-share growth at `annualYieldPct` needed for coins per share to catch up with
 * the premium (the "mNAV payback" or "days to cover"): ln(mNAV) / ln(1 + yield).
 * 0 when there is no premium; null when coins per share are not growing.
 */
export function paybackYears(mnav: number | null, annualYieldPct: number | null): number | null {
  if (mnav === null || !Number.isFinite(mnav)) return null;
  if (mnav <= 1) return 0;
  if (annualYieldPct === null || !Number.isFinite(annualYieldPct) || annualYieldPct <= 0) return null;
  return Math.log(mnav) / Math.log(1 + annualYieldPct / 100);
}

/** Where the current value sits in its range, in words. */
export function rangePosition(percentile: number): 'low' | 'middle' | 'high' {
  return percentile <= 20 ? 'low' : percentile >= 80 ? 'high' : 'middle';
}
