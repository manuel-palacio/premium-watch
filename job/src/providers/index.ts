import type { Asset, Company, ExchangeCode, IsoDate } from '@pw/shared';
import { CoinGeckoProvider } from './coingecko.ts';
import { EodhdProvider } from './eodhd.ts';
import { FakeMarketData, FakeSpot } from './fake.ts';
import { ProviderError, type DailyBar, type MarketDataProvider, type Quote, type SpotProvider } from './types.ts';
import { YahooProvider } from './yahoo.ts';

export * from './types.ts';

type ProviderName = 'eodhd' | 'yahoo' | 'fake';

function make(name: string, env: NodeJS.ProcessEnv): MarketDataProvider {
  switch (name as ProviderName) {
    case 'eodhd':
      return new EodhdProvider(env.EODHD_API_KEY ?? '');
    case 'yahoo':
      return new YahooProvider();
    case 'fake':
      return new FakeMarketData();
    default:
      throw new ProviderError(`unknown market data provider "${name}" (eodhd, yahoo, fake)`);
  }
}

/**
 * Routes each call to a provider by exchange. `MARKET_DATA_PROVIDER` is the default,
 * `MARKET_DATA_PROVIDER_<EXCHANGE>` overrides one exchange (e.g. `MARKET_DATA_PROVIDER_TSE=yahoo`),
 * and `FX_PROVIDER` / `CRYPTO_HISTORY_PROVIDER` pick the source for USD/JPY and crypto history.
 */
export class RoutedMarketData implements MarketDataProvider {
  readonly name: string;
  private readonly byExchange: Partial<Record<ExchangeCode, MarketDataProvider>>;
  private readonly fallback: MarketDataProvider;
  private readonly fx: MarketDataProvider;
  private readonly crypto: MarketDataProvider;

  constructor(opts: { fallback: MarketDataProvider; byExchange?: Partial<Record<ExchangeCode, MarketDataProvider>>; fx?: MarketDataProvider; crypto?: MarketDataProvider }) {
    this.fallback = opts.fallback;
    this.byExchange = opts.byExchange ?? {};
    this.fx = opts.fx ?? opts.fallback;
    this.crypto = opts.crypto ?? opts.fallback;
    const parts = Object.entries(this.byExchange).map(([ex, p]) => `${ex}:${p.name}`);
    this.name = [this.fallback.name, ...parts].join(',');
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): RoutedMarketData {
    const cache = new Map<string, MarketDataProvider>();
    const get = (n: string) => cache.get(n) ?? (cache.set(n, make(n, env)), cache.get(n)!);
    const fallback = get(env.MARKET_DATA_PROVIDER ?? 'fake');
    const byExchange: Partial<Record<ExchangeCode, MarketDataProvider>> = {};
    for (const ex of ['NASDAQ', 'NYSE', 'TSE'] as ExchangeCode[]) {
      const n = env[`MARKET_DATA_PROVIDER_${ex}`];
      if (n) byExchange[ex] = get(n);
    }
    return new RoutedMarketData({
      fallback,
      byExchange,
      ...(env.FX_PROVIDER ? { fx: get(env.FX_PROVIDER) } : {}),
      ...(env.CRYPTO_HISTORY_PROVIDER ? { crypto: get(env.CRYPTO_HISTORY_PROVIDER) } : {}),
    });
  }

  private for(exchange: ExchangeCode): MarketDataProvider {
    const p = this.byExchange[exchange] ?? this.fallback;
    if (!p.supports(exchange)) throw new ProviderError(`${p.name} does not cover ${exchange}; set MARKET_DATA_PROVIDER_${exchange}`);
    return p;
  }
  supports(exchange: ExchangeCode): boolean {
    return (this.byExchange[exchange] ?? this.fallback).supports(exchange);
  }
  providerName(exchange: ExchangeCode): string {
    return (this.byExchange[exchange] ?? this.fallback).name;
  }
  get fxName(): string {
    return this.fx.name;
  }
  get cryptoName(): string {
    return this.crypto.name;
  }
  dailyCloses(company: Company, from: IsoDate, to: IsoDate): Promise<DailyBar[]> {
    return this.for(company.exchange).dailyCloses(company, from, to);
  }
  quote(company: Company): Promise<Quote> {
    return this.for(company.exchange).quote(company);
  }
  usdJpyDaily(from: IsoDate, to: IsoDate): Promise<DailyBar[]> {
    return this.fx.usdJpyDaily(from, to);
  }
  cryptoDaily(asset: Asset, from: IsoDate, to: IsoDate): Promise<DailyBar[]> {
    return this.crypto.cryptoDaily(asset, from, to);
  }
}

export function spotFromEnv(env: NodeJS.ProcessEnv = process.env): SpotProvider {
  return (env.SPOT_PROVIDER ?? (env.MARKET_DATA_PROVIDER === 'fake' || !env.MARKET_DATA_PROVIDER ? 'fake' : 'coingecko')) === 'fake'
    ? new FakeSpot()
    : new CoinGeckoProvider(env.COINGECKO_API_KEY);
}
