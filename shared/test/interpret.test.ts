import { describe, expect, it } from 'vitest';
import { readMnav } from '../src/interpret.ts';

const m = (mnavDiluted: number | null, mnavEv: number | null = null, coinYield90d: number | null = null) => ({ mnavDiluted, mnavEv, coinYield90d });

describe('readMnav', () => {
  it('returns null without a diluted mNAV', () => {
    expect(readMnav(m(null))).toBeNull();
  });

  it('labels the bands', () => {
    expect(readMnav(m(0.64))?.label).toBe('Discount');
    expect(readMnav(m(1))?.label).toBe('Near NAV');
    expect(readMnav(m(1.6))?.label).toBe('Premium');
    expect(readMnav(m(2))?.label).toBe('High premium');
  });

  it('explains a discount that disappears once debt is counted', () => {
    const r = readMnav(m(0.64, 1.25));
    expect(r?.tone).toBe('discount');
    expect(r?.text).toContain('36% below');
    expect(r?.text).toContain('EV 1.25×');
    expect(r?.text).toContain('creditors come first');
  });

  it('flags a premium that coin yield is not earning', () => {
    expect(readMnav(m(2.4, 2.5, 0))?.text).toContain('not being earned');
    expect(readMnav(m(2.4, 2.5, 3.2))?.text).toContain('grew 3.2%');
    expect(readMnav(m(0.8, 0.9, -1.5))?.text).toContain('fell 1.5%');
  });

  it('mentions leverage only when EV is clearly above diluted', () => {
    expect(readMnav(m(1.6, 1.7))?.text).not.toContain('EV');
    expect(readMnav(m(1.6, 2.1))?.text).toContain('EV 2.10×');
  });
});

describe('readMnav with history and payback', () => {
  const range = { min: 1.2, max: 3, median: 2, percentile: 10, n: 250 };
  it('places today in its past year', () => {
    expect(readMnav(m(1.3), { range })?.text).toContain('near the bottom of its past year (1.20× to 3.00×)');
    expect(readMnav(m(2.9), { range: { ...range, percentile: 95 } })?.text).toContain('near the top');
    expect(readMnav(m(2), { range: { ...range, percentile: 50 } })?.text).toContain('mid-range');
  });
  it('names a shorter window', () => {
    expect(readMnav(m(1.3), { range, rangeLabel: 'since 15 Sep 2026' })?.text).toContain('near the bottom of its range since 15 Sep 2026');
  });
  it('states the payback only for a premium', () => {
    expect(readMnav(m(1.6, null, 5), { payback: 2.4 })?.text).toContain('about 2.4 years');
    expect(readMnav(m(1.1, null, 9), { payback: 0.5 })?.text).toContain('within a year');
    expect(readMnav(m(0.8, null, 5), { payback: 0 })?.text).not.toContain('earn back');
  });
});
