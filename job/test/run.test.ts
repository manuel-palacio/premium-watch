import { describe, expect, it } from 'vitest';
import type { Company, LedgerEntry } from '@pw/shared';
import { backfill, cryptoBarsAsPoints } from '../src/backfill.ts';
import { ConsoleNotifier } from '../src/notify.ts';
import { FakeMarketData, FakeSpot } from '../src/providers/fake.ts';
import { RoutedMarketData, nearestPoint, type DailyBar } from '../src/providers/index.ts';
import { unadjustForSplits } from '../src/providers/yahoo.ts';
import { latestClosedSession, runClose, runIntraday, type Deps } from '../src/run.ts';
import { MemoryStore } from '../src/store.ts';

const mstr: Company = { id: 'mstr', name: 'Strategy', ticker: 'MSTR', exchange: 'NASDAQ', currency: 'USD', asset: 'BTC', active: true };
const mp: Company = { id: 'metaplanet', name: 'Metaplanet', ticker: '3350', exchange: 'TSE', currency: 'JPY', asset: 'BTC', active: true };

function ledger(companyId: string): LedgerEntry[] {
  const row = (type: LedgerEntry['type'], value: number): LedgerEntry => ({
    id: `${companyId}-${type}`,
    companyId,
    effectiveDate: '2026-01-01',
    type,
    value,
    sourceUrl: 'https://example.com',
    createdAt: '2026-01-01T00:00:00Z',
  });
  return [row('holdings', 1000), row('shares_basic', 1_000_000), row('shares_diluted', 1_200_000)];
}

function setup(now: string) {
  const store = new MemoryStore();
  store.companies = [mstr, mp];
  store.ledger = [...ledger('mstr'), ...ledger('metaplanet')];
  const notifier = new ConsoleNotifier();
  const logs: string[] = [];
  const deps: Deps = { store, market: new FakeMarketData(), spot: new FakeSpot(), notifier, now: new Date(now), appUrl: 'https://pw.example', log: (m) => logs.push(m) };
  return { store, notifier, deps };
}

describe('latestClosedSession', () => {
  it('uses today after the close and the previous weekday before it', () => {
    expect(latestClosedSession(mstr, new Date('2026-10-21T21:00:00Z'))).toBe('2026-10-21');
    expect(latestClosedSession(mstr, new Date('2026-10-21T15:00:00Z'))).toBe('2026-10-20');
    expect(latestClosedSession(mstr, new Date('2026-10-26T12:00:00Z'))).toBe('2026-10-23'); // Monday morning → Friday
    expect(latestClosedSession(mp, new Date('2026-10-22T07:00:00Z'))).toBe('2026-10-22'); // 16:00 JST
  });
});

describe('runClose', () => {
  it('writes final snapshots for the catch-up window, per market group', async () => {
    const { store, deps } = setup('2026-10-21T22:30:00Z');
    const s = await runClose('us', deps);
    expect(s.errors).toEqual([]);
    expect(s.companies).toBe(1);
    expect(s.written).toBe(4);
    expect([...store.snapshots.keys()].sort()).toEqual(['mstr_2026-10-16', 'mstr_2026-10-19', 'mstr_2026-10-20', 'mstr_2026-10-21']);
    const snap = store.snapshots.get('mstr_2026-10-21')!;
    expect(snap.final).toBe(true);
    expect(snap.stale).toBe(false);
    expect(snap.inputs.spot!.asOf).toBe('2026-10-21T20:00:00.000Z');
    expect(snap.metrics.mnavDiluted).toBeGreaterThan(0);
  });

  it('is idempotent: a rerun writes nothing and keeps finals', async () => {
    const { store, deps } = setup('2026-10-21T22:30:00Z');
    await runClose('all', deps);
    const before = structuredClone([...store.snapshots.values()]);
    const writes = store.writes;
    const again = await runClose('all', { ...deps, now: new Date('2026-10-21T23:30:00Z') });
    expect(store.writes).toBe(writes);
    expect(again.written).toBe(0);
    expect([...store.snapshots.values()]).toEqual(before);
  });

  it('converts the JPY company with FX', async () => {
    const { store, deps } = setup('2026-10-22T07:00:00Z');
    await runClose('tokyo', deps);
    const s = store.snapshots.get('metaplanet_2026-10-22')!;
    expect(s.inputs.fx?.pair).toBe('USDJPY');
    expect(s.metrics.priceUsd).toBeCloseTo(s.inputs.price!.value / s.inputs.fx!.value);
    expect(s.inputs.spot!.asOf).toBe('2026-10-22T06:00:00.000Z'); // hourly fake points, nearest to 06:30Z
  });

  it('flags stale snapshots and leaves them non-final', async () => {
    const { store, deps } = setup('2026-10-21T22:30:00Z');
    store.ledger = store.ledger.filter((e) => !(e.companyId === 'mstr' && e.type === 'holdings'));
    const s = await runClose('us', deps);
    expect(s.stale).toHaveLength(4);
    const snap = store.snapshots.get('mstr_2026-10-21')!;
    expect(snap.final).toBe(false);
    expect(snap.missing).toEqual(['ledger:holdings']);
  });

  it('keeps the latest snapshot open while today’s bar is missing, and skips holidays', async () => {
    const { store, deps } = setup('2026-10-21T22:30:00Z');
    const fake = new FakeMarketData();
    // No bar for Mon 19 (holiday) and none yet for Wed 21.
    deps.market = Object.assign(Object.create(fake), {
      dailyCloses: async (c: Company, f: string, t: string) => (await fake.dailyCloses(c, f, t)).filter((b) => b.date !== '2026-10-19' && b.date !== '2026-10-21'),
    });
    await runClose('us', deps);
    expect(store.snapshots.has('mstr_2026-10-19')).toBe(false);
    const today = store.snapshots.get('mstr_2026-10-21')!;
    expect(today.inputs.price!.date).toBe('2026-10-20');
    expect(today.final).toBe(false);
    expect(today.stale).toBe(false);
  });

  it('reports provider errors per company and continues', async () => {
    const { store, deps } = setup('2026-10-22T22:30:00Z');
    const fake = new FakeMarketData();
    deps.market = Object.assign(Object.create(fake), {
      dailyCloses: async (c: Company, f: string, t: string) => {
        if (c.id === 'mstr') throw new Error('boom');
        return fake.dailyCloses(c, f, t);
      },
    });
    const s = await runClose('all', deps);
    expect(s.errors).toEqual(['mstr: boom']);
    expect([...store.snapshots.keys()].some((k) => k.startsWith('metaplanet_'))).toBe(true);
  });
});

describe('alerts in the job', () => {
  it('fires once, stays quiet, and re-arms after reset', async () => {
    const { store, notifier, deps } = setup('2026-10-21T22:30:00Z');
    store.alerts = [{ id: 'a1', companyId: 'mstr', rule: 'mnav_above', params: { variant: 'diluted', threshold: 0.0001 }, enabled: true }];
    await runClose('us', deps);
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]!.text).toContain('https://pw.example/#/company/mstr');
    expect(store.events).toHaveLength(1);
    expect(store.alerts[0]!.active).toBe(true);

    await runClose('us', { ...deps, now: new Date('2026-10-22T22:30:00Z') });
    expect(notifier.sent).toHaveLength(1);

    store.alerts[0]!.params = { variant: 'diluted', threshold: 1e9 };
    await runClose('us', { ...deps, now: new Date('2026-10-23T22:30:00Z') });
    expect(store.alerts[0]!.active).toBe(false);
    store.alerts[0]!.params = { variant: 'diluted', threshold: 0.0001 };
    await runClose('us', { ...deps, now: new Date('2026-10-26T22:30:00Z') });
    expect(notifier.sent).toHaveLength(2);
  });
});

describe('runIntraday', () => {
  it('only touches exchanges that are open and never overwrites a final snapshot', async () => {
    const { store, deps } = setup('2026-10-22T15:00:00Z'); // 11:00 New York, Tokyo closed
    const s = await runIntraday('all', deps);
    expect(s.companies).toBe(1);
    const snap = store.snapshots.get('mstr_2026-10-22')!;
    expect(snap.kind).toBe('intraday');
    expect(snap.final).toBe(false);

    await runClose('us', { ...deps, now: new Date('2026-10-22T22:30:00Z') });
    expect(store.snapshots.get('mstr_2026-10-22')!.final).toBe(true);
    const again = await runIntraday('all', { ...deps, now: new Date('2026-10-22T19:00:00Z') });
    expect(again.skippedFinal).toBe(1);
  });
});

describe('backfill', () => {
  it('builds history from the ledger as it stood on each date', async () => {
    const { store, deps } = setup('2026-10-22T12:00:00Z');
    store.ledger.push({ id: 'h2', companyId: 'mstr', effectiveDate: '2026-03-02', type: 'holdings', value: 2000, sourceUrl: 'https://x.com', createdAt: '2026-03-02T00:00:00Z' });
    const r = await backfill({ from: '2026-02-23', to: '2026-03-06', companyIds: ['mstr'] }, deps);
    expect(r.written).toBe(10);
    expect(store.snapshots.get('mstr_2026-02-27')!.inputs.ledger.holdings!.value).toBe(1000);
    expect(store.snapshots.get('mstr_2026-03-02')!.inputs.ledger.holdings!.value).toBe(2000);
    expect(store.snapshots.get('mstr_2026-03-02')!.final).toBe(true);

    const again = await backfill({ from: '2026-02-23', to: '2026-03-06', companyIds: ['mstr'] }, deps);
    expect(again).toMatchObject({ written: 0, skipped: 10 });
  });

  it('maps a UTC crypto day to the nearest exchange close', () => {
    const pts = cryptoBarsAsPoints([
      { date: '2026-10-20', close: 1 },
      { date: '2026-10-21', close: 2 },
    ]);
    // Tokyo close 2026-10-21 06:30Z → bar 10-20 (ends 10-21 00:00Z); New York close 20:00Z → bar 10-21.
    expect(nearestPoint(pts, new Date('2026-10-21T06:30:00Z'), 12 * 3.6e6)!.usd).toBe(1);
    expect(nearestPoint(pts, new Date('2026-10-21T20:00:00Z'), 12 * 3.6e6)!.usd).toBe(2);
  });
});

describe('providers', () => {
  it('un-adjusts Yahoo closes for later splits', () => {
    const bars = [
      { date: new Date('2024-08-01T13:30:00Z'), close: 150 },
      { date: new Date('2024-08-09T13:30:00Z'), close: 140 },
    ];
    const out = unadjustForSplits(bars, [{ date: new Date('2024-08-08T13:30:00Z'), numerator: 10, denominator: 1 }]);
    expect(out.map((b) => b.close)).toEqual([1500, 140]);
  });

  it('routes by exchange from env', () => {
    const r = RoutedMarketData.fromEnv({ MARKET_DATA_PROVIDER: 'fake', MARKET_DATA_PROVIDER_TSE: 'yahoo' });
    expect(r.providerName('NASDAQ')).toBe('fake');
    expect(r.providerName('TSE')).toBe('yahoo');
    expect(() => RoutedMarketData.fromEnv({ MARKET_DATA_PROVIDER: 'nope' })).toThrow(/unknown/);
  });

  it('EODHD refuses Tokyo and says how to route it', async () => {
    const r = RoutedMarketData.fromEnv({ MARKET_DATA_PROVIDER: 'eodhd', EODHD_API_KEY: 'x' });
    expect(() => r.dailyCloses(mp, '2026-10-01', '2026-10-02')).toThrow(/MARKET_DATA_PROVIDER_TSE/);
  });

  it('EODHD parses raw closes', async () => {
    const { EodhdProvider } = await import('../src/providers/eodhd.ts');
    let called = '';
    const fetchFn = (async (u: URL) => {
      called = u.toString();
      return new Response(JSON.stringify([{ date: '2026-10-21', close: 153.48, adjusted_close: 153.48 }]));
    }) as unknown as typeof fetch;
    const p = new EodhdProvider('k', fetchFn);
    const bars: DailyBar[] = await p.dailyCloses(mstr, '2026-10-20', '2026-10-21');
    expect(bars).toEqual([{ date: '2026-10-21', close: 153.48 }]);
    expect(called).toContain('/eod/MSTR.US');
    expect(called).toContain('api_token=k');
  });
});
