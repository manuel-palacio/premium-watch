import { describe, expect, it } from 'vitest';
import type { LedgerEntry } from '@pw/shared';
import { checkProposal, hostAllowed, latestHoldings, numberAppears } from '../src/holdings/check.ts';

const entry = (effectiveDate: string, value: number, createdAt = '2026-10-23T00:00:00.000Z', type: LedgerEntry['type'] = 'holdings'): LedgerEntry => ({
  id: `${effectiveDate}-${value}`,
  companyId: 'mstr',
  effectiveDate,
  type,
  value,
  sourceUrl: 'https://www.sec.gov/x.htm',
  createdAt,
});

const ctx = (current?: LedgerEntry) => ({ current, allowedDomains: ['sec.gov', 'strategy.com'], today: '2026-10-27' });
const proposal = (holdings: number, effectiveDate: string, sourceUrl = 'https://www.sec.gov/Archives/edgar/data/1050446/x/mstr-20261026.htm') => ({
  found: true,
  holdings,
  effectiveDate,
  sourceUrl,
});

describe('latestHoldings', () => {
  it('takes the latest date, then the latest createdAt, ignoring other types', () => {
    const e = [entry('2026-10-18', 1), entry('2026-10-25', 2, '2026-10-26T00:00:00Z'), entry('2026-10-25', 3, '2026-10-27T00:00:00Z'), entry('2026-10-30', 9, undefined, 'cash')];
    expect(latestHoldings(e)?.value).toBe(3);
  });
});

describe('hostAllowed', () => {
  it('accepts the domain and its subdomains over https only', () => {
    expect(hostAllowed('https://api.strategy.com/btc/bitcoinKpis', ['strategy.com'])).toBe(true);
    expect(hostAllowed('https://www.sec.gov/a.htm', ['sec.gov'])).toBe(true);
    expect(hostAllowed('http://www.sec.gov/a.htm', ['sec.gov'])).toBe(false);
    expect(hostAllowed('https://notsec.gov/a.htm', ['sec.gov'])).toBe(false);
    expect(hostAllowed('https://sec.gov.evil.com/a.htm', ['sec.gov'])).toBe(false);
    expect(hostAllowed('not a url', ['sec.gov'])).toBe(false);
  });
});

describe('checkProposal', () => {
  const cur = entry('2026-10-18', 848517);
  it('accepts a newer, plausible total from an allowed domain', () => {
    expect(checkProposal(proposal(848907, '2026-10-25'), ctx(cur))).toEqual({ status: 'accept' });
  });
  it('reports found=false as nothing new', () => {
    expect(checkProposal({ found: false, note: 'no new 8-K' }, ctx(cur))).toEqual({ status: 'none', reason: 'no new 8-K' });
  });
  it('ignores older or identical figures', () => {
    expect(checkProposal(proposal(848250, '2026-10-11'), ctx(cur)).status).toBe('none');
    expect(checkProposal(proposal(848517, '2026-10-18'), ctx(cur)).status).toBe('none');
    expect(checkProposal(proposal(848517, '2026-10-25'), ctx(cur)).status).toBe('none');
  });
  it('sends suspicious proposals to review', () => {
    expect(checkProposal(proposal(848000, '2026-10-18'), ctx(cur)).status).toBe('review'); // same date, other value
    expect(checkProposal(proposal(2_000_000, '2026-10-25'), ctx(cur)).status).toBe('review'); // > 2x
    expect(checkProposal(proposal(400_000, '2026-10-25'), ctx(cur)).status).toBe('review'); // < 0.5x
    expect(checkProposal(proposal(848907, '2026-10-30'), ctx(cur)).status).toBe('review'); // future
    expect(checkProposal(proposal(848907, '2026-10-25', 'https://bitcointreasuries.net/x'), ctx(cur)).status).toBe('review');
    expect(checkProposal(proposal(-1, '2026-10-25'), ctx(cur)).status).toBe('review');
    expect(checkProposal({ found: true, holdings: 848907, effectiveDate: '25 Oct', sourceUrl: 'https://www.sec.gov/a.htm' }, ctx(cur)).status).toBe('review');
  });
  it('accepts a first entry with no ledger to compare against', () => {
    expect(checkProposal(proposal(1000, '2026-10-25'), ctx(undefined))).toEqual({ status: 'accept' });
  });
});

describe('numberAppears', () => {
  it('matches common thousand separators', () => {
    expect(numberAppears('aggregate holdings of 848,517 bitcoin', 848517)).toBe(true);
    expect(numberAppears('"btcHoldings":848517,', 848517)).toBe(true);
    expect(numberAppears('total 2 590 266 SOL', 2590266)).toBe(true);
    expect(numberAppears('保有量 44，000 BTC', 44000)).toBe(true);
  });
  it('does not match inside a longer number', () => {
    expect(numberAppears('144,000 BTC', 44000)).toBe(false);
    expect(numberAppears('44,0001', 44000)).toBe(false);
    expect(numberAppears('44,000.5 BTC', 44000)).toBe(false);
    expect(numberAppears('1,848,517', 848517)).toBe(false);
  });
  it('allows the number at the end of a sentence', () => {
    expect(numberAppears('held 44,000.', 44000)).toBe(true);
    expect(numberAppears('held 44,000, up from 43,000', 44000)).toBe(true);
  });
});
