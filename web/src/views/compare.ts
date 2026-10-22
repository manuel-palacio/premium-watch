import { MNAV_VARIANTS, addDays, mnavOf, type MnavVariant } from '@pw/shared';
import { lineColor, pageChart } from '../charts.ts';
import { companies, snapshots, today } from '../data.ts';
import { h, onMounted } from '../dom.ts';
import { RANGES, RANGE_DAYS, RANGE_LABEL, segmented, type Range } from './company.ts';

const VARIANT_LABEL: Record<MnavVariant, string> = { basic: 'Basic', diluted: 'Diluted', ev: 'EV' };

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
      { refLine: 1, log: true },
    );
  };
  onMounted(draw);

  return h(
    'div',
    { class: 'page' },
    h('header', { class: 'page-head' }, h('h1', null, 'Compare'), h('p', { class: 'lede' }, 'Every company\'s mNAV on one chart. The scale is logarithmic so equal steps are equal ratios; the dashed line is 1×, below which a company is valued at less than its coins.')),
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
          segmented(MNAV_VARIANTS, VARIANT_LABEL, variant, (v) => ((variant = v), draw()), 'mNAV measure'),
          segmented(RANGES, RANGE_LABEL, range, (r) => ((range = r), draw()), 'Time range'),
        ),
      ),
      series.length ? el : h('div', { class: 'empty' }, 'No companies yet.'),
      h(
        'div',
        { class: 'legend' },
        series.map(({ c }, i) => h('span', { style: `--c:${lineColor(i)}` }, c.name, h('span', { class: 'muted' }, ` ${c.ticker}`))),
      ),
    ),
  );
}
