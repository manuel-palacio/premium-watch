import { daysBetween, tradingDaysBetween } from './dates.ts';
import { toUsd } from './fx.ts';
import { ledgerAsOf } from './ledger.ts';
import { coinYield, computeMetrics } from './metrics.ts';
import {
  LEDGER_TYPES,
  OPTIONAL_LEDGER_TYPES,
  REQUIRED_LEDGER_TYPES,
  type Company,
  type IsoDate,
  type IsoTimestamp,
  type LedgerEntry,
  type LedgerType,
  type Snapshot,
  type SnapshotInputs,
} from './types.ts';

export function snapshotId(companyId: string, date: IsoDate): string {
  return `${companyId}_${date}`;
}

/** Max age of an equity price or FX rate, in trading days, before it counts as stale. */
export const MAX_PRICE_AGE_TRADING_DAYS = 1;
/** Max age of a crypto spot price, in calendar days (crypto trades every day). */
export const MAX_SPOT_AGE_DAYS = 1;

export interface BuildSnapshotArgs {
  company: Company;
  date: IsoDate;
  kind: 'close' | 'intraday';
  final: boolean;
  computedAt: IsoTimestamp;
  price: SnapshotInputs['price'];
  spot: SnapshotInputs['spot'];
  fx: SnapshotInputs['fx'];
  /** The company's full ledger; only entries effective on or before `date` are used. */
  ledger: readonly LedgerEntry[];
}

/** Missing or stale inputs, as short codes like `ledger:holdings` or `price:stale`. */
export function findMissingInputs(a: BuildSnapshotArgs, ledgerTypes: Set<LedgerType>): string[] {
  const missing: string[] = [];
  for (const t of REQUIRED_LEDGER_TYPES) if (!ledgerTypes.has(t)) missing.push(`ledger:${t}`);

  if (!a.price) missing.push('price:missing');
  else if (tradingDaysBetween(a.price.date, a.date) > MAX_PRICE_AGE_TRADING_DAYS) missing.push('price:stale');

  if (!a.spot) missing.push('spot:missing');
  else if (daysBetween(a.spot.asOf.slice(0, 10), a.date) > MAX_SPOT_AGE_DAYS) missing.push('spot:stale');

  if (a.company.currency !== 'USD') {
    if (!a.fx) missing.push('fx:missing');
    else if (tradingDaysBetween(a.fx.date, a.date) > MAX_PRICE_AGE_TRADING_DAYS) missing.push('fx:stale');
  }
  return missing;
}

/** Build a snapshot from its inputs. Pure: the same inputs give the same snapshot. */
export function buildSnapshot(a: BuildSnapshotArgs): Snapshot {
  const { company, date } = a;
  const state = ledgerAsOf(a.ledger, company.id, date);
  const usdJpy = company.currency === 'USD' ? null : (a.fx?.value ?? null);
  const money = (t: LedgerType) => {
    const v = state[t]?.value;
    return v === undefined ? null : toUsd(v, company.currency, usdJpy);
  };

  const inputs: SnapshotInputs = {
    price: a.price,
    spot: a.spot,
    fx: company.currency === 'USD' ? null : a.fx,
    ledger: {},
  };
  for (const t of LEDGER_TYPES) {
    const e = state[t];
    if (e) inputs.ledger[t] = { ledgerId: e.id, value: e.value, effectiveDate: e.effectiveDate };
  }

  const base = computeMetrics({
    priceUsd: a.price ? toUsd(a.price.value, a.price.currency, usdJpy) : null,
    spotUsd: a.spot?.usd ?? null,
    holdings: state.holdings?.value ?? null,
    sharesBasic: state.shares_basic?.value ?? null,
    sharesDiluted: state.shares_diluted?.value ?? null,
    debtUsd: money('debt'),
    preferredUsd: money('preferred'),
    cashUsd: money('cash'),
  });

  const missing = findMissingInputs(a, new Set(Object.keys(state) as LedgerType[]));
  return {
    id: snapshotId(company.id, date),
    companyId: company.id,
    date,
    kind: a.kind,
    final: a.final,
    computedAt: a.computedAt,
    inputs,
    metrics: {
      ...base,
      coinYield30d: coinYield(a.ledger, company.id, date, 30),
      coinYield90d: coinYield(a.ledger, company.id, date, 90),
      coinYield365d: coinYield(a.ledger, company.id, date, 365),
    },
    stale: missing.length > 0,
    missing,
    assumedZero: OPTIONAL_LEDGER_TYPES.filter((t) => !state[t]),
  };
}

/** JSON with object keys sorted, so key order does not matter. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** True if two snapshots carry the same inputs and results (ignores `computedAt` and key order). */
export function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  const strip = ({ computedAt: _c, ...rest }: Snapshot) => rest;
  return canonical(strip(a)) === canonical(strip(b));
}
