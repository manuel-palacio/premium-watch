import { daysBetween, isIsoDate, type IsoDate, type LedgerEntry } from '@pw/shared';

/** What the research step proposes for one company. */
export interface HoldingsProposal {
  found: boolean;
  holdings?: number;
  effectiveDate?: string;
  sourceUrl?: string;
  evidence?: string;
  note?: string;
}

export interface CheckContext {
  current: LedgerEntry | undefined;
  allowedDomains: string[];
  today: IsoDate;
  /** Largest accepted ratio between new and current holdings, in either direction. */
  maxRatio?: number;
}

export type CheckResult = { status: 'accept' } | { status: 'none'; reason: string } | { status: 'review'; reason: string };

/** The latest holdings entry: latest effective date, then latest createdAt (same rule as the ledger). */
export function latestHoldings(entries: LedgerEntry[]): LedgerEntry | undefined {
  return entries
    .filter((e) => e.type === 'holdings')
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.createdAt.localeCompare(b.createdAt))
    .at(-1);
}

export function hostAllowed(url: string, domains: string[]): boolean {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Checks a proposal before the source itself is fetched. */
export function checkProposal(p: HoldingsProposal, ctx: CheckContext): CheckResult {
  if (!p.found) return { status: 'none', reason: p.note || 'nothing newer disclosed' };
  const { holdings, effectiveDate, sourceUrl } = p;
  if (typeof holdings !== 'number' || !Number.isFinite(holdings) || holdings <= 0) return { status: 'review', reason: `bad holdings value: ${holdings}` };
  if (!effectiveDate || !isIsoDate(effectiveDate)) return { status: 'review', reason: `bad effective date: ${effectiveDate}` };
  if (effectiveDate > ctx.today) return { status: 'review', reason: `effective date ${effectiveDate} is in the future` };
  if (!sourceUrl || !hostAllowed(sourceUrl, ctx.allowedDomains)) return { status: 'review', reason: `source not on an allowed domain: ${sourceUrl}` };
  const cur = ctx.current;
  if (cur) {
    if (effectiveDate < cur.effectiveDate) return { status: 'none', reason: `older than the ledger (${cur.effectiveDate})` };
    if (effectiveDate === cur.effectiveDate) {
      return holdings === cur.value ? { status: 'none', reason: 'already in the ledger' } : { status: 'review', reason: `same date as the ledger (${cur.effectiveDate}) but ${holdings} vs ${cur.value}` };
    }
    if (holdings === cur.value) return { status: 'none', reason: `unchanged since ${cur.effectiveDate}` };
    const ratio = holdings / cur.value;
    const max = ctx.maxRatio ?? 2;
    if (ratio > max || ratio < 1 / max) return { status: 'review', reason: `${holdings} is ${ratio.toFixed(2)}× the ledger's ${cur.value}` };
    if (daysBetween(cur.effectiveDate, effectiveDate) > 400) return { status: 'review', reason: `more than 400 days after ${cur.effectiveDate}` };
  }
  return { status: 'accept' };
}

/**
 * True if `value` is written in `text` as a whole number: 848517, 848,517, 848 517 or 848.517.
 * Digits around it must not continue the number (so 44,000 does not match 144,000).
 */
export function numberAppears(text: string, value: number): boolean {
  if (!Number.isInteger(value)) return text.includes(String(value));
  const digits = String(value);
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) groups.unshift(digits.slice(Math.max(0, end - 3), end));
  const sep = '[,.\\s\\u00a0\\u202f\\u3000\\uff0c]?';
  const re = new RegExp(`(?<![\\d,.])${groups.join(sep)}(?![\\d]|[,.]\\d)`);
  return re.test(text);
}
