import { rangePosition, type RangeStats } from './decide.ts';
import type { Metrics } from './types.ts';

export type Tone = 'discount' | 'fair' | 'premium' | 'high';

export interface Reading {
  label: string;
  tone: Tone;
  /** A few plain sentences. */
  text: string;
}

export interface ReadingContext {
  /** Diluted mNAV over the past year. */
  range?: RangeStats | null;
  /** How to name that window, e.g. "past year" or "since 15 Sep 2026" when history is shorter. */
  rangeLabel?: string;
  /** Years for coin yield to earn back the premium (paybackYears). */
  payback?: number | null;
}

/** mNAV bands for the plain-language reading. A rule of thumb, not a valuation model. */
export const MNAV_BANDS = [
  { below: 1, label: 'Discount', tone: 'discount' },
  { below: 1.25, label: 'Near NAV', tone: 'fair' },
  { below: 2, label: 'Premium', tone: 'premium' },
  { below: Infinity, label: 'High premium', tone: 'high' },
] as const;

const x = (v: number) => `${v.toFixed(2)}×`;

/** Plain-language reading of one snapshot's diluted mNAV, with EV, history and coin yield as context. */
export function readMnav(m: Pick<Metrics, 'mnavDiluted' | 'mnavEv' | 'coinYield90d'>, ctx: ReadingContext = {}): Reading | null {
  const d = m.mnavDiluted;
  if (d === null || !Number.isFinite(d)) return null;
  const band = MNAV_BANDS.find((b) => d < b.below)!;
  const parts: string[] = [];

  if (d < 1) parts.push(`The stock is valued ${Math.round((1 - d) * 100)}% below the coins it holds.`);
  else if (d < 1.25) parts.push(`The stock is valued about the same as its coins (${x(d)}).`);
  else parts.push(`Investors pay ${x(d)} the value of the coins.`);

  const ev = m.mnavEv;
  if (ev !== null && Number.isFinite(ev)) {
    if (d < 1 && ev >= 1) parts.push(`Counting debt and preferred (EV ${x(ev)}), there is no discount: creditors come first.`);
    else if (ev - d >= 0.25) parts.push(`Debt and preferred add to that (EV ${x(ev)}).`);
  }

  const r = ctx.range;
  if (r) {
    const pos = rangePosition(r.percentile);
    const span = ctx.rangeLabel ?? 'past year';
    const of = span === 'past year' ? 'its past year' : `its range ${span}`;
    if (pos === 'low') parts.push(`That is near the bottom of ${of} (${x(r.min)} to ${x(r.max)}).`);
    else if (pos === 'high') parts.push(`That is near the top of ${of} (${x(r.min)} to ${x(r.max)}).`);
    else parts.push(`That is mid-range for ${of} (${x(r.min)} to ${x(r.max)}).`);
  }

  const y = m.coinYield90d;
  if (y !== null && Number.isFinite(y)) {
    if (d >= 1.25 && y <= 0) parts.push('Coins per share have not grown in 90 days, so the premium is not being earned.');
    else if (y > 0) parts.push(`Coins per share grew ${y.toFixed(1)}% in 90 days.`);
    else if (y < 0) parts.push(`Coins per share fell ${Math.abs(y).toFixed(1)}% in 90 days.`);
  }

  const p = ctx.payback;
  if (d > 1 && p !== null && p !== undefined && Number.isFinite(p)) {
    parts.push(p < 1 ? 'At that pace the premium is earned back within a year.' : `At that pace it takes about ${p.toFixed(1)} years to earn back the premium.`);
  }

  return { label: band.label, tone: band.tone, text: parts.join(' ') };
}
