import { companies, snapshots } from '../data.ts';
import { analyse, paybackText, type Analysis } from '../analysis.ts';
import { h } from '../dom.ts';
import { rangePosition } from '@pw/shared';
import { longDate, missingLabel, mnav, ordinal, pct, signClass } from '../format.ts';
import { logScale, premiumBar, scaleAxis, type Scale } from '../viz.ts';

export async function overview(): Promise<HTMLElement> {
  const list = (await companies()).filter((c) => c.active);
  if (!list.length) {
    return h('div', { class: 'page' }, h('h1', null, 'Premium to coins'), h('div', { class: 'panel empty' }, 'Add a company to start tracking. ', h('a', { href: '#/admin' }, 'Open admin')));
  }
  const rows = await Promise.all(list.map(async (c) => analyse(c, await snapshots(c.id))));
  rows.sort((a, b) => (a.mnav ?? Infinity) - (b.mnav ?? Infinity));
  const scale = logScale(rows.flatMap((r) => [r.mnav ?? NaN, r.range?.min ?? NaN, r.range?.max ?? NaN]));
  const asOf = rows.map((r) => r.latest?.date).filter(Boolean).sort().at(-1);

  return h(
    'div',
    { class: 'page overview' },
    h(
      'header',
      { class: 'page-head' },
      h('h1', null, 'Premium to coins'),
      h('p', { class: 'lede' }, headline(rows)),
      h('p', { class: 'asof' }, asOf ? `Diluted mNAV at the close of ${longDate(asOf)}, cheapest first.` : 'No closing prices yet.'),
    ),
    h(
      'div',
      { class: 'board' },
      h(
        'table',
        null,
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            h('th', { scope: 'col', class: 'c-name' }, 'Company'),
            h('th', { scope: 'col', class: 'c-mnav num' }, 'mNAV'),
            h('th', { scope: 'col', class: 'c-bar' }, h('span', { class: 'bar-title' }, 'Past year and today'), scaleAxis(scale)),
            h('th', { scope: 'col', class: 'num', title: 'Share of the past year\'s trading days with a lower mNAV' }, 'Year rank'),
            h('th', { scope: 'col', class: 'num' }, '30 days'),
            h('th', { scope: 'col', class: 'num' }, 'Coin yield 90d'),
            h('th', { scope: 'col', class: 'num' }, 'Payback'),
          ),
        ),
        h('tbody', null, rows.map((r) => row(r, scale))),
      ),
    ),
    h('section', { class: 'readings' }, h('h2', null, 'What the numbers say'), h('div', { class: 'reading-list' }, rows.map(readingItem))),
    guide(),
  );
}

function row(a: Analysis, scale: Scale): HTMLElement {
  const c = a.company;
  const s = a.latest;
  const tone = a.reading?.tone ?? null;
  return h(
    'tr',
    null,
    h(
      'th',
      { scope: 'row', class: 'c-name' },
      h('a', { href: `#/company/${c.id}`, class: 'co' }, c.name),
      h('span', { class: 'co-meta' }, h('span', null, c.ticker), h('span', { class: 'asset' }, c.asset)),
      s?.stale ? h('span', { class: 'flag', title: s.missing.map(missingLabel).join(', ') }, 'Incomplete data') : null,
    ),
    h('td', { class: 'c-mnav num', 'data-label': 'mNAV' }, h('span', { class: `big tone-${tone ?? 'none'}` }, mnav(a.mnav)), a.reading ? h('span', { class: `badge tone-${tone}` }, a.reading.label) : null),
    h('td', { class: 'c-bar', 'data-label': 'Past year and today' }, premiumBar(scale, a.mnav, a.range, tone, c.name)),
    h('td', { class: 'num', 'data-label': 'Year rank' }, yearRank(a)),
    h('td', { class: `num ${signClass(a.change30d)}`, 'data-label': '30 days' }, pct(a.change30d)),
    h('td', { class: `num ${signClass(a.yield90d)}`, 'data-label': 'Coin yield 90d' }, pct(a.yield90d)),
    h('td', { class: 'num', 'data-label': 'Payback' }, paybackText(a)),
  );
}

/** Percentile of today's mNAV within its past year: low = cheap by the company's own standards. */
function yearRank(a: Analysis): HTMLElement | string {
  if (!a.range) return '–';
  const pos = rangePosition(a.range.percentile);
  return h(
    'span',
    { class: 'rank-cell' },
    h('span', { class: `rank rank-${pos}`, title: `${mnav(a.range.min)} to ${mnav(a.range.max)} ${a.rangeLabel}; today is higher than ${Math.round(a.range.percentile)}% of days` }, ordinal(Math.round(a.range.percentile))),
    a.rangeShort ? h('span', { class: 'rank-note' }, a.rangeLabel) : null,
  );
}

/** The one or two facts worth reading first. */
function headline(rows: Analysis[]): string {
  const parts: string[] = [];
  const below = rows.filter((r) => r.mnav !== null && r.mnav < 1);
  if (below.length) parts.push(`${names(below)} ${below.length === 1 ? 'trades' : 'trade'} below the value of ${below.length === 1 ? 'its' : 'their'} coins.`);
  const ranged = rows.filter((r) => r.range && r.mnav !== null);
  if (ranged.length > 1) {
    const cheap = ranged.reduce((a, b) => (a.range!.percentile <= b.range!.percentile ? a : b));
    const rich = ranged.reduce((a, b) => (a.range!.percentile >= b.range!.percentile ? a : b));
    const short = ranged.some((r) => r.rangeShort);
    parts.push(
      `Against its own ${short ? 'recent history' : 'past year'}, ${cheap.company.name} is the cheapest (higher than ${Math.round(cheap.range!.percentile)}% of days)${rich !== cheap ? ` and ${rich.company.name} the most expensive (${Math.round(rich.range!.percentile)}%)` : ''}.`,
    );
  }
  if (!parts.length) {
    const priced = rows.filter((r) => r.mnav !== null);
    if (!priced.length) return 'No mNAV yet. Add holdings and share counts in Admin, then run a backfill.';
    parts.push(`${priced.at(-1)!.company.name} carries the highest premium at ${mnav(priced.at(-1)!.mnav)}.`);
  }
  return parts.join(' ');
}

function names(rows: Analysis[]): string {
  const n = rows.map((r) => r.company.name);
  return n.length <= 2 ? n.join(' and ') : `${n.slice(0, -1).join(', ')} and ${n.at(-1)}`;
}

function readingItem(a: Analysis): HTMLElement {
  return h(
    'article',
    { class: 'reading-item' },
    h('h3', null, h('a', { href: `#/company/${a.company.id}` }, a.company.name), a.reading ? h('span', { class: `badge tone-${a.reading.tone}` }, a.reading.label) : null),
    h('p', null, a.reading?.text ?? 'No mNAV yet: the ledger needs holdings and share counts.'),
    a.latest?.stale ? h('p', { class: 'warn-text' }, `Latest data is incomplete: ${a.latest.missing.map(missingLabel).join(', ')}.`) : null,
  );
}

function guide(): HTMLElement {
  const term = (dt: string, ...dd: (string | HTMLElement)[]) => [h('dt', null, dt), h('dd', null, ...dd)];
  return h(
    'details',
    { class: 'guide' },
    h('summary', null, 'How to read this'),
    h(
      'dl',
      null,
      ...term('mNAV', 'Market value of the company divided by the value of the coins it holds. At 1× the stock is priced exactly like its coins. Diluted mNAV counts convertibles, warrants and options as shares; the company page also shows basic and EV.'),
      ...term(
        'Bands',
        h('span', { class: 'badge tone-discount' }, 'Discount'),
        ' below 1×: cheaper than its coins. Usually distrust of debt, costs or whether the coins will reach shareholders. Issuing shares would dilute, so these companies tend to buy back stock or sell coins. ',
        h('span', { class: 'badge tone-fair' }, 'Near NAV'),
        ' 1× to 1.25×. ',
        h('span', { class: 'badge tone-premium' }, 'Premium'),
        ' 1.25× to 2×: investors expect coins per share to keep growing. ',
        h('span', { class: 'badge tone-high' }, 'High premium'),
        ' 2× and up: mostly a bet on future buying.',
      ),
      ...term(
        'Past year and today',
        "The shaded bar is the diluted mNAV's range over the past year, the tick is its median and the dot is today. Every row uses the same scale and the vertical line is 1×. A dot near the left end of its own bar is cheap by that company's own standards.",
      ),
      ...term('Year rank', 'Percentile of today\'s mNAV within the company\'s own past year: 10th means only 10% of days were cheaper. Low is cheap by the company\'s own standards, high is expensive. When there is less than a year of data, the date under the rank says where the history starts; treat a short history with care.'),
      ...term('30 days', 'Change in diluted mNAV over 30 days. A shrinking premium means the market is cooling on the company.'),
      ...term('Coin yield 90d', 'Growth in coins per diluted share over 90 days: what the company is actually delivering for shareholders.'),
      ...term(
        'Payback',
        'Years of coin yield, at the 90-day pace compounded to a year, needed for coins per share to catch up with the premium. Shorter is better. "Never" means coins per share are not growing; "none" means there is no premium to earn back.',
      ),
      ...term('Incomplete data', 'Something is missing or out of date in the latest snapshot, such as a share count. Incomplete snapshots are left out of the ranges and alerts.'),
    ),
    h('p', { class: 'fineprint' }, 'Rules of thumb, not investment advice. The thresholds are in shared/src/interpret.ts.'),
  );
}
