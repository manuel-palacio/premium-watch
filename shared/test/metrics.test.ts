import { describe, expect, it } from 'vitest';
import { coinYield, computeMetrics, enterpriseValue, ledgerAsOf, nav, pctChange, toUsd } from '../src/index.ts';
import { entry } from './fixtures.ts';

describe('nav / mNAV', () => {
  const m = computeMetrics({
    priceUsd: 300,
    spotUsd: 100_000,
    holdings: 600_000,
    sharesBasic: 250_000_000,
    sharesDiluted: 300_000_000,
    debtUsd: 8e9,
    preferredUsd: 5e9,
    cashUsd: 1e9,
  });

  it('NAV = coins × spot', () => expect(m.nav).toBe(60e9));
  it('basic mNAV uses basic shares', () => {
    expect(m.marketCapBasic).toBe(75e9);
    expect(m.mnavBasic).toBeCloseTo(1.25);
  });
  it('diluted mNAV uses fully diluted shares', () => {
    expect(m.marketCapDiluted).toBe(90e9);
    expect(m.mnavDiluted).toBeCloseTo(1.5);
  });
  it('EV mNAV = (basic mcap + debt + preferred − cash) / NAV', () => {
    expect(m.enterpriseValue).toBe(75e9 + 8e9 + 5e9 - 1e9);
    expect(m.mnavEv).toBeCloseTo(87 / 60);
  });
  it('coins per share', () => {
    expect(m.coinsPerShareBasic).toBeCloseTo(0.0024);
    expect(m.coinsPerShareDiluted).toBeCloseTo(0.002);
  });

  it('missing inputs give null, never NaN or Infinity', () => {
    const x = computeMetrics({ priceUsd: null, spotUsd: 1, holdings: 0, sharesBasic: null, sharesDiluted: 0, debtUsd: null, preferredUsd: null, cashUsd: null });
    expect(x.nav).toBe(0);
    expect(x.mnavBasic).toBeNull();
    expect(x.mnavDiluted).toBeNull();
    expect(x.coinsPerShareDiluted).toBeNull();
    expect(nav(null, 5)).toBeNull();
  });

  it('EV treats missing debt/preferred/cash as zero', () => {
    expect(enterpriseValue(100, null, null, null)).toBe(100);
    expect(enterpriseValue(100, 10, null, 30)).toBe(80);
    expect(enterpriseValue(null, 10, 0, 0)).toBeNull();
  });
});

describe('JPY conversion', () => {
  it('divides yen by USD/JPY', () => expect(toUsd(1500, 'JPY', 150)).toBe(10));
  it('passes USD through', () => expect(toUsd(42, 'USD', null)).toBe(42));
  it('returns null without a usable rate', () => {
    expect(toUsd(1500, 'JPY', null)).toBeNull();
    expect(toUsd(1500, 'JPY', 0)).toBeNull();
  });
});

describe('ledger as-of', () => {
  const ledger = [
    entry('mstr', '2026-01-10', 'holdings', 100),
    entry('mstr', '2026-02-10', 'holdings', 150),
    entry('mstr', '2026-02-10', 'holdings', 155, '2026-03-01T00:00:00Z'), // correction, created later
    entry('mstr', '2026-03-10', 'holdings', 200),
    entry('other', '2026-01-01', 'holdings', 999),
  ];
  it('is undefined before the first entry', () => expect(ledgerAsOf(ledger, 'mstr', '2026-01-09').holdings).toBeUndefined());
  it('applies an entry on its effective date', () => expect(ledgerAsOf(ledger, 'mstr', '2026-01-10').holdings?.value).toBe(100));
  it('keeps the value until the next entry', () => expect(ledgerAsOf(ledger, 'mstr', '2026-02-09').holdings?.value).toBe(100));
  it('later-created entry wins on the same date', () => expect(ledgerAsOf(ledger, 'mstr', '2026-02-10').holdings?.value).toBe(155));
  it('ignores other companies and future entries', () => expect(ledgerAsOf(ledger, 'mstr', '2027-01-01').holdings?.value).toBe(200));
  it('is independent of input order', () =>
    expect(ledgerAsOf([...ledger].reverse(), 'mstr', '2026-02-15').holdings?.value).toBe(155));
});

describe('coin yield', () => {
  const ledger = [
    entry('mstr', '2025-01-01', 'holdings', 100),
    entry('mstr', '2025-01-01', 'shares_diluted', 1000),
    entry('mstr', '2025-12-01', 'holdings', 130),
    entry('mstr', '2025-12-01', 'shares_diluted', 1100),
  ];
  it('compares coins per diluted share N days apart', () => {
    // 0.1 → 130/1100 = 0.11818…
    expect(coinYield(ledger, 'mstr', '2026-01-01', 365)).toBeCloseTo((130 / 1100 / 0.1 - 1) * 100);
  });
  it('is zero when nothing changed in the window', () => expect(coinYield(ledger, 'mstr', '2026-01-01', 30)).toBe(0));
  it('is null when the start is before the ledger', () => expect(coinYield(ledger, 'mstr', '2025-06-01', 365)).toBeNull());
  it('accounts for dilution: more coins, more shares', () => {
    const l = [...ledger, entry('mstr', '2026-01-15', 'shares_diluted', 1500)];
    expect(coinYield(l, 'mstr', '2026-01-20', 30)!).toBeLessThan(0);
  });
});

describe('pctChange', () => {
  it('works', () => expect(pctChange(2, 1.5)).toBe(-25));
  it('null-safe', () => {
    expect(pctChange(0, 1)).toBeNull();
    expect(pctChange(null, 1)).toBeNull();
  });
});
