import { LEDGER_TYPES, MNAV_VARIANTS, addDays, ledgerAsOf, mnavOf, type LedgerType, type MnavVariant } from '@pw/shared';
import { analyse, paybackText } from '../analysis.ts';
import { pageChart } from '../charts.ts';
import { companies, ledger, snapshots, today } from '../data.ts';
import { h, onMounted } from '../dom.ts';
import { coins, longDate, missingLabel, mnav, pct, plain, signClass, usd } from '../format.ts';
import { logScale, premiumBar, scaleAxis } from '../viz.ts';

const VARIANT_LABEL: Record<MnavVariant, string> = { basic: 'Basic', diluted: 'Diluted', ev: 'EV' };
export const RANGES = ['3m', '6m', '1y', 'all'] as const;
export type Range = (typeof RANGES)[number];
export const RANGE_LABEL: Record<Range, string> = { '3m': '3M', '6m': '6M', '1y': '1Y', all: 'All' };
export const RANGE_DAYS: Record<Range, number | null> = { '3m': 91, '6m': 182, '1y': 365, all: null };

const TYPE_LABEL: Record<LedgerType, string> = {
  holdings: 'Coins held',
  shares_basic: 'Shares outstanding',
  shares_diluted: 'Shares, fully diluted',
  debt: 'Debt',
  preferred: 'Preferred (liquidation value)',
  cash: 'Cash',
};

export function segmented<T extends string>(options: readonly T[], labels: Record<T, string>, value: T, onChange: (v: T) => void, label = ''): HTMLElement {
  const wrap = h('div', { class: 'seg', role: 'group', 'aria-label': label || null });
  const render = (current: T) =>
    wrap.replaceChildren(
      ...options.map((o) =>
        h('button', { type: 'button', class: o === current ? 'on' : '', 'aria-pressed': String(o === current), onclick: () => (render(o), onChange(o)) }, labels[o]),
      ),
    );
  render(value);
  return wrap;
}

export async function companyPage(id: string): Promise<HTMLElement> {
  const company = (await companies()).find((c) => c.id === id);
  if (!company) return h('div', { class: 'page' }, h('div', { class: 'panel empty' }, `There is no company "${id}". `, h('a', { href: '#/' }, 'See all companies')));
  const [snaps, entries] = await Promise.all([snapshots(id), ledger(id)]);
  const a = analyse(company, snaps);
  const s = a.latest;
  const m = s?.metrics;
  const tone = a.reading?.tone ?? 'none';
  const scale = logScale([a.mnav ?? NaN, a.range?.min ?? NaN, a.range?.max ?? NaN]);
  const state = ledgerAsOf(entries, id, today());

  const fact = (term: string, value: string, note?: string, cls = '') => h('div', { class: 'fact' }, h('dt', null, term), h('dd', { class: cls }, value, note ? h('span', { class: 'fact-note' }, note) : null));

  const mnavEl = h('div', { class: 'chart tall' });
  const cpsEl = h('div', { class: 'chart' });
  let variant: MnavVariant = 'diluted';
  let range: Range = '1y';

  const page = h(
    'div',
    { class: 'page company' },
    h('a', { class: 'back', href: '#/' }, 'All companies'),
    h(
      'header',
      { class: 'company-head' },
      h('h1', null, company.name),
      h('p', { class: 'co-meta' }, h('span', null, `${company.ticker} on ${exchangeName(company.exchange)}`), h('span', { class: 'asset' }, company.asset), h('span', null, s ? `Close of ${longDate(s.date)}` : 'No data yet')),
    ),
    s?.stale ? h('p', { class: 'notice' }, `The latest snapshot is incomplete (${s.missing.map(missingLabel).join(', ')}), so it is left out of ranges and alerts.`) : null,
    h(
      'section',
      { class: 'verdict' },
      h(
        'div',
        { class: 'verdict-figure' },
        h('span', { class: `huge tone-${tone}` }, mnav(a.mnav)),
        h('span', { class: 'verdict-label' }, 'diluted mNAV', a.reading ? h('span', { class: `badge tone-${tone}` }, a.reading.label) : null),
        h('span', { class: 'variants' }, `Basic ${mnav(m?.mnavBasic)}`, h('span', null, `EV ${mnav(m?.mnavEv)}`)),
      ),
      h('p', { class: 'lede' }, a.reading?.text ?? 'No mNAV yet. Add holdings and share counts in the ledger, then run a backfill.'),
    ),
    a.mnav !== null
      ? h(
          'section',
          { class: 'own-range' },
          h('h2', null, 'Past year and today'),
          scaleAxis(scale),
          premiumBar(scale, a.mnav, a.range, a.reading?.tone ?? null, company.name),
          a.range
            ? h(
                'p',
                { class: 'range-note' },
                `Low ${mnav(a.range.min)}, median ${mnav(a.range.median)}, high ${mnav(a.range.max)}. Today is higher than ${Math.round(a.range.percentile)}% of the past year's trading days.`,
              )
            : h('p', { class: 'range-note' }, 'Not enough history for a range yet.'),
        )
      : null,
    h(
      'dl',
      { class: 'facts' },
      fact(`${company.asset} held`, coins(s?.inputs.ledger.holdings?.value)),
      fact(`${company.asset} price`, s?.inputs.spot ? usd(s.inputs.spot.usd) : '–'),
      fact('Coins worth (NAV)', usd(m?.nav)),
      fact('Market cap, diluted', usd(m?.marketCapDiluted)),
      fact('Enterprise value', usd(m?.enterpriseValue), 'with debt and preferred, less cash'),
      fact('Coin yield 90d', pct(a.yield90d), a.yieldAnnual !== null ? `${pct(a.yieldAnnual)} a year` : undefined, signClass(a.yield90d)),
      fact('Coin yield 365d', pct(m?.coinYield365d), undefined, signClass(m?.coinYield365d)),
      fact('Payback', paybackText(a), 'years of coin yield to earn the premium'),
    ),
    h(
      'section',
      { class: 'panel chart-panel' },
      h(
        'div',
        { class: 'toolbar' },
        h('h2', null, 'mNAV'),
        h(
          'div',
          { class: 'toolbar-controls' },
          segmented(MNAV_VARIANTS, VARIANT_LABEL, variant, (v) => ((variant = v), drawMnav()), 'mNAV measure'),
          segmented(RANGES, RANGE_LABEL, range, (r) => ((range = r), drawMnav(), drawCps()), 'Time range'),
        ),
      ),
      snaps.length ? mnavEl : h('div', { class: 'empty' }, 'No snapshots yet.'),
      h('p', { class: 'chart-note' }, 'The dashed line is 1×, where the stock is worth exactly its coins. Incomplete days are left out.'),
    ),
    h(
      'section',
      { class: 'panel chart-panel' },
      h('div', { class: 'toolbar' }, h('h2', null, `${company.asset} per diluted share`)),
      snaps.length ? cpsEl : h('div', { class: 'empty' }, 'No snapshots yet.'),
      h('p', { class: 'chart-note' }, 'Rising means the company is adding coins faster than it issues shares. This is what a premium pays for.'),
    ),
    h(
      'section',
      { class: 'inputs' },
      h('h2', null, "What's in the numbers"),
      h('p', { class: 'section-note' }, `The latest ledger entries behind today's figures. Money is in ${company.currency}.`),
      h(
        'div',
        { class: 'panel table-wrap cards' },
        h(
          'table',
          null,
          h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Figure'), h('th', { scope: 'col', class: 'num' }, 'Value'), h('th', { scope: 'col' }, 'As of'), h('th', { scope: 'col' }, 'Source'))),
          h(
            'tbody',
            null,
            LEDGER_TYPES.map((t) => {
              const e = state[t];
              return h(
                'tr',
                null,
                h('td', { class: 'head', 'data-label': 'Figure' }, TYPE_LABEL[t]),
                h('td', { class: 'num', 'data-label': 'Value' }, e ? plain(e.value) : h('span', { class: 'muted' }, s?.assumedZero.includes(t) ? 'counted as 0' : 'missing')),
                h('td', { 'data-label': 'As of' }, e ? longDate(e.effectiveDate) : '–'),
                h('td', { 'data-label': 'Source' }, e ? h('a', { href: e.sourceUrl, target: '_blank', rel: 'noopener noreferrer', title: e.note ?? '' }, hostOf(e.sourceUrl)) : '–'),
              );
            }),
          ),
        ),
      ),
    ),
    entries.length
      ? h(
          'details',
          { class: 'history' },
          h('summary', null, `Full ledger history (${entries.length} entries)`),
          h(
            'div',
            { class: 'panel table-wrap cards' },
            h(
              'table',
              null,
              h('thead', null, h('tr', null, h('th', null, 'Effective'), h('th', null, 'Figure'), h('th', { class: 'num' }, 'Value'), h('th', null, 'Source'), h('th', null, 'Note'))),
              h(
                'tbody',
                null,
                [...entries]
                  .sort((x, y) => y.effectiveDate.localeCompare(x.effectiveDate) || y.createdAt.localeCompare(x.createdAt))
                  .map((e) =>
                    h(
                      'tr',
                      null,
                      h('td', { class: 'head', 'data-label': 'Effective' }, longDate(e.effectiveDate)),
                      h('td', { 'data-label': 'Figure' }, TYPE_LABEL[e.type]),
                      h('td', { class: 'num', 'data-label': 'Value' }, plain(e.value)),
                      h('td', { 'data-label': 'Source' }, h('a', { href: e.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, hostOf(e.sourceUrl))),
                      h('td', { class: 'muted small', 'data-label': 'Note' }, e.note ?? ''),
                    ),
                  ),
              ),
            ),
          ),
        )
      : h('p', { class: 'section-note' }, 'No ledger entries yet. ', h('a', { href: '#/admin/ledger' }, 'Add them in Admin'), '.'),
  );

  const mnavChart = snaps.length ? pageChart(mnavEl) : null;
  const cpsChart = snaps.length ? pageChart(cpsEl) : null;
  const from = () => (RANGE_DAYS[range] === null ? '' : addDays(today(), -RANGE_DAYS[range]!));
  function drawMnav() {
    const f = from();
    mnavChart?.setLines([{ label: VARIANT_LABEL[variant], points: a.usable.filter((x) => x.date >= f).map((x) => ({ date: x.date, value: mnavOf(x.metrics, variant) })) }], { refLine: 1 });
  }
  function drawCps() {
    const f = from();
    cpsChart?.setLines([{ label: 'per diluted share', points: snaps.filter((x) => x.date >= f).map((x) => ({ date: x.date, value: x.metrics.coinsPerShareDiluted })) }], { precision: 8 });
  }
  onMounted(() => {
    drawMnav();
    drawCps();
  });
  return page;
}

function exchangeName(code: string): string {
  return ({ NASDAQ: 'Nasdaq', NYSE: 'NYSE', TSE: 'the Tokyo Stock Exchange' } as Record<string, string>)[code] ?? code;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
