import { addDays, annualize, mnavOf, paybackYears, pctChange, rangeStats, readMnav, type Company, type RangeStats, type Reading, type Snapshot } from '@pw/shared';

/** Everything the overview and company page say about one company, computed once. */
export interface Analysis {
  company: Company;
  latest: Snapshot | undefined;
  /** Non-stale snapshots, oldest first. */
  usable: Snapshot[];
  mnav: number | null;
  /** Diluted mNAV over the 365 days before the latest snapshot. */
  range: RangeStats | null;
  change30d: number | null;
  yield90d: number | null;
  /** 90-day coin yield compounded to a year. */
  yieldAnnual: number | null;
  payback: number | null;
  reading: Reading | null;
}

/** Latest snapshot with a value on or before `date`. */
export function snapshotOnOrBefore(list: Snapshot[], date: string): Snapshot | undefined {
  for (let i = list.length - 1; i >= 0; i--) if (list[i]!.date <= date) return list[i];
  return undefined;
}

export function analyse(company: Company, snaps: Snapshot[]): Analysis {
  const latest = snaps.at(-1);
  const usable = snaps.filter((s) => !s.stale);
  const m = latest?.metrics;
  const current = m ? mnavOf(m, 'diluted') : null;
  const yearAgo = latest ? addDays(latest.date, -365) : '';
  const year = usable.filter((s) => s.date >= yearAgo).map((s) => mnavOf(s.metrics, 'diluted')).filter((v): v is number => v !== null);
  const range = current !== null ? rangeStats(year, current) : null;
  const past = latest ? snapshotOnOrBefore(usable, addDays(latest.date, -30)) : undefined;
  const change30d = pctChange(past ? mnavOf(past.metrics, 'diluted') : null, current);
  const yield90d = m?.coinYield90d ?? null;
  const yieldAnnual = yield90d === null ? null : annualize(yield90d, 90);
  const payback = paybackYears(current, yieldAnnual);
  const reading = m ? readMnav(m, { range, payback }) : null;
  return { company, latest, usable, mnav: current, range, change30d, yield90d, yieldAnnual, payback, reading };
}

export function paybackText(a: Pick<Analysis, 'mnav' | 'payback'>): string {
  if (a.mnav === null) return '–';
  if (a.mnav <= 1) return 'none';
  if (a.payback === null) return 'never';
  return a.payback < 10 ? `${a.payback.toFixed(1)} yrs` : '10+ yrs';
}
