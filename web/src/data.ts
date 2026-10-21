import { collection, getDocs, limit, orderBy, query, where, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore';
import { addDays, type Alert, type AlertEvent, type Company, type IsoDate, type LedgerEntry, type Snapshot } from '@pw/shared';
import { firestore, idToken } from './firebase.ts';

const withId = <T>(d: QueryDocumentSnapshot<DocumentData>): T => ({ ...d.data(), id: d.id }) as T;

/** Days of snapshot history loaded per company (covers 365-day coin yield and charts). */
export const HISTORY_DAYS = 800;

const cache = new Map<string, Promise<unknown>>();
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (!cache.has(key)) cache.set(key, load().catch((e) => (cache.delete(key), Promise.reject(e))));
  return cache.get(key) as Promise<T>;
}
export function invalidate(prefix = ''): void {
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
}

export const today = (): IsoDate => new Date().toISOString().slice(0, 10);

export function companies(): Promise<Company[]> {
  return cached('companies', async () => (await getDocs(collection(firestore(), 'companies'))).docs.map((d) => withId<Company>(d)).sort((a, b) => a.name.localeCompare(b.name)));
}

export function snapshots(companyId: string): Promise<Snapshot[]> {
  return cached(`snapshots:${companyId}`, async () => {
    const q = query(collection(firestore(), 'snapshots'), where('companyId', '==', companyId), where('date', '>=', addDays(today(), -HISTORY_DAYS)), orderBy('date'));
    return (await getDocs(q)).docs.map((d) => withId<Snapshot>(d));
  });
}

export function ledger(companyId?: string): Promise<LedgerEntry[]> {
  return cached(`ledger:${companyId ?? '*'}`, async () => {
    const col = collection(firestore(), 'ledger');
    const q = companyId ? query(col, where('companyId', '==', companyId)) : col;
    return (await getDocs(q)).docs
      .map((d) => withId<LedgerEntry>(d))
      .sort((a, b) => (a.effectiveDate === b.effectiveDate ? b.createdAt.localeCompare(a.createdAt) : b.effectiveDate.localeCompare(a.effectiveDate)));
  });
}

export function alerts(): Promise<Alert[]> {
  return cached('alerts', async () => (await getDocs(collection(firestore(), 'alerts'))).docs.map((d) => withId<Alert>(d)));
}

export function alertEvents(): Promise<AlertEvent[]> {
  return cached('alertEvents', async () => {
    const q = query(collection(firestore(), 'alertEvents'), orderBy('firedAt', 'desc'), limit(200));
    return (await getDocs(q)).docs.map((d) => withId<AlertEvent>(d));
  });
}

export class ApiError extends Error {
  readonly errors: string[];
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown) {
    const errs = (body as { errors?: unknown[] })?.errors ?? [`HTTP ${status}`];
    const list = errs.map((e) => (typeof e === 'string' ? e : `line ${(e as { line: number }).line}: ${(e as { errors: string[] }).errors.join('; ')}`));
    super(list.join('\n'));
    this.errors = list;
    this.status = status;
    this.body = body;
  }
}

/** Call the admin API with the user's ID token. */
export async function apiCall<T = unknown>(method: string, path: string, payload?: unknown, contentType = 'application/json'): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { authorization: `Bearer ${await idToken()}`, ...(payload !== undefined ? { 'content-type': contentType } : {}) },
    ...(payload !== undefined ? { body: typeof payload === 'string' ? payload : JSON.stringify(payload) } : {}),
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}
