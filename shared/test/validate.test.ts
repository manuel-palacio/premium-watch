import { describe, expect, it } from 'vitest';
import { isAfterClose, isTradingHours, localDate, parseLedgerCsv, validateAlert, validateCompany } from '../src/index.ts';

describe('parseLedgerCsv', () => {
  it('parses valid rows, quoted fields and thousand separators', () => {
    const csv = [
      'companyId,effectiveDate,type,value,sourceUrl,note',
      'mstr,2026-10-20,holdings,"640,031",https://www.strategy.com/press/x,"8-K, Oct 20"',
      'metaplanet,2026-10-01,debt,15000000000,https://metaplanet.jp/en/ir,',
    ].join('\n');
    const r = parseLedgerCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ companyId: 'mstr', type: 'holdings', value: 640031, note: '8-K, Oct 20' });
    expect(r.rows[1]!.note).toBeUndefined();
  });

  it('reports bad rows by line number and keeps good ones', () => {
    const csv = 'companyId,effectiveDate,type,value,sourceUrl\nmstr,2026-13-01,holdings,1,https://x.com\nmstr,2026-01-01,coins,-1,\nmstr,2026-01-01,cash,5,https://x.com\n';
    const r = parseLedgerCsv(csv);
    expect(r.rows).toHaveLength(1);
    expect(r.errors.map((e) => e.line)).toEqual([2, 3]);
    expect(r.errors[1]!.errors).toHaveLength(3);
  });

  it('requires the header columns', () => {
    expect(parseLedgerCsv('companyId,type\nmstr,holdings').errors[0]!.errors[0]).toMatch(/missing columns: effectiveDate, value, sourceUrl/);
  });
});

describe('validators', () => {
  it('company', () => {
    expect(validateCompany({ id: 'upxi', name: 'Upexi', ticker: 'UPXI', exchange: 'NASDAQ', currency: 'USD', asset: 'SOL' }).ok).toBe(true);
    expect(validateCompany({ id: 'Bad Id', exchange: 'LSE' }).ok).toBe(false);
  });
  it('alert', () => {
    expect(validateAlert({ companyId: 'mstr', rule: 'compression_pct_over_days', params: { variant: 'ev', pct: '15', days: 30 } }).ok).toBe(true);
    expect(validateAlert({ companyId: 'mstr', rule: 'compression_pct_over_days', params: { variant: 'ev', pct: 15, days: 2.5 } }).ok).toBe(false);
    expect(validateAlert({ companyId: 'mstr', rule: 'nope', params: { variant: 'ev' } }).ok).toBe(false);
  });
});

describe('exchange hours', () => {
  it('Tokyo has a lunch break', () => {
    expect(isTradingHours('TSE', new Date('2026-10-22T01:00:00Z'))).toBe(true); // 10:00 JST
    expect(isTradingHours('TSE', new Date('2026-10-22T03:00:00Z'))).toBe(false); // 12:00 JST
    expect(isTradingHours('TSE', new Date('2026-10-22T06:31:00Z'))).toBe(false); // 15:31 JST
    expect(isAfterClose('TSE', new Date('2026-10-22T06:30:00Z'))).toBe(true);
  });
  it('Nasdaq follows New York time across DST', () => {
    expect(isTradingHours('NASDAQ', new Date('2026-10-22T13:30:00Z'))).toBe(true); // 09:30 EDT
    expect(isTradingHours('NASDAQ', new Date('2026-12-01T14:00:00Z'))).toBe(false); // 09:00 EST
    expect(isTradingHours('NASDAQ', new Date('2026-10-24T15:00:00Z'))).toBe(false); // Saturday
  });
  it('localDate', () => expect(localDate(new Date('2026-10-21T23:30:00Z'), 'Asia/Tokyo')).toBe('2026-10-22'));
});

describe('closeInstant', () => {
  it('handles DST in New York and fixed JST', async () => {
    const { closeInstant } = await import('../src/index.ts');
    expect(closeInstant('NASDAQ', '2026-10-21').toISOString()).toBe('2026-10-21T20:00:00.000Z');
    expect(closeInstant('NASDAQ', '2026-12-01').toISOString()).toBe('2026-12-01T21:00:00.000Z');
    expect(closeInstant('TSE', '2026-10-21').toISOString()).toBe('2026-10-21T06:30:00.000Z');
  });
});
