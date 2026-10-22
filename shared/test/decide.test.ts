import { describe, expect, it } from 'vitest';
import { annualize, paybackYears, rangePosition, rangeStats } from '../src/decide.ts';

describe('rangeStats', () => {
  it('computes min, max, median and the share of days below today', () => {
    expect(rangeStats([3, 1, 2, 4], 2.5)).toEqual({ min: 1, max: 4, median: 2.5, percentile: 50, n: 4 });
    expect(rangeStats([1, 2, 3], 0.5)?.percentile).toBe(0);
    expect(rangeStats([1, 2, 3], 9)?.percentile).toBe(100);
  });
  it('needs at least two finite values', () => {
    expect(rangeStats([1], 1)).toBeNull();
    expect(rangeStats([1, NaN], 1)).toBeNull();
  });
});

describe('annualize', () => {
  it('compounds a 90-day change to a year', () => {
    expect(annualize(0, 90)).toBe(0);
    expect(annualize(10, 365)).toBeCloseTo(10);
    expect(annualize(5, 90)).toBeCloseTo((1.05 ** (365 / 90) - 1) * 100);
  });
});

describe('paybackYears', () => {
  it('is ln(mNAV) / ln(1 + yield)', () => {
    expect(paybackYears(2, 100)).toBeCloseTo(1);
    expect(paybackYears(1.5, 20)).toBeCloseTo(Math.log(1.5) / Math.log(1.2));
  });
  it('is 0 without a premium and null without growth', () => {
    expect(paybackYears(0.8, 10)).toBe(0);
    expect(paybackYears(1.5, 0)).toBeNull();
    expect(paybackYears(1.5, -3)).toBeNull();
    expect(paybackYears(null, 10)).toBeNull();
  });
});

describe('rangePosition', () => {
  it('splits at the 20th and 80th percentile', () => {
    expect(rangePosition(20)).toBe('low');
    expect(rangePosition(50)).toBe('middle');
    expect(rangePosition(80)).toBe('high');
  });
});
