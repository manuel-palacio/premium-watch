import { describe, expect, it } from 'vitest';
import { evaluateCondition, nextAlertState, type AlertSpec, type Metrics, type Snapshot } from '../src/index.ts';
import { mstr } from './fixtures.ts';

function snap(date: string, mnavDiluted: number | null, stale = false): Snapshot {
  const metrics = { mnavBasic: null, mnavDiluted, mnavEv: null } as unknown as Metrics;
  return { id: `mstr_${date}`, companyId: 'mstr', date, kind: 'close', final: true, computedAt: '', inputs: { price: null, spot: null, fx: null, ledger: {} }, metrics, stale, missing: [], assumedZero: [] };
}

describe('evaluateCondition', () => {
  const below: AlertSpec = { rule: 'mnav_below', params: { variant: 'diluted', threshold: 1 } };
  const above: AlertSpec = { rule: 'mnav_above', params: { variant: 'diluted', threshold: 2 } };

  it('mnav_below', () => {
    expect(evaluateCondition(below, mstr, snap('2026-10-21', 0.95), []).met).toBe(true);
    expect(evaluateCondition(below, mstr, snap('2026-10-21', 1), []).met).toBe(false);
    expect(evaluateCondition(below, mstr, snap('2026-10-21', 0.95), []).message).toBe('Strategy (MSTR): diluted mNAV 0.95 is below 1.00');
  });

  it('mnav_above', () => {
    expect(evaluateCondition(above, mstr, snap('2026-10-21', 2.1), []).met).toBe(true);
    expect(evaluateCondition(above, mstr, snap('2026-10-21', 2), []).met).toBe(false);
  });

  it('stale or missing snapshots are not evaluated', () => {
    expect(evaluateCondition(below, mstr, snap('2026-10-21', 0.5, true), []).met).toBeNull();
    expect(evaluateCondition(below, mstr, snap('2026-10-21', null), []).met).toBeNull();
  });

  describe('compression_pct_over_days', () => {
    const rule: AlertSpec = { rule: 'compression_pct_over_days', params: { variant: 'diluted', pct: 20, days: 30 } };
    const history = [snap('2026-09-15', 3), snap('2026-09-21', 2), snap('2026-09-25', 9, true), snap('2026-10-10', 1.4)];

    it('compares with the latest non-stale value on or before date − days', () => {
      // base = 2026-09-21 (2.0); stale 09-25 ignored and 10-10 is inside the window
      const c = evaluateCondition(rule, mstr, snap('2026-10-21', 1.5), history);
      expect(c.met).toBe(true); // −25%
      expect(c.message).toContain('fell 25.00% from 2.00 (2026-09-21) to 1.50');
    });
    it('not met under the threshold', () => expect(evaluateCondition(rule, mstr, snap('2026-10-21', 1.7), history).met).toBe(false));
    it('unknown without history', () => expect(evaluateCondition(rule, mstr, snap('2026-10-21', 1.5), []).met).toBeNull());
  });
});

describe('nextAlertState (no re-fire until reset)', () => {
  it('fires on the first breach only', () => {
    let state = { enabled: true, active: false };
    const seq = [true, true, null, true, false, true].map((met) => {
      const t = nextAlertState(state, met);
      state = { enabled: true, active: t.active };
      return t.fire;
    });
    expect(seq).toEqual([true, false, false, false, false, true]);
  });
  it('disabled alerts never fire but track state', () => {
    expect(nextAlertState({ enabled: false, active: false }, true)).toEqual({ fire: false, active: true });
  });
});
