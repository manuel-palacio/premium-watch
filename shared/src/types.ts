/** Calendar date, `YYYY-MM-DD`. Compares correctly as a string. */
export type IsoDate = string;
/** Instant, ISO 8601 with timezone, e.g. `2026-10-22T07:00:00.000Z`. */
export type IsoTimestamp = string;

export const ASSETS = ['BTC', 'SOL', 'ETH'] as const;
export type Asset = (typeof ASSETS)[number];

export const CURRENCIES = ['USD', 'JPY'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const EXCHANGE_CODES = ['NASDAQ', 'NYSE', 'TSE'] as const;
export type ExchangeCode = (typeof EXCHANGE_CODES)[number];

export interface Company {
  id: string;
  name: string;
  ticker: string;
  exchange: ExchangeCode;
  /** Currency of the share price and of the debt / preferred / cash ledger values. */
  currency: Currency;
  asset: Asset;
  active: boolean;
}

export const LEDGER_TYPES = [
  'holdings',
  'shares_basic',
  'shares_diluted',
  'debt',
  'preferred',
  'cash',
] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];

/** Ledger types that must exist for a snapshot to be complete. */
export const REQUIRED_LEDGER_TYPES: readonly LedgerType[] = ['holdings', 'shares_basic', 'shares_diluted'];
/** Ledger types treated as 0 when no entry exists (recorded in `assumedZero`). */
export const OPTIONAL_LEDGER_TYPES: readonly LedgerType[] = ['debt', 'preferred', 'cash'];

/**
 * One ledger entry sets `type` to `value` from `effectiveDate` onward (not a delta).
 * Units: holdings in coins, shares in shares, debt / preferred (liquidation value) / cash
 * in the company's currency.
 */
export interface LedgerEntry {
  id: string;
  companyId: string;
  effectiveDate: IsoDate;
  type: LedgerType;
  value: number;
  sourceUrl: string;
  note?: string;
  createdAt: IsoTimestamp;
}

export type MnavVariant = 'basic' | 'diluted' | 'ev';
export const MNAV_VARIANTS: readonly MnavVariant[] = ['basic', 'diluted', 'ev'];

export interface Metrics {
  priceUsd: number | null;
  nav: number | null;
  marketCapBasic: number | null;
  marketCapDiluted: number | null;
  enterpriseValue: number | null;
  mnavBasic: number | null;
  mnavDiluted: number | null;
  mnavEv: number | null;
  coinsPerShareBasic: number | null;
  coinsPerShareDiluted: number | null;
  coinYield30d: number | null;
  coinYield90d: number | null;
  coinYield365d: number | null;
}

export interface LedgerInput {
  ledgerId: string;
  value: number;
  effectiveDate: IsoDate;
}

export interface SnapshotInputs {
  price: { value: number; currency: Currency; date: IsoDate; source: string } | null;
  spot: { asset: Asset; usd: number; asOf: IsoTimestamp; source: string } | null;
  /** USD/JPY (yen per dollar); null for USD companies. */
  fx: { pair: 'USDJPY'; value: number; date: IsoDate; source: string } | null;
  ledger: Partial<Record<LedgerType, LedgerInput>>;
}

export interface Snapshot {
  id: string;
  companyId: string;
  date: IsoDate;
  kind: 'close' | 'intraday';
  /** A final snapshot is immutable. */
  final: boolean;
  computedAt: IsoTimestamp;
  inputs: SnapshotInputs;
  metrics: Metrics;
  stale: boolean;
  /** Human-readable reasons, e.g. `ledger:holdings`, `price:stale`. */
  missing: string[];
  assumedZero: LedgerType[];
}

export type AlertRuleName = 'mnav_below' | 'mnav_above' | 'compression_pct_over_days';

export type AlertSpec =
  | { rule: 'mnav_below'; params: { variant: MnavVariant; threshold: number } }
  | { rule: 'mnav_above'; params: { variant: MnavVariant; threshold: number } }
  | { rule: 'compression_pct_over_days'; params: { variant: MnavVariant; pct: number; days: number } };

export type Alert = AlertSpec & {
  id: string;
  companyId: string;
  enabled: boolean;
  /** True while the condition holds; the alert fires only on the false→true transition. */
  active?: boolean;
  activeSince?: IsoTimestamp | null;
};

export interface AlertEvent {
  id: string;
  alertId: string;
  companyId: string;
  firedAt: IsoTimestamp;
  value: number;
  message: string;
}
