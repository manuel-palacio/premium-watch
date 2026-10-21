import { addDays } from './dates.ts';
import { ledgerAsOf, ledgerValue } from './ledger.ts';
import type { IsoDate, LedgerEntry, Metrics, MnavVariant } from './types.ts';

export interface MetricInputs {
  /** Share price already converted to USD. */
  priceUsd: number | null;
  /** Coin spot price in USD. */
  spotUsd: number | null;
  holdings: number | null;
  sharesBasic: number | null;
  sharesDiluted: number | null;
  /** Debt, preferred at liquidation value and cash, in USD. Missing counts as 0. */
  debtUsd: number | null;
  preferredUsd: number | null;
  cashUsd: number | null;
}

const ratio = (a: number | null, b: number | null): number | null =>
  a === null || b === null || b === 0 ? null : a / b;
const mul = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : a * b);

/** NAV = coins held × coin spot price. */
export function nav(holdings: number | null, spotUsd: number | null): number | null {
  return mul(holdings, spotUsd);
}

/** EV = market cap (basic) + debt + preferred − cash. */
export function enterpriseValue(
  marketCapBasic: number | null,
  debtUsd: number | null,
  preferredUsd: number | null,
  cashUsd: number | null,
): number | null {
  if (marketCapBasic === null) return null;
  return marketCapBasic + (debtUsd ?? 0) + (preferredUsd ?? 0) - (cashUsd ?? 0);
}

/** All snapshot metrics except coin yield, which needs ledger history (see `coinYield`). */
export function computeMetrics(i: MetricInputs): Omit<Metrics, 'coinYield30d' | 'coinYield90d' | 'coinYield365d'> {
  const navUsd = nav(i.holdings, i.spotUsd);
  const marketCapBasic = mul(i.priceUsd, i.sharesBasic);
  const marketCapDiluted = mul(i.priceUsd, i.sharesDiluted);
  const ev = enterpriseValue(marketCapBasic, i.debtUsd, i.preferredUsd, i.cashUsd);
  return {
    priceUsd: i.priceUsd,
    nav: navUsd,
    marketCapBasic,
    marketCapDiluted,
    enterpriseValue: ev,
    mnavBasic: ratio(marketCapBasic, navUsd),
    mnavDiluted: ratio(marketCapDiluted, navUsd),
    mnavEv: ratio(ev, navUsd),
    coinsPerShareBasic: ratio(i.holdings, i.sharesBasic),
    coinsPerShareDiluted: ratio(i.holdings, i.sharesDiluted),
  };
}

/** Coins per diluted share as the ledger stood on `date`. */
export function coinsPerDilutedShareAsOf(entries: readonly LedgerEntry[], companyId: string, date: IsoDate): number | null {
  const s = ledgerAsOf(entries, companyId, date);
  return ratio(ledgerValue(s, 'holdings'), ledgerValue(s, 'shares_diluted'));
}

/**
 * Coin yield: % change in coins per diluted share between `date − days` and `date`,
 * both read from the ledger as of that date. Null when either end is unknown.
 */
export function coinYield(entries: readonly LedgerEntry[], companyId: string, date: IsoDate, days: number): number | null {
  const now = coinsPerDilutedShareAsOf(entries, companyId, date);
  const then = coinsPerDilutedShareAsOf(entries, companyId, addDays(date, -days));
  return pctChange(then, now);
}

/** (to − from) / from × 100, or null. */
export function pctChange(from: number | null, to: number | null): number | null {
  if (from === null || to === null || from === 0) return null;
  return ((to - from) / from) * 100;
}

export function mnavOf(m: Pick<Metrics, 'mnavBasic' | 'mnavDiluted' | 'mnavEv'>, variant: MnavVariant): number | null {
  return variant === 'basic' ? m.mnavBasic : variant === 'diluted' ? m.mnavDiluted : m.mnavEv;
}
