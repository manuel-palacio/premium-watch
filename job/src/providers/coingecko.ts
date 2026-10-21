import type { Asset } from '@pw/shared';
import { ProviderError, type SpotPoint, type SpotProvider } from './types.ts';

const IDS: Record<Asset, string> = { BTC: 'bitcoin', SOL: 'solana', ETH: 'ethereum' };

/**
 * CoinGecko public API. Without a key it is rate-limited; an optional free "demo" key
 * (COINGECKO_API_KEY) raises the limit. Public history reaches back 365 days; granularity
 * is 5-minutely for ranges within a day, hourly up to 90 days and daily beyond.
 */
export class CoinGeckoProvider implements SpotProvider {
  readonly name = 'coingecko';
  private readonly apiKey: string | undefined;
  private readonly fetchFn: typeof fetch;

  constructor(apiKey?: string, fetchFn: typeof fetch = fetch) {
    this.apiKey = apiKey || undefined;
    this.fetchFn = fetchFn;
  }

  async range(asset: Asset, from: Date, to: Date): Promise<SpotPoint[]> {
    const url = new URL(`https://api.coingecko.com/api/v3/coins/${IDS[asset]}/market_chart/range`);
    url.searchParams.set('vs_currency', 'usd');
    url.searchParams.set('from', String(Math.floor(from.getTime() / 1000)));
    url.searchParams.set('to', String(Math.ceil(to.getTime() / 1000)));
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.apiKey) headers['x-cg-demo-api-key'] = this.apiKey;

    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchFn(url, { headers });
      if (res.status === 429 && attempt < 3) {
        await new Promise((r) => setTimeout(r, 15_000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new ProviderError(`CoinGecko ${asset}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      const body = (await res.json()) as { prices?: [number, number][] };
      return (body.prices ?? []).map(([ms, usd]) => ({ at: new Date(ms), usd }));
    }
  }
}
