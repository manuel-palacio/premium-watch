import Papa from 'papaparse';
import { isIsoDate } from './dates.ts';
import { isLedgerType } from './ledger.ts';
import {
  ASSETS,
  CURRENCIES,
  EXCHANGE_CODES,
  MNAV_VARIANTS,
  type Alert,
  type AlertSpec,
  type Company,
  type LedgerEntry,
} from './types.ts';

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const isHttpUrl = (s: unknown): s is string => {
  if (typeof s !== 'string') return false;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};
const includes = <T extends string>(list: readonly T[], v: unknown): v is T => list.includes(v as T);

export const COMPANY_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function validateCompany(input: unknown): Result<Company> {
  const o = (input ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof o.id !== 'string' || !COMPANY_ID_RE.test(o.id)) errors.push('id: lowercase letters, digits and dashes');
  if (typeof o.name !== 'string' || !o.name.trim()) errors.push('name: required');
  if (typeof o.ticker !== 'string' || !o.ticker.trim()) errors.push('ticker: required');
  if (!includes(EXCHANGE_CODES, o.exchange)) errors.push(`exchange: one of ${EXCHANGE_CODES.join(', ')}`);
  if (!includes(CURRENCIES, o.currency)) errors.push(`currency: one of ${CURRENCIES.join(', ')}`);
  if (!includes(ASSETS, o.asset)) errors.push(`asset: one of ${ASSETS.join(', ')}`);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      id: o.id as string,
      name: (o.name as string).trim(),
      ticker: (o.ticker as string).trim(),
      exchange: o.exchange as Company['exchange'],
      currency: o.currency as Company['currency'],
      asset: o.asset as Company['asset'],
      active: o.active !== false,
    },
  };
}

export type LedgerInputRow = Omit<LedgerEntry, 'id' | 'createdAt'>;

export function validateLedgerEntry(input: unknown): Result<LedgerInputRow> {
  const o = (input ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  const value = typeof o.value === 'string' ? Number(o.value.replace(/[_,\s]/g, '')) : o.value;
  if (typeof o.companyId !== 'string' || !o.companyId) errors.push('companyId: required');
  if (typeof o.effectiveDate !== 'string' || !isIsoDate(o.effectiveDate)) errors.push('effectiveDate: YYYY-MM-DD');
  if (typeof o.type !== 'string' || !isLedgerType(o.type)) errors.push('type: holdings, shares_basic, shares_diluted, debt, preferred or cash');
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) errors.push('value: a non-negative number');
  if (!isHttpUrl(o.sourceUrl)) errors.push('sourceUrl: an http(s) URL is required');
  if (errors.length) return { ok: false, errors };
  const note = typeof o.note === 'string' && o.note.trim() ? o.note.trim() : undefined;
  return {
    ok: true,
    value: {
      companyId: o.companyId as string,
      effectiveDate: o.effectiveDate as string,
      type: o.type as LedgerEntry['type'],
      value: value as number,
      sourceUrl: o.sourceUrl as string,
      ...(note ? { note } : {}),
    },
  };
}

export const LEDGER_CSV_COLUMNS = ['companyId', 'effectiveDate', 'type', 'value', 'sourceUrl', 'note'] as const;

export interface CsvParseResult {
  rows: LedgerInputRow[];
  /** 1-based line numbers, counting the header as line 1. */
  errors: { line: number; errors: string[] }[];
}

/** Parse a ledger CSV (header row required, `note` optional). */
export function parseLedgerCsv(text: string): CsvParseResult {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
    transform: (v) => v.trim(),
  });
  const result: CsvParseResult = { rows: [], errors: [] };
  const fields = parsed.meta.fields ?? [];
  const absent = LEDGER_CSV_COLUMNS.filter((c) => c !== 'note' && !fields.includes(c));
  if (absent.length) {
    result.errors.push({ line: 1, errors: [`missing columns: ${absent.join(', ')}`] });
    return result;
  }
  for (const e of parsed.errors) result.errors.push({ line: (e.row ?? 0) + 2, errors: [e.message] });
  parsed.data.forEach((row, i) => {
    const r = validateLedgerEntry(row);
    if (r.ok) result.rows.push(r.value);
    else result.errors.push({ line: i + 2, errors: r.errors });
  });
  return result;
}

export function validateAlert(input: unknown): Result<Omit<Alert, 'id' | 'active' | 'activeSince'>> {
  const o = (input ?? {}) as Record<string, unknown>;
  const p = (o.params ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof o.companyId !== 'string' || !o.companyId) errors.push('companyId: required');
  if (!includes(MNAV_VARIANTS, p.variant)) errors.push('params.variant: basic, diluted or ev');
  const num = (k: string, min: number) => {
    const v = typeof p[k] === 'string' ? Number(p[k]) : p[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= min) errors.push(`params.${k}: a number above ${min}`);
    return v as number;
  };
  let spec: AlertSpec | null = null;
  const variant = p.variant as AlertSpec['params']['variant'];
  if (o.rule === 'mnav_below' || o.rule === 'mnav_above') {
    spec = { rule: o.rule, params: { variant, threshold: num('threshold', 0) } };
  } else if (o.rule === 'compression_pct_over_days') {
    const days = num('days', 0);
    if (!Number.isInteger(days)) errors.push('params.days: a whole number');
    spec = { rule: o.rule, params: { variant, pct: num('pct', 0), days } };
  } else errors.push('rule: mnav_below, mnav_above or compression_pct_over_days');
  if (errors.length || !spec) return { ok: false, errors };
  return { ok: true, value: { ...spec, companyId: o.companyId as string, enabled: o.enabled !== false } };
}
