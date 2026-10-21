import { isWeekday, localDate, localTime } from './dates.ts';
import type { Currency, ExchangeCode, IsoDate } from './types.ts';

export interface ExchangeInfo {
  code: ExchangeCode;
  name: string;
  timeZone: string;
  currency: Currency;
  /** Trading sessions in local time, `HH:MM`, start inclusive, end exclusive. */
  sessions: { start: string; end: string }[];
  close: string;
  /** EODHD exchange suffix. */
  eodhdSuffix: string;
}

export const EXCHANGES: Record<ExchangeCode, ExchangeInfo> = {
  NASDAQ: {
    code: 'NASDAQ',
    name: 'Nasdaq',
    timeZone: 'America/New_York',
    currency: 'USD',
    sessions: [{ start: '09:30', end: '16:00' }],
    close: '16:00',
    eodhdSuffix: 'US',
  },
  NYSE: {
    code: 'NYSE',
    name: 'New York Stock Exchange',
    timeZone: 'America/New_York',
    currency: 'USD',
    sessions: [{ start: '09:30', end: '16:00' }],
    close: '16:00',
    eodhdSuffix: 'US',
  },
  TSE: {
    code: 'TSE',
    name: 'Tokyo Stock Exchange',
    timeZone: 'Asia/Tokyo',
    currency: 'JPY',
    sessions: [
      { start: '09:00', end: '11:30' },
      { start: '12:30', end: '15:30' },
    ],
    close: '15:30',
    eodhdSuffix: 'TSE',
  },
};

/** Scheduler groups: each runs its own daily-close trigger. */
export const MARKET_GROUPS = {
  us: ['NASDAQ', 'NYSE'] as ExchangeCode[],
  tokyo: ['TSE'] as ExchangeCode[],
};
export type MarketGroup = keyof typeof MARKET_GROUPS;

export function exchangeDate(code: ExchangeCode, instant: Date): IsoDate {
  return localDate(instant, EXCHANGES[code].timeZone);
}

/** True during a trading session on a weekday (holidays ignored). */
export function isTradingHours(code: ExchangeCode, instant: Date): boolean {
  const ex = EXCHANGES[code];
  if (!isWeekday(localDate(instant, ex.timeZone))) return false;
  const t = localTime(instant, ex.timeZone);
  return ex.sessions.some((s) => t >= s.start && t < s.end);
}

/** True on a weekday after the closing time, in exchange local time. */
export function isAfterClose(code: ExchangeCode, instant: Date): boolean {
  const ex = EXCHANGES[code];
  return isWeekday(localDate(instant, ex.timeZone)) && localTime(instant, ex.timeZone) >= ex.close;
}
