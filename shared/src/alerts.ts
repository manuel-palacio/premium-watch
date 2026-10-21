import { addDays } from './dates.ts';
import { mnavOf } from './metrics.ts';
import type { Alert, AlertSpec, Company, IsoDate, MnavVariant, Snapshot } from './types.ts';

export interface Condition {
  /** null = could not evaluate (stale or missing metric); the alert state is left unchanged. */
  met: boolean | null;
  value: number | null;
  message: string;
}

const VARIANT_LABEL: Record<MnavVariant, string> = { basic: 'basic mNAV', diluted: 'diluted mNAV', ev: 'EV mNAV' };
const fmt = (n: number) => n.toFixed(2);

/** The latest snapshot with a value for `variant` dated on or before `date`. */
function valueOnOrBefore(history: readonly Snapshot[], variant: MnavVariant, date: IsoDate): { date: IsoDate; value: number } | null {
  let best: { date: IsoDate; value: number } | null = null;
  for (const s of history) {
    const v = mnavOf(s.metrics, variant);
    if (s.date <= date && v !== null && !s.stale && (!best || s.date > best.date)) best = { date: s.date, value: v };
  }
  return best;
}

export function describeAlert(a: AlertSpec): string {
  const label = VARIANT_LABEL[a.params.variant];
  switch (a.rule) {
    case 'mnav_below':
      return `${label} below ${fmt(a.params.threshold)}`;
    case 'mnav_above':
      return `${label} above ${fmt(a.params.threshold)}`;
    case 'compression_pct_over_days':
      return `${label} down more than ${a.params.pct}% over ${a.params.days} days`;
  }
}

/**
 * Evaluate an alert's condition against the current snapshot.
 * `history` holds earlier snapshots of the same company (needed for compression rules).
 */
export function evaluateCondition(alert: AlertSpec, company: Company, current: Snapshot, history: readonly Snapshot[]): Condition {
  const label = VARIANT_LABEL[alert.params.variant];
  const name = `${company.name} (${company.ticker})`;
  const now = mnavOf(current.metrics, alert.params.variant);
  if (current.stale || now === null) return { met: null, value: now, message: `${name}: ${label} unavailable` };

  switch (alert.rule) {
    case 'mnav_below': {
      const met = now < alert.params.threshold;
      return { met, value: now, message: `${name}: ${label} ${fmt(now)} is ${met ? 'below' : 'at or above'} ${fmt(alert.params.threshold)}` };
    }
    case 'mnav_above': {
      const met = now > alert.params.threshold;
      return { met, value: now, message: `${name}: ${label} ${fmt(now)} is ${met ? 'above' : 'at or below'} ${fmt(alert.params.threshold)}` };
    }
    case 'compression_pct_over_days': {
      const base = valueOnOrBefore(history, alert.params.variant, addDays(current.date, -alert.params.days));
      if (!base) return { met: null, value: now, message: `${name}: no ${label} from ${alert.params.days} days ago` };
      const dropPct = ((base.value - now) / base.value) * 100;
      const met = dropPct > alert.params.pct;
      return {
        met,
        value: now,
        message: `${name}: ${label} fell ${fmt(dropPct)}% from ${fmt(base.value)} (${base.date}) to ${fmt(now)} (${current.date}), threshold ${alert.params.pct}% over ${alert.params.days} days`,
      };
    }
  }
}

export interface AlertTransition {
  fire: boolean;
  active: boolean;
}

/**
 * Fire only when the condition becomes true; stay quiet while it stays true; reset (re-arm)
 * once it is false again. An unknown condition leaves the state unchanged.
 */
export function nextAlertState(alert: Pick<Alert, 'enabled' | 'active'>, met: boolean | null): AlertTransition {
  const wasActive = alert.active === true;
  if (met === null) return { fire: false, active: wasActive };
  if (!alert.enabled) return { fire: false, active: met };
  return { fire: met && !wasActive, active: met };
}
