import { dateRange, isWeekday, localDate, EXCHANGES, type Asset, type Company, type IsoDate } from '@pw/shared';
import type { DailyBar, MarketDataProvider, Quote, SpotPoint, SpotProvider } from './types.ts';

/** Deterministic pseudo-random walk keyed by symbol and date, so reruns give the same prices. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 2 ** 32;
}
function wave(key: string, base: number, date: IsoDate): number {
  const day = Date.parse(`${date}T00:00:00Z`) / 86_400_000;
  return base * (1 + 0.25 * Math.sin(day / 37 + hash(key) * 6) + 0.04 * (hash(`${key}${date}`) - 0.5));
}

const EQUITY_BASE: Record<string, number> = { MSTR: 300, '3350': 900, UPXI: 6, DFDV: 15 };
const CRYPTO_BASE: Record<Asset, number> = { BTC: 100_000, SOL: 180, ETH: 3_500 };

/** Fake market data for tests and local dev. */
export class FakeMarketData implements MarketDataProvider {
  readonly name = 'fake';
  supports(): boolean {
    return true;
  }
  async dailyCloses(company: Company, from: IsoDate, to: IsoDate): Promise<DailyBar[]> {
    const base = EQUITY_BASE[company.ticker] ?? 10 + hash(company.ticker) * 90;
    return dateRange(from, to).filter(isWeekday).map((date) => ({ date, close: +wave(company.ticker, base, date).toFixed(2) }));
  }
  async quote(company: Company): Promise<Quote> {
    const asOf = new Date();
    const date = localDate(asOf, EXCHANGES[company.exchange].timeZone);
    const [bar] = await this.dailyCloses(company, date, date);
    return { price: bar?.close ?? 1, asOf, date };
  }
  async usdJpyDaily(from: IsoDate, to: IsoDate): Promise<DailyBar[]> {
    return dateRange(from, to).filter(isWeekday).map((date) => ({ date, close: +wave('USDJPY', 150, date).toFixed(3) }));
  }
  async cryptoDaily(asset: Asset, from: IsoDate, to: IsoDate): Promise<DailyBar[]> {
    return dateRange(from, to).map((date) => ({ date, close: +wave(asset, CRYPTO_BASE[asset], date).toFixed(2) }));
  }
}

export class FakeSpot implements SpotProvider {
  readonly name = 'fake';
  async range(asset: Asset, from: Date, to: Date): Promise<SpotPoint[]> {
    const out: SpotPoint[] = [];
    const hour = 3_600_000;
    for (let t = Math.ceil(from.getTime() / hour) * hour; t <= to.getTime(); t += hour) {
      const at = new Date(t);
      out.push({ at, usd: +wave(asset, CRYPTO_BASE[asset], at.toISOString().slice(0, 10)).toFixed(2) });
    }
    return out;
  }
}
