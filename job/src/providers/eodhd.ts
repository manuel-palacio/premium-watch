import { EXCHANGES, addDays, type Asset, type Company, type ExchangeCode, type IsoDate } from '@pw/shared';
import { ProviderError, type DailyBar, type MarketDataProvider, type Quote } from './types.ts';

const BASE = 'https://eodhd.com/api';

/**
 * EODHD (https://eodhd.com). Covers US exchanges, FOREX and crypto; it does not cover the
 * Tokyo Stock Exchange (checked 2026-10-22), so TSE companies are routed elsewhere.
 * The cheapest plan with EOD prices, FX and crypto is "Historian" (EOD only).
 */
export class EodhdProvider implements MarketDataProvider {
  readonly name = 'eodhd';
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;

  constructor(apiKey: string, fetchFn: typeof fetch = fetch) {
    if (!apiKey) throw new ProviderError('EODHD_API_KEY is not set');
    this.apiKey = apiKey;
    this.fetchFn = fetchFn;
  }

  supports(exchange: ExchangeCode): boolean {
    return exchange !== 'TSE';
  }

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${BASE}/${path}`);
    for (const [k, v] of Object.entries({ ...params, api_token: this.apiKey, fmt: 'json' })) url.searchParams.set(k, v);
    const res = await this.fetchFn(url);
    if (!res.ok) throw new ProviderError(`EODHD ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }

  private async eod(symbol: string, from: IsoDate, to: IsoDate): Promise<DailyBar[]> {
    // `close` is the raw close; `adjusted_close` would be split- and dividend-adjusted.
    const rows = await this.get<{ date: string; close: number }[]>(`eod/${encodeURIComponent(symbol)}`, { from, to, period: 'd' });
    return rows.filter((r) => Number.isFinite(r.close) && r.close > 0).map((r) => ({ date: r.date, close: r.close }));
  }

  symbol(company: Company): string {
    return `${company.ticker}.${EXCHANGES[company.exchange].eodhdSuffix}`;
  }

  dailyCloses(company: Company, from: IsoDate, to: IsoDate): Promise<DailyBar[]> {
    if (!this.supports(company.exchange)) throw new ProviderError(`EODHD does not cover ${company.exchange}`);
    return this.eod(this.symbol(company), from, to);
  }

  async quote(company: Company): Promise<Quote> {
    const r = await this.get<{ close: number; timestamp: number }>(`real-time/${encodeURIComponent(this.symbol(company))}`);
    if (!Number.isFinite(r.close) || !r.timestamp) throw new ProviderError(`EODHD real-time ${company.ticker}: no price`);
    const asOf = new Date(r.timestamp * 1000);
    return { price: r.close, asOf, date: asOf.toLocaleDateString('en-CA', { timeZone: EXCHANGES[company.exchange].timeZone }) };
  }

  usdJpyDaily(from: IsoDate, to: IsoDate): Promise<DailyBar[]> {
    return this.eod('USDJPY.FOREX', from, to);
  }

  cryptoDaily(asset: Asset, from: IsoDate, to: IsoDate): Promise<DailyBar[]> {
    return this.eod(`${asset}-USD.CC`, addDays(from, 0), to);
  }
}
