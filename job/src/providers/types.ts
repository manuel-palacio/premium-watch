import type { Asset, Company, ExchangeCode, IsoDate } from '@pw/shared';

/** A daily close, unadjusted for later splits (it must match the share count filed at the time). */
export interface DailyBar {
  date: IsoDate;
  close: number;
}

export interface Quote {
  price: number;
  /** Exchange-local date of the quote. */
  date: IsoDate;
  asOf: Date;
}

/** Equity prices and FX. One implementation may cover only some exchanges. */
export interface MarketDataProvider {
  readonly name: string;
  supports(exchange: ExchangeCode): boolean;
  /** Daily closes in the company's currency for `from`..`to` (exchange-local dates). */
  dailyCloses(company: Company, from: IsoDate, to: IsoDate): Promise<DailyBar[]>;
  /** Latest (possibly delayed) quote, for intraday mode. */
  quote(company: Company): Promise<Quote>;
  /** USD/JPY daily closes (yen per dollar). */
  usdJpyDaily(from: IsoDate, to: IsoDate): Promise<DailyBar[]>;
  /** Crypto daily closes in USD (UTC days); used by backfill beyond the spot provider's history. */
  cryptoDaily(asset: Asset, from: IsoDate, to: IsoDate): Promise<DailyBar[]>;
}

export interface SpotPoint {
  at: Date;
  usd: number;
}

/** Crypto spot prices in USD. */
export interface SpotProvider {
  readonly name: string;
  /** Price points between two instants (granularity is provider-dependent). */
  range(asset: Asset, from: Date, to: Date): Promise<SpotPoint[]>;
}

/** Closest point to `at` within `maxDistanceMs`, preferring points at or before `at` on ties. */
export function nearestPoint(points: readonly SpotPoint[], at: Date, maxDistanceMs: number): SpotPoint | null {
  let best: SpotPoint | null = null;
  let bestD = Infinity;
  for (const p of points) {
    const d = Math.abs(p.at.getTime() - at.getTime());
    if (d < bestD || (d === bestD && p.at <= at)) {
      best = p;
      bestD = d;
    }
  }
  return best && bestD <= maxDistanceMs ? best : null;
}

/** The latest bar dated on or before `date`. */
export function barOnOrBefore(bars: readonly DailyBar[], date: IsoDate): DailyBar | null {
  let best: DailyBar | null = null;
  for (const b of bars) if (b.date <= date && (!best || b.date > best.date)) best = b;
  return best;
}

export class ProviderError extends Error {}
