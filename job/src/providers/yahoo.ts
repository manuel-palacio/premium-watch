import YahooFinance from 'yahoo-finance2';
import { addDays, localDate, type Asset, type Company, type ExchangeCode, type IsoDate } from '@pw/shared';
import { ProviderError, type DailyBar, type MarketDataProvider, type Quote } from './types.ts';

const SUFFIX: Record<ExchangeCode, string> = { NASDAQ: '', NYSE: '', TSE: '.T' };

export interface Split {
  date: Date;
  numerator: number;
  denominator: number;
}

/**
 * Yahoo charts are split-adjusted. Undo that so each close matches the share count at the
 * time: a bar before a 10:1 split is multiplied by 10.
 */
export function unadjustForSplits(bars: { date: Date; close: number }[], splits: Split[]): { date: Date; close: number }[] {
  return bars.map((b) => {
    let factor = 1;
    for (const s of splits) if (s.date > b.date && s.denominator > 0) factor *= s.numerator / s.denominator;
    return { date: b.date, close: b.close * factor };
  });
}

/**
 * Yahoo Finance through `yahoo-finance2` (unofficial, no API key). Covers Nasdaq, NYSE,
 * Tokyo (`3350.T`), FX (`JPY=X`) and crypto (`BTC-USD`).
 */
export class YahooProvider implements MarketDataProvider {
  readonly name = 'yahoo';
  private readonly yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

  supports(): boolean {
    return true;
  }

  private async daily(symbol: string, from: IsoDate, to: IsoDate): Promise<DailyBar[]> {
    let r;
    try {
      r = await this.yf.chart(symbol, { period1: from, period2: addDays(to, 1), interval: '1d', events: 'split' });
    } catch (e) {
      throw new ProviderError(`Yahoo ${symbol}: ${(e as Error).message}`);
    }
    const tz = r.meta.exchangeTimezoneName;
    const splits = (r.events?.splits ?? []).map((s) => ({ date: new Date(s.date), numerator: s.numerator, denominator: s.denominator }));
    const bars = r.quotes
      .filter((q) => q.close !== null && q.close !== undefined && q.close > 0)
      .map((q) => ({ date: new Date(q.date), close: q.close as number }));
    const byDate = new Map<IsoDate, number>();
    for (const b of unadjustForSplits(bars, splits)) byDate.set(localDate(b.date, tz), b.close);
    return [...byDate].map(([date, close]) => ({ date, close })).filter((b) => b.date >= from && b.date <= to);
  }

  symbol(company: Company): string {
    return `${company.ticker}${SUFFIX[company.exchange]}`;
  }

  dailyCloses(company: Company, from: IsoDate, to: IsoDate): Promise<DailyBar[]> {
    return this.daily(this.symbol(company), from, to);
  }

  async quote(company: Company): Promise<Quote> {
    const q = await this.yf.quote(this.symbol(company));
    if (!q.regularMarketPrice || !q.regularMarketTime) throw new ProviderError(`Yahoo quote ${company.ticker}: no price`);
    const asOf = new Date(q.regularMarketTime);
    return { price: q.regularMarketPrice, asOf, date: localDate(asOf, q.exchangeTimezoneName ?? 'UTC') };
  }

  usdJpyDaily(from: IsoDate, to: IsoDate): Promise<DailyBar[]> {
    return this.daily('JPY=X', from, to);
  }

  cryptoDaily(asset: Asset, from: IsoDate, to: IsoDate): Promise<DailyBar[]> {
    return this.daily(`${asset}-USD`, from, to);
  }
}
