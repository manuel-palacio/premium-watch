import { addDays, buildSnapshot, dateRange, isWeekday, snapshotId, type Asset, type IsoDate, type Snapshot } from '@pw/shared';
import { pickInputs, type Deps } from './run.ts';
import type { DailyBar, SpotPoint } from './providers/index.ts';

export interface BackfillOptions {
  from: IsoDate;
  to: IsoDate;
  companyIds?: string[];
  /** Overwrite snapshots that are already final. */
  force?: boolean;
  dryRun?: boolean;
}

/**
 * Crypto daily bars are UTC days; bar D closes at D+1 00:00Z. Expressed as spot points, the
 * snapshot picks the bar whose end is nearest the exchange close (Tokyo → previous UTC day).
 */
export function cryptoBarsAsPoints(bars: DailyBar[]): SpotPoint[] {
  return bars.map((b) => ({ at: new Date(`${addDays(b.date, 1)}T00:00:00Z`), usd: b.close }));
}

/** Build historical daily close snapshots using the ledger as it stood on each date. */
export async function backfill(opts: BackfillOptions, deps: Deps): Promise<{ written: number; skipped: number; stale: number }> {
  const all = await deps.store.listCompanies();
  const companies = all.filter((c) => (opts.companyIds?.length ? opts.companyIds.includes(c.id) : c.active));
  const crypto = new Map<Asset, Promise<DailyBar[]>>();
  const fxP = deps.market.usdJpyDaily(addDays(opts.from, -7), opts.to);
  let written = 0;
  let skipped = 0;
  let stale = 0;

  for (const company of companies) {
    if (!crypto.has(company.asset)) crypto.set(company.asset, deps.market.cryptoDaily(company.asset, addDays(opts.from, -2), opts.to));
    const [bars, fxBars, cryptoBars, ledger] = await Promise.all([
      deps.market.dailyCloses(company, addDays(opts.from, -7), opts.to),
      company.currency === 'USD' ? Promise.resolve([]) : fxP,
      crypto.get(company.asset)!,
      deps.store.ledgerFor(company.id),
    ]);
    const barDates = new Set(bars.map((b) => b.date));
    // Nothing to compute before the first holdings entry.
    const firstHolding = ledger.filter((e) => e.type === 'holdings').reduce<IsoDate | null>((m, e) => (m === null || e.effectiveDate < m ? e.effectiveDate : m), null);
    if (!firstHolding) {
      deps.log(`${company.id}: no holdings in the ledger, skipped`);
      continue;
    }
    const start = firstHolding > opts.from ? firstHolding : opts.from;
    const dates = dateRange(start, opts.to).filter((d) => isWeekday(d) && barDates.has(d));
    const existing = await deps.store.getSnapshots(dates.map((d) => snapshotId(company.id, d)));
    const points = cryptoBarsAsPoints(cryptoBars);
    const src = { price: `${deps.market.name} (backfill)`, fx: `${deps.market.name} (backfill)`, spot: `${deps.market.name} crypto daily (backfill)` };

    const out: Snapshot[] = [];
    for (const date of dates) {
      if (existing.get(snapshotId(company.id, date))?.final && !opts.force) {
        skipped++;
        continue;
      }
      const inputs = pickInputs(company, date, bars, fxBars, points, src, 12 * 3_600_000);
      const s = buildSnapshot({ company, date, kind: 'close', final: false, computedAt: deps.now.toISOString(), ...inputs, ledger });
      s.final = !s.stale;
      if (s.stale) stale++;
      out.push(s);
    }
    if (!opts.dryRun) await deps.store.putSnapshots(out);
    written += out.length;
    deps.log(`${company.id}: ${out.length} snapshot(s)${opts.dryRun ? ' (dry run)' : ''}, ${out.filter((s) => s.stale).length} stale`);
  }
  return { written, skipped, stale };
}
