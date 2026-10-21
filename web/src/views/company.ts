import { MNAV_VARIANTS, mnavOf, type MnavVariant } from '@pw/shared';
import { pageChart } from '../charts.ts';
import { companies, ledger, snapshots, today } from '../data.ts';
import { h, onMounted } from '../dom.ts';
import { coins, freshness, missingLabel, mnav, pct, plain, signClass, usd } from '../format.ts';

const VARIANT_LABEL: Record<MnavVariant, string> = { basic: 'Basic', diluted: 'Diluted', ev: 'EV' };

export function segmented<T extends string>(options: readonly T[], labels: Record<T, string>, value: T, onChange: (v: T) => void): HTMLElement {
  const wrap = h('div', { class: 'seg', role: 'group' });
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
  if (!company) return h('div', { class: 'card empty' }, `No company "${id}". `, h('a', { href: '#/' }, 'Back to overview'));
  const [snaps, entries] = await Promise.all([snapshots(id), ledger(id)]);
  const s = snaps.at(-1);
  const m = s?.metrics;
  const fresh = freshness(s, today());

  const stat = (label: string, value: string, note?: string, cls = '') =>
    h('div', { class: 'card stat' }, h('div', { class: 'label' }, label), h('div', { class: `value ${cls}` }, value), note ? h('div', { class: 'note' }, note) : null);

  const mnavEl = h('div', { class: 'chart tall' });
  const cpsEl = h('div', { class: 'chart' });
  let variant: MnavVariant = 'diluted';

  const page = h(
    'div',
    null,
    h('p', { class: 'small' }, h('a', { href: '#/' }, '← Overview')),
    h('h1', null, company.name, ' ', h('span', { class: 'muted' }, `${company.ticker} · ${company.exchange}`)),
    h('p', { class: 'sub' }, `Treasury asset ${company.asset} · prices in ${company.currency} · data ${fresh.text}`),
    s?.stale ? h('p', null, h('span', { class: 'badge warn' }, 'Stale: ', s.missing.map(missingLabel).join(', '))) : null,
    h(
      'div',
      { class: 'grid stats' },
      stat('mNAV diluted', mnav(m?.mnavDiluted), `basic ${mnav(m?.mnavBasic)} · EV ${mnav(m?.mnavEv)}`, (m?.mnavDiluted ?? 2) < 1 ? 'bad' : ''),
      stat(`${company.asset} held`, coins(s?.inputs.ledger.holdings?.value)),
      stat('NAV', usd(m?.nav), s?.inputs.spot ? `${company.asset} $${plain(Math.round(s.inputs.spot.usd))}` : undefined),
      stat('Market cap (diluted)', usd(m?.marketCapDiluted), `EV ${usd(m?.enterpriseValue)}`),
      stat('Coin yield', pct(m?.coinYield90d), `30d ${pct(m?.coinYield30d)} · 365d ${pct(m?.coinYield365d)}`, signClass(m?.coinYield90d)),
    ),
    h(
      'div',
      { class: 'card', style: 'margin-top:16px' },
      h(
        'div',
        { class: 'toolbar' },
        h('strong', null, 'mNAV'),
        segmented(MNAV_VARIANTS, VARIANT_LABEL, variant, (v) => {
          variant = v;
          drawMnav();
        }),
      ),
      snaps.length ? mnavEl : h('div', { class: 'empty' }, 'No snapshots yet.'),
    ),
    h('div', { class: 'card', style: 'margin-top:16px' }, h('div', { class: 'toolbar' }, h('strong', null, `${company.asset} per diluted share`)), snaps.length ? cpsEl : h('div', { class: 'empty' }, 'No snapshots yet.')),
    h('h2', null, 'Ledger history'),
    entries.length
      ? h(
          'div',
          { class: 'table-wrap cards' },
          h(
            'table',
            null,
            h('thead', null, h('tr', null, h('th', null, 'Effective'), h('th', null, 'Type'), h('th', { class: 'num' }, 'Value'), h('th', null, 'Source'), h('th', null, 'Note'))),
            h(
              'tbody',
              null,
              entries.map((e) =>
                h(
                  'tr',
                  null,
                  h('td', { class: 'head mono', 'data-label': 'Effective' }, e.effectiveDate),
                  h('td', { 'data-label': 'Type' }, e.type),
                  h('td', { class: 'num', 'data-label': 'Value' }, plain(e.value)),
                  h('td', { 'data-label': 'Source' }, h('a', { href: e.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, hostOf(e.sourceUrl))),
                  h('td', { class: 'muted small', 'data-label': 'Note' }, e.note ?? ''),
                ),
              ),
            ),
          ),
        )
      : h('div', { class: 'card empty' }, 'No ledger entries. ', h('a', { href: '#/admin/ledger' }, 'Add some'), '.'),
  );

  const mnavChart = snaps.length ? pageChart(mnavEl) : null;
  const cpsChart = snaps.length ? pageChart(cpsEl) : null;
  const usable = snaps.filter((x) => !x.stale);
  function drawMnav() {
    mnavChart?.setLines([{ label: VARIANT_LABEL[variant], points: usable.map((x) => ({ date: x.date, value: mnavOf(x.metrics, variant) })) }], { refLine: 1 });
  }
  onMounted(() => {
    drawMnav();
    cpsChart?.setLines([{ label: 'per diluted share', points: snaps.map((x) => ({ date: x.date, value: x.metrics.coinsPerShareDiluted })) }], { precision: 8 });
  });
  return page;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
