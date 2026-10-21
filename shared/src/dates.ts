import type { IsoDate } from './types.ts';

const DAY_MS = 86_400_000;

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const t = Date.parse(`${date}T00:00:00Z`) + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function isWeekday(date: IsoDate): boolean {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow !== 0 && dow !== 6;
}

/** Number of weekdays in (from, to]. Exchange holidays are ignored. */
export function tradingDaysBetween(from: IsoDate, to: IsoDate): number {
  if (to <= from) return 0;
  let n = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (isWeekday(d)) n++;
  return n;
}

/** Inclusive list of dates from `start` to `end`. */
export function dateRange(start: IsoDate, end: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

function parts(instant: Date, timeZone: string): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });
  return Object.fromEntries(fmt.formatToParts(instant).map((p) => [p.type, p.value]));
}

/** Calendar date of `instant` in `timeZone`. */
export function localDate(instant: Date, timeZone: string): IsoDate {
  const p = parts(instant, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Wall-clock time of `instant` in `timeZone`, `HH:MM`. */
export function localTime(instant: Date, timeZone: string): string {
  const p = parts(instant, timeZone);
  return `${p.hour}:${p.minute}`;
}

function tzOffsetMs(instant: Date, timeZone: string): number {
  const p = parts(instant, timeZone);
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!);
  return asUtc - Math.floor(instant.getTime() / 60_000) * 60_000;
}

/** The instant when the wall clock in `timeZone` shows `date` `time` (`HH:MM`). */
export function zonedToUtc(date: IsoDate, time: string, timeZone: string): Date {
  const [h, m] = time.split(':').map(Number);
  const wall = Date.parse(`${date}T00:00:00Z`) + (h! * 60 + m!) * 60_000;
  let t = wall - tzOffsetMs(new Date(wall), timeZone);
  t = wall - tzOffsetMs(new Date(t), timeZone);
  return new Date(t);
}
