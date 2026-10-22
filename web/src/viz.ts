import type { RangeStats, Tone } from '@pw/shared';
import { h } from './dom.ts';
import { mnav } from './format.ts';

/** A log-scale mNAV axis shared by every row, so positions compare across companies. */
export interface Scale {
  min: number;
  max: number;
  /** 0–100 position of a value. */
  at(v: number): number;
  ticks: number[];
}

const NICE = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16];

export function logScale(values: number[]): Scale {
  const v = values.filter((x) => Number.isFinite(x) && x > 0);
  const lo = Math.min(1, ...v) / 1.15;
  const hi = Math.max(1, ...v) * 1.15;
  const span = Math.log(hi) - Math.log(lo);
  const at = (x: number) => Math.min(100, Math.max(0, ((Math.log(x) - Math.log(lo)) / span) * 100));
  let ticks = NICE.filter((t) => t >= lo && t <= hi);
  // Keep at most five labels, always including the parity line.
  while (ticks.length > 5) ticks = ticks.filter((t, i) => t === 1 || i % 2 === 0);
  return { min: lo, max: hi, at, ticks };
}

/** Axis labels above the column. */
export function scaleAxis(scale: Scale): HTMLElement {
  return h(
    'div',
    { class: 'scale-axis', 'aria-hidden': 'true' },
    scale.ticks.map((t) => h('span', { class: t === 1 ? 'parity' : '', style: `left:${scale.at(t)}%` }, t === 1 ? '1× = coins' : `${t}×`)),
  );
}

/**
 * One company's past-year range on the shared scale, with today's marker.
 * The parity line (1×) runs through every bar at the same position.
 */
export function premiumBar(scale: Scale, current: number | null, range: RangeStats | null, tone: Tone | null, label: string): HTMLElement {
  const parts: (HTMLElement | null)[] = [h('span', { class: 'pb-parity', style: `left:${scale.at(1)}%` })];
  if (range) {
    const l = scale.at(range.min);
    parts.push(h('span', { class: 'pb-range', style: `left:${l}%;width:${Math.max(0.8, scale.at(range.max) - l)}%` }));
    parts.push(h('span', { class: 'pb-median', style: `left:${scale.at(range.median)}%` }));
  }
  if (current !== null && Number.isFinite(current)) parts.push(h('span', { class: `pb-now tone-${tone ?? 'fair'}`, style: `left:${scale.at(current)}%` }));
  const desc =
    current === null
      ? `${label}: no mNAV yet`
      : range
        ? `${label}: ${mnav(current)} today; past year ${mnav(range.min)} to ${mnav(range.max)}, median ${mnav(range.median)}; higher than ${Math.round(range.percentile)}% of days`
        : `${label}: ${mnav(current)} today; not enough history for a range`;
  return h('div', { class: 'premium-bar', role: 'img', 'aria-label': desc, title: desc }, parts);
}
