import { ColorType, LineSeries, LineStyle, PriceScaleMode, createChart, type IChartApi, type ISeriesApi, type LineData, type Time } from 'lightweight-charts';

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const lineColor = (i: number) => css(`--line-${(i % 6) + 1}`);

const dark = matchMedia('(prefers-color-scheme: dark)');
const live = new Set<IChartApi>();

function themeOptions() {
  return {
    layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: css('--muted'), fontFamily: css('--font'), attributionLogo: false },
    grid: { vertLines: { color: css('--grid') }, horzLines: { color: css('--grid') } },
    rightPriceScale: { borderColor: css('--border') },
    timeScale: { borderColor: css('--border') },
    crosshair: { horzLine: { labelBackgroundColor: css('--text') }, vertLine: { labelBackgroundColor: css('--text') } },
  };
}

dark.addEventListener('change', () => {
  for (const c of live) c.applyOptions(themeOptions());
});

export interface Line {
  label: string;
  points: { date: string; value: number | null }[];
  color?: string;
}

export interface ChartHandle {
  setLines(lines: Line[], opts?: { refLine?: number; precision?: number; log?: boolean }): void;
  destroy(): void;
}

/** A line chart with theme-aware colours. Gaps (null values) are skipped. */
export function lineChart(el: HTMLElement): ChartHandle {
  const chart = createChart(el, { autoSize: true, ...themeOptions(), handleScale: { mouseWheel: false }, handleScroll: { mouseWheel: false } });
  live.add(chart);
  let series: ISeriesApi<'Line'>[] = [];

  return {
    setLines(lines, opts = {}) {
      chart.priceScale('right').applyOptions({ mode: opts.log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal });
      for (const s of series) chart.removeSeries(s);
      series = lines.map((line, i) => {
        const s = chart.addSeries(LineSeries, {
          color: line.color ?? lineColor(i),
          lineWidth: 2,
          title: lines.length > 1 ? line.label : '',
          priceFormat: { type: 'price', precision: opts.precision ?? 2, minMove: 10 ** -(opts.precision ?? 2) },
          lastValueVisible: true,
          priceLineVisible: false,
        });
        const data: LineData<Time>[] = line.points.filter((p) => p.value !== null && Number.isFinite(p.value)).map((p) => ({ time: p.date as Time, value: p.value as number }));
        s.setData(data);
        if (i === 0 && opts.refLine !== undefined) {
          s.createPriceLine({ price: opts.refLine, color: css('--parity'), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `${opts.refLine.toFixed(1)}×` });
        }
        return s;
      });
      chart.timeScale().fitContent();
      // autoSize applies the real width a frame later; fit again once it has.
      requestAnimationFrame(() => requestAnimationFrame(() => chart.timeScale().fitContent()));
    },
    destroy() {
      live.delete(chart);
      chart.remove();
    },
  };
}

/** Charts created while building a view; the router takes them and destroys them on navigation. */
const pending: ChartHandle[] = [];
export function pageChart(el: HTMLElement): ChartHandle {
  const c = lineChart(el);
  pending.push(c);
  return c;
}
export function takePageCharts(): ChartHandle[] {
  return pending.splice(0);
}
