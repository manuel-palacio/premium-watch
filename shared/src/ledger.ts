import { LEDGER_TYPES, type IsoDate, type LedgerEntry, type LedgerType } from './types.ts';

export type LedgerState = Partial<Record<LedgerType, LedgerEntry>>;

/** Later wins: by effective date, then by creation time, then by id. */
function newer(a: LedgerEntry, b: LedgerEntry): boolean {
  if (a.effectiveDate !== b.effectiveDate) return a.effectiveDate > b.effectiveDate;
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt;
  return a.id > b.id;
}

/**
 * The company's ledger as it stood on `date`: for each type, the latest entry with
 * `effectiveDate <= date`. When two entries share an effective date, the most recently
 * created one wins (a correction).
 */
export function ledgerAsOf(entries: readonly LedgerEntry[], companyId: string, date: IsoDate): LedgerState {
  const state: LedgerState = {};
  for (const e of entries) {
    if (e.companyId !== companyId || e.effectiveDate > date) continue;
    const cur = state[e.type];
    if (!cur || newer(e, cur)) state[e.type] = e;
  }
  return state;
}

export function ledgerValue(state: LedgerState, type: LedgerType): number | null {
  return state[type]?.value ?? null;
}

export function isLedgerType(s: string): s is LedgerType {
  return (LEDGER_TYPES as readonly string[]).includes(s);
}
