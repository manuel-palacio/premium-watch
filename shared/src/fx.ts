import type { Currency } from './types.ts';

/**
 * Convert `amount` in `currency` to USD. `usdJpy` is yen per dollar (the USD/JPY quote).
 * Returns null when a JPY amount has no rate.
 */
export function toUsd(amount: number, currency: Currency, usdJpy: number | null): number | null {
  if (currency === 'USD') return amount;
  if (usdJpy === null || !(usdJpy > 0)) return null;
  return amount / usdJpy;
}
