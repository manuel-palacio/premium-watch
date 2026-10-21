import { describe, expect, it } from 'vitest';
import { buildSnapshot, sameSnapshot, tradingDaysBetween, type BuildSnapshotArgs } from '../src/index.ts';
import { entry, metaplanet, mstr } from './fixtures.ts';

const mstrLedger = [
  entry('mstr', '2026-01-01', 'holdings', 600_000),
  entry('mstr', '2026-01-01', 'shares_basic', 250_000_000),
  entry('mstr', '2026-01-01', 'shares_diluted', 300_000_000),
  entry('mstr', '2026-01-01', 'debt', 8e9),
];

const base: BuildSnapshotArgs = {
  company: mstr,
  date: '2026-10-21',
  kind: 'close',
  final: true,
  computedAt: '2026-10-21T21:00:00Z',
  price: { value: 300, currency: 'USD', date: '2026-10-21', source: 'fake' },
  spot: { asset: 'BTC', usd: 100_000, asOf: '2026-10-21T20:05:00Z', source: 'fake' },
  fx: null,
  ledger: mstrLedger,
};

describe('buildSnapshot', () => {
  it('computes metrics and records inputs with ledger ids', () => {
    const s = buildSnapshot(base);
    expect(s.id).toBe('mstr_2026-10-21');
    expect(s.metrics.mnavDiluted).toBeCloseTo(1.5);
    expect(s.inputs.ledger.holdings).toEqual({ ledgerId: mstrLedger[0]!.id, value: 600_000, effectiveDate: '2026-01-01' });
    expect(s.stale).toBe(false);
    expect(s.missing).toEqual([]);
    expect(s.assumedZero).toEqual(['preferred', 'cash']);
  });

  it('is deterministic', () => {
    const a = buildSnapshot(base);
    const b = buildSnapshot({ ...base, computedAt: '2026-10-22T09:00:00Z', ledger: [...mstrLedger].reverse() });
    expect(sameSnapshot(a, b)).toBe(true);
  });

  it('flags missing ledger entries', () => {
    const s = buildSnapshot({ ...base, ledger: mstrLedger.filter((e) => e.type !== 'shares_diluted') });
    expect(s.stale).toBe(true);
    expect(s.missing).toEqual(['ledger:shares_diluted']);
    expect(s.metrics.mnavDiluted).toBeNull();
    expect(s.metrics.mnavBasic).toBeCloseTo(1.25);
  });

  it('flags a price older than one trading day', () => {
    // Snapshot Wed 21 Oct: Tue 20 is fine, Mon 19 is stale.
    expect(buildSnapshot({ ...base, price: { ...base.price!, date: '2026-10-20' } }).stale).toBe(false);
    expect(buildSnapshot({ ...base, price: { ...base.price!, date: '2026-10-19' } }).missing).toEqual(['price:stale']);
  });

  it('a Friday price is fresh on Monday', () => {
    const s = buildSnapshot({ ...base, date: '2026-10-26', price: { ...base.price!, date: '2026-10-23' }, spot: { ...base.spot!, asOf: '2026-10-26T20:00:00Z' } });
    expect(s.stale).toBe(false);
  });

  it('flags missing price and spot', () => {
    const s = buildSnapshot({ ...base, price: null, spot: null });
    expect(s.missing).toEqual(['price:missing', 'spot:missing']);
    expect(s.metrics.nav).toBeNull();
  });

  it('flags stale spot', () => {
    expect(buildSnapshot({ ...base, spot: { ...base.spot!, asOf: '2026-10-19T00:00:00Z' } }).missing).toEqual(['spot:stale']);
  });

  it('converts a JPY company with the snapshot FX rate', () => {
    const ledger = [
      entry('metaplanet', '2026-01-01', 'holdings', 30_000),
      entry('metaplanet', '2026-01-01', 'shares_basic', 1_000_000_000),
      entry('metaplanet', '2026-01-01', 'shares_diluted', 1_200_000_000),
      entry('metaplanet', '2026-01-01', 'debt', 150e9), // ¥150bn = $1bn at 150
      entry('metaplanet', '2026-01-01', 'cash', 15e9), //  ¥15bn = $0.1bn
    ];
    const s = buildSnapshot({
      ...base,
      company: metaplanet,
      price: { value: 900, currency: 'JPY', date: '2026-10-21', source: 'fake' },
      fx: { pair: 'USDJPY', value: 150, date: '2026-10-21', source: 'fake' },
      ledger,
    });
    expect(s.metrics.priceUsd).toBe(6);
    expect(s.metrics.nav).toBe(3e9);
    expect(s.metrics.marketCapBasic).toBe(6e9);
    expect(s.metrics.mnavBasic).toBeCloseTo(2);
    expect(s.metrics.mnavDiluted).toBeCloseTo(2.4);
    expect(s.metrics.enterpriseValue).toBeCloseTo(6e9 + 1e9 - 0.1e9);
    expect(s.stale).toBe(false);
  });

  it('flags a JPY company without FX and leaves USD values null', () => {
    const s = buildSnapshot({
      ...base,
      company: metaplanet,
      price: { value: 900, currency: 'JPY', date: '2026-10-21', source: 'fake' },
      fx: null,
      ledger: [entry('metaplanet', '2026-01-01', 'holdings', 1)],
    });
    expect(s.missing).toContain('fx:missing');
    expect(s.metrics.priceUsd).toBeNull();
  });
});

describe('tradingDaysBetween', () => {
  it('skips weekends', () => {
    expect(tradingDaysBetween('2026-10-23', '2026-10-26')).toBe(1); // Fri → Mon
    expect(tradingDaysBetween('2026-10-21', '2026-10-21')).toBe(0);
    expect(tradingDaysBetween('2026-10-19', '2026-10-23')).toBe(4);
  });
});
