import {
  MARKET_GROUPS,
  addDays,
  buildSnapshot,
  closeInstant,
  describeAlert,
  evaluateCondition,
  exchangeDate,
  isAfterClose,
  isTradingHours,
  isWeekday,
  nextAlertState,
  sameSnapshot,
  snapshotId,
  tradingDaysBetween,
  type Asset,
  type Company,
  type IsoDate,
  type MarketGroup,
  type Snapshot,
  type SnapshotInputs,
} from '@pw/shared';
import type { Notifier } from './notify.ts';
import { barOnOrBefore, nearestPoint, type DailyBar, type MarketDataProvider, type SpotPoint, type SpotProvider } from './providers/index.ts';
import type { Store } from './store.ts';

export interface Deps {
  store: Store;
  market: MarketDataProvider;
  spot: SpotProvider;
  notifier: Notifier;
  now: Date;
  /** Base URL of the web app, for links in alert emails. */
  appUrl: string;
  log: (msg: string) => void;
}

export interface RunSummary {
  companies: number;
  written: number;
  unchanged: number;
  skippedFinal: number;
  stale: string[];
  alertsFired: number;
  errors: string[];
}

const HOUR = 3_600_000;
/** How far from the close a spot point may be. */
const SPOT_TOLERANCE_MS = 3 * HOUR;
/** Weekdays re-examined on each close run, so late or corrected data gets picked up. */
export const CATCH_UP_DAYS = 4;

function emptySummary(): RunSummary {
  return { companies: 0, written: 0, unchanged: 0, skippedFinal: 0, stale: [], alertsFired: 0, errors: [] };
}

/** The latest session date that has closed for `exchange` at `now`. */
export function latestClosedSession(company: Company, now: Date): IsoDate {
  let d = exchangeDate(company.exchange, now);
  if (!isAfterClose(company.exchange, now)) d = addDays(d, -1);
  while (!isWeekday(d)) d = addDays(d, -1);
  return d;
}

function lastWeekdays(end: IsoDate, n: number): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = end; out.length < n; d = addDays(d, -1)) if (isWeekday(d)) out.unshift(d);
  return out;
}

export function companiesIn(group: MarketGroup | 'all', companies: Company[]): Company[] {
  return companies.filter((c) => c.active && (group === 'all' || MARKET_GROUPS[group].includes(c.exchange)));
}

/** Spot points around a set of close instants, fetched once per asset per run. */
class SpotCache {
  private readonly cache = new Map<string, Promise<SpotPoint[]>>();
  private readonly spot: SpotProvider;
  constructor(spot: SpotProvider) {
    this.spot = spot;
  }
  points(asset: Asset, from: Date, to: Date): Promise<SpotPoint[]> {
    const key = `${asset}:${from.getTime()}:${to.getTime()}`;
    if (!this.cache.has(key)) this.cache.set(key, this.spot.range(asset, from, to));
    return this.cache.get(key)!;
  }
}

interface DayInputs {
  price: SnapshotInputs['price'];
  spot: SnapshotInputs['spot'];
  fx: SnapshotInputs['fx'];
}

export function pickInputs(
  company: Company,
  date: IsoDate,
  bars: DailyBar[],
  fxBars: DailyBar[],
  spotPoints: SpotPoint[],
  sources: { price: string; fx: string; spot: string },
  spotToleranceMs = SPOT_TOLERANCE_MS,
): DayInputs {
  const bar = barOnOrBefore(bars, date);
  const fx = company.currency === 'USD' ? null : barOnOrBefore(fxBars, date);
  const sp = nearestPoint(spotPoints, closeInstant(company.exchange, date), spotToleranceMs);
  return {
    price: bar ? { value: bar.close, currency: company.currency, date: bar.date, source: sources.price } : null,
    fx: fx ? { pair: 'USDJPY', value: fx.close, date: fx.date, source: sources.fx } : null,
    spot: sp ? { asset: company.asset, usd: sp.usd, asOf: sp.at.toISOString(), source: sources.spot } : null,
  };
}

const sourceName = (m: MarketDataProvider, c: Company, kind: 'price' | 'fx'): string => {
  const r = m as MarketDataProvider & { providerName?: (e: Company['exchange']) => string; fxName?: string };
  return kind === 'price' ? (r.providerName?.(c.exchange) ?? m.name) : (r.fxName ?? m.name);
};

/**
 * Daily close run for one market group. Re-examines the last few sessions and writes each
 * snapshot that is missing or not yet final; final snapshots are never touched.
 */
export async function runClose(group: MarketGroup | 'all', deps: Deps): Promise<RunSummary> {
  const sum = emptySummary();
  const spotCache = new SpotCache(deps.spot);
  const companies = companiesIn(group, await deps.store.listCompanies());
  sum.companies = companies.length;

  for (const company of companies) {
    try {
      const latest = latestClosedSession(company, deps.now);
      const dates = lastWeekdays(latest, CATCH_UP_DAYS);
      const first = dates[0]!;
      const existing = await deps.store.getSnapshots(dates.map((d) => snapshotId(company.id, d)));
      const todo = dates.filter((d) => !existing.get(snapshotId(company.id, d))?.final);
      sum.skippedFinal += dates.length - todo.length;
      if (!todo.length) continue;

      const [bars, fxBars, ledger, spotPoints] = await Promise.all([
        deps.market.dailyCloses(company, addDays(first, -7), latest),
        company.currency === 'USD' ? Promise.resolve([]) : deps.market.usdJpyDaily(addDays(first, -7), latest),
        deps.store.ledgerFor(company.id),
        spotCache.points(
          company.asset,
          new Date(closeInstant(company.exchange, first).getTime() - 6 * HOUR),
          new Date(Math.min(closeInstant(company.exchange, latest).getTime() + 6 * HOUR, deps.now.getTime())),
        ),
      ]);
      const sources = { price: sourceName(deps.market, company, 'price'), fx: sourceName(deps.market, company, 'fx'), spot: deps.spot.name };
      const barDates = new Set(bars.map((b) => b.date));
      const lastBar = bars.reduce<IsoDate>((m, b) => (b.date > m ? b.date : m), '');

      const writes: Snapshot[] = [];
      for (const date of todo) {
        // A weekday without a bar while later bars exist was an exchange holiday.
        if (!barDates.has(date) && lastBar > date) continue;
        const inputs = pickInputs(company, date, bars, fxBars, spotPoints, sources);
        const draft = buildSnapshot({ company, date, kind: 'close', final: false, computedAt: deps.now.toISOString(), ...inputs, ledger });
        // Final once the day's own close is in and nothing is stale, or once the session is
        // old enough that no more data will arrive.
        const final = !draft.stale && (inputs.price?.date === date || tradingDaysBetween(date, latest) >= 2);
        const snap = { ...draft, final };
        const prev = existing.get(snap.id);
        if (prev && sameSnapshot(prev, snap)) {
          sum.unchanged++;
          continue;
        }
        writes.push(snap);
        if (snap.stale) sum.stale.push(`${company.id} ${date}: ${snap.missing.join(', ')}`);
      }
      await deps.store.putSnapshots(writes);
      sum.written += writes.length;
      sum.alertsFired += await evaluateAlerts(company, deps);
    } catch (e) {
      sum.errors.push(`${company.id}: ${(e as Error).message}`);
    }
  }
  return sum;
}

/** Intraday run: overwrite today's (non-final) snapshot for companies whose exchange is open. */
export async function runIntraday(group: MarketGroup | 'all', deps: Deps): Promise<RunSummary> {
  const sum = emptySummary();
  const companies = companiesIn(group, await deps.store.listCompanies()).filter((c) => isTradingHours(c.exchange, deps.now));
  sum.companies = companies.length;
  for (const company of companies) {
    try {
      const date = exchangeDate(company.exchange, deps.now);
      const id = snapshotId(company.id, date);
      if ((await deps.store.getSnapshots([id])).get(id)?.final) {
        sum.skippedFinal++;
        continue;
      }
      const [quote, fxBars, ledger, points] = await Promise.all([
        deps.market.quote(company),
        company.currency === 'USD' ? Promise.resolve([]) : deps.market.usdJpyDaily(addDays(date, -7), date),
        deps.store.ledgerFor(company.id),
        deps.spot.range(company.asset, new Date(deps.now.getTime() - 2 * HOUR), deps.now),
      ]);
      const fx = barOnOrBefore(fxBars, date);
      const sp = nearestPoint(points, deps.now, SPOT_TOLERANCE_MS);
      const snap = buildSnapshot({
        company,
        date,
        kind: 'intraday',
        final: false,
        computedAt: deps.now.toISOString(),
        price: { value: quote.price, currency: company.currency, date: quote.date, source: sourceName(deps.market, company, 'price') },
        fx: fx ? { pair: 'USDJPY', value: fx.close, date: fx.date, source: sourceName(deps.market, company, 'fx') } : null,
        spot: sp ? { asset: company.asset, usd: sp.usd, asOf: sp.at.toISOString(), source: deps.spot.name } : null,
        ledger,
      });
      await deps.store.putSnapshots([snap]);
      sum.written++;
      if (snap.stale) sum.stale.push(`${company.id} ${date}: ${snap.missing.join(', ')}`);
      sum.alertsFired += await evaluateAlerts(company, deps);
    } catch (e) {
      sum.errors.push(`${company.id}: ${(e as Error).message}`);
    }
  }
  return sum;
}

const fmtNum = (v: number | null, d = 2) => (v === null ? '–' : v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }));
const fmtUsd = (v: number | null) => (v === null ? '–' : `$${(v / 1e9).toFixed(2)}bn`);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Evaluate the company's alerts against its latest snapshot. Returns the number fired. */
export async function evaluateAlerts(company: Company, deps: Deps): Promise<number> {
  const alerts = await deps.store.alertsFor(company.id);
  if (!alerts.length) return 0;
  const maxDays = Math.max(0, ...alerts.map((a) => (a.rule === 'compression_pct_over_days' ? a.params.days : 0)));
  const history = await deps.store.snapshotsSince(company.id, addDays(exchangeDate(company.exchange, deps.now), -(maxDays + 14)));
  const current = history.at(-1);
  if (!current) return 0;
  let fired = 0;
  for (const alert of alerts) {
    const cond = evaluateCondition(alert, company, current, history.slice(0, -1));
    const t = nextAlertState(alert, cond.met);
    if (t.fire && cond.value !== null) {
      const link = `${deps.appUrl.replace(/\/$/, '')}/#/company/${encodeURIComponent(company.id)}`;
      const m = current.metrics;
      const lines = [
        cond.message,
        '',
        `Rule: ${describeAlert(alert)}`,
        `Snapshot: ${current.date} (${current.kind})`,
        `mNAV basic ${fmtNum(m.mnavBasic)} · diluted ${fmtNum(m.mnavDiluted)} · EV ${fmtNum(m.mnavEv)}`,
        `NAV ${fmtUsd(m.nav)} · market cap (diluted) ${fmtUsd(m.marketCapDiluted)}`,
        '',
        link,
      ];
      await deps.notifier.send({
        subject: `Premium Watch: ${company.ticker} ${describeAlert(alert)}`,
        text: lines.join('\n'),
        html: `<p>${lines.map((l) => (l === link ? `<a href="${esc(link)}">Open ${esc(company.name)}</a>` : esc(l))).join('<br>')}</p>`,
      });
      await deps.store.addAlertEvent({ alertId: alert.id, companyId: company.id, firedAt: deps.now.toISOString(), value: cond.value, message: cond.message });
      fired++;
    }
    if (t.active !== (alert.active === true)) {
      await deps.store.setAlertState(alert.id, t.active, t.active ? deps.now.toISOString() : null);
    }
  }
  deps.log(`${company.id}: ${alerts.length} alert(s) evaluated, ${fired} fired`);
  return fired;
}
