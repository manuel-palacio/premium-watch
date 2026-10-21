import { addDays, mnavOf, pctChange, type Company, type Snapshot } from '@pw/shared';
import { companies, snapshots, today } from '../data.ts';
import { h } from '../dom.ts';
import { coins, dash, freshness, missingLabel, mnav, pct, signClass, usd } from '../format.ts';

/** Latest snapshot with a value on or before `date`. */
export function snapshotOnOrBefore(list: Snapshot[], date: string): Snapshot | undefined {
  for (let i = list.length - 1; i >= 0; i--) if (list[i]!.date <= date) return list[i];
  return undefined;
}

export interface Row {
  company: Company;
  latest: Snapshot | undefined;
  change30d: number | null;
}

export async function loadRows(): Promise<Row[]> {
  const list = (await companies()).filter((c) => c.active);
  return Promise.all(
    list.map(async (company) => {
      const snaps = await snapshots(company.id);
      const latest = snaps.at(-1);
      const past = latest ? snapshotOnOrBefore(snaps, addDays(latest.date, -30)) : undefined;
      return { company, latest, change30d: pctChange(past ? mnavOf(past.metrics, 'diluted') : null, latest ? mnavOf(latest.metrics, 'diluted') : null) };
    }),
  );
}

export async function overview(): Promise<HTMLElement> {
  const rows = await loadRows();
  const t = today();
  if (!rows.length) {
    return h('div', null, h('h1', null, 'Overview'), h('div', { class: 'card empty' }, 'No companies yet. ', h('a', { href: '#/admin' }, 'Add one in Admin'), '.'));
  }

  const body = rows.map(({ company: c, latest: s, change30d }) => {
    const m = s?.metrics;
    const fresh = freshness(s, t);
    return h(
      'tr',
      null,
      h('td', { class: 'head', 'data-label': 'Company' }, h('a', { href: `#/company/${c.id}` }, c.name), ' ', h('span', { class: 'muted small' }, c.ticker)),
      h('td', { 'data-label': 'Asset' }, h('span', { class: 'badge asset' }, c.asset)),
      h('td', { class: 'num', 'data-label': 'Coins held' }, coins(m ? (s?.inputs.ledger.holdings?.value ?? null) : null)),
      h('td', { class: 'num', 'data-label': 'NAV' }, usd(m?.nav)),
      h(
        'td',
        { class: 'num', 'data-label': 'mNAV (diluted)' },
        m
          ? h(
              'span',
              { class: 'tip', tabindex: '0', 'aria-label': `basic ${mnav(m.mnavBasic)}, EV ${mnav(m.mnavEv)}` },
              h('strong', { class: (m.mnavDiluted ?? 2) < 1 ? 'bad' : '' }, mnav(m.mnavDiluted)),
              h('span', { class: 'pop' }, `basic ${mnav(m.mnavBasic)} · EV ${mnav(m.mnavEv)}`),
            )
          : dash,
      ),
      h('td', { class: `num ${signClass(change30d)}`, 'data-label': 'mNAV 30d' }, pct(change30d)),
      h('td', { class: `num ${signClass(m?.coinYield90d)}`, 'data-label': 'Coin yield 90d' }, pct(m?.coinYield90d)),
      h('td', { 'data-label': 'Data' }, h('span', { class: fresh.old ? 'badge warn' : 'muted small' }, fresh.text)),
      h('td', { 'data-label': 'Warnings' }, s?.stale ? s.missing.map((x) => h('span', { class: 'badge warn' }, missingLabel(x), ' ')) : h('span', { class: 'muted small' }, s ? 'ok' : dash)),
    );
  });

  return h(
    'div',
    null,
    h('h1', null, 'Overview'),
    h('p', { class: 'sub' }, 'What the market pays per unit of crypto held. Diluted mNAV; hover or tap it for basic and EV.'),
    h(
      'div',
      { class: 'table-wrap cards' },
      h(
        'table',
        null,
        h(
          'thead',
          null,
          h('tr', null, ['Company', 'Asset', 'Coins held', 'NAV', 'mNAV', 'mNAV 30d', 'Coin yield 90d', 'Data', 'Warnings'].map((x, i) => h('th', { class: i >= 2 && i <= 6 ? 'num' : '' }, x))),
        ),
        h('tbody', null, body),
      ),
    ),
  );
}
