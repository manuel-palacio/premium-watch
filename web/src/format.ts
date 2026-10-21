import { daysBetween, type Snapshot } from '@pw/shared';

const nf = (d: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

export const dash = '–';

export function mnav(v: number | null | undefined): string {
  return v === null || v === undefined ? dash : `${nf(2).format(v)}×`;
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return dash;
  return `${v > 0 ? '+' : ''}${nf(digits).format(v)}%`;
}

export function usd(v: number | null | undefined): string {
  if (v === null || v === undefined) return dash;
  const a = Math.abs(v);
  if (a >= 1e9) return `$${nf(2).format(v / 1e9)}bn`;
  if (a >= 1e6) return `$${nf(1).format(v / 1e6)}m`;
  return `$${nf(0).format(v)}`;
}

export function coins(v: number | null | undefined): string {
  if (v === null || v === undefined) return dash;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: v < 100 ? 4 : 0 }).format(v);
}

export function plain(v: number | null | undefined): string {
  return v === null || v === undefined ? dash : new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(v);
}

/** Coins per share are tiny numbers, so show four significant digits. */
export function perShare(v: number | null | undefined): string {
  return v === null || v === undefined ? dash : v.toPrecision(4);
}

export function freshness(s: Snapshot | undefined, today: string): { text: string; old: boolean } {
  if (!s) return { text: 'no data', old: true };
  const age = daysBetween(s.date, today);
  const when = s.kind === 'intraday' ? `${s.date} ${s.computedAt.slice(11, 16)}Z` : s.date;
  return { text: `${when}${age > 0 ? ` · ${age}d ago` : ''}`, old: age > 4 };
}

export function signClass(v: number | null | undefined): string {
  return v === null || v === undefined || v === 0 ? '' : v > 0 ? 'good' : 'bad';
}

const MISSING_LABEL: Record<string, string> = {
  'ledger:holdings': 'no holdings',
  'ledger:shares_basic': 'no basic shares',
  'ledger:shares_diluted': 'no diluted shares',
  'price:missing': 'no price',
  'price:stale': 'price stale',
  'spot:missing': 'no spot',
  'spot:stale': 'spot stale',
  'fx:missing': 'no FX',
  'fx:stale': 'FX stale',
};
export const missingLabel = (m: string) => MISSING_LABEL[m] ?? m;
