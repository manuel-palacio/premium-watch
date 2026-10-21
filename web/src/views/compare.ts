import { MNAV_VARIANTS, addDays, mnavOf, type MnavVariant } from '@pw/shared';
import { lineColor, pageChart } from '../charts.ts';
import { companies, snapshots, today } from '../data.ts';
import { h, onMounted } from '../dom.ts';
import { segmented } from './company.ts';

const VARIANT_LABEL: Record<MnavVariant, string> = { basic: 'Basic', diluted: 'Diluted', ev: 'EV' };
const RANGES = ['3m', '6m', '1y', 'all'] as const;
type Range = (typeof RANGES)[number];
const RANGE_LABEL: Record<Range, string> = { '3m': '3M', '6m': '6M', '1y': '1Y', all: 'All' };
const RANGE_DAYS: Record<Range, number | null> = { '3m': 91, '6m': 182, '1y': 365, all: null };

export async function comparePage(): Promise<HTMLElement> {
  const list = (await companies()).filter((c) => c.active);
  const series = await Promise.all(list.map(async (c) => ({ c, snaps: (await snapshots(c.id)).filter((s) => !s.stale) })));
  let variant: MnavVariant = 'diluted';
  let range: Range = '1y';
  const el = h('div', { class: 'chart tall' });
  const chart = pageChart(el);

  const draw = () => {
    const days = RANGE_DAYS[range];
    const from = days === null ? '' : addDays(today(), -days);
    chart.setLines(
      series.map(({ c, snaps }) => ({ label: c.ticker, points: snaps.filter((s) => s.date >= from).map((s) => ({ date: s.date, value: mnavOf(s.metrics, variant) })) })),
      { refLine: 1 },
    );
  };
  onMounted(draw);

  return h(
    'div',
    null,
    h('h1', null, 'Compare'),
    h('p', { class: 'sub' }, 'mNAV of every active company on one chart. The dashed line is 1.0×: below it the market values the company at less than its coins.'),
    h(
      'div',
      { class: 'card' },
      h(
        'div',
        { class: 'toolbar' },
        segmented(MNAV_VARIANTS, VARIANT_LABEL, variant, (v) => ((variant = v), draw())),
        segmented(RANGES, RANGE_LABEL, range, (r) => ((range = r), draw())),
      ),
      series.length ? el : h('div', { class: 'empty' }, 'No companies yet.'),
      h(
        'div',
        { class: 'legend' },
        series.map(({ c }, i) => h('span', { style: `--c:${lineColor(i)}` }, `${c.name} (${c.ticker})`)),
      ),
    ),
  );
}
