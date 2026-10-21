import type { Company, LedgerEntry, LedgerType } from '../src/index.ts';

export const mstr: Company = { id: 'mstr', name: 'Strategy', ticker: 'MSTR', exchange: 'NASDAQ', currency: 'USD', asset: 'BTC', active: true };
export const metaplanet: Company = { id: 'metaplanet', name: 'Metaplanet', ticker: '3350', exchange: 'TSE', currency: 'JPY', asset: 'BTC', active: true };

let seq = 0;
export function entry(companyId: string, effectiveDate: string, type: LedgerType, value: number, createdAt = '2026-01-01T00:00:00Z'): LedgerEntry {
  seq++;
  return { id: `e${String(seq).padStart(4, '0')}`, companyId, effectiveDate, type, value, sourceUrl: 'https://example.com/filing', createdAt };
}
