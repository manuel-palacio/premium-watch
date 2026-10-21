import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.ts';

if (!getApps().length) initializeApp({ projectId: 'demo-premium-watch' });
const db = getFirestore();

const api = createApi({
  db,
  ownerUid: 'owner',
  verifyToken: async (t) => {
    if (t === 'expired') throw new Error('expired');
    return t; // the test token is the uid
  },
  publicConfig: { firebase: { apiKey: 'k', authDomain: 'd', projectId: 'demo-premium-watch' }, emulators: true },
  now: () => new Date('2026-10-22T10:00:00Z'),
});

const call = (method: string, path: string, opts: { token?: string; json?: unknown; text?: string } = {}) =>
  api.request(path, {
    method,
    headers: {
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.json !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(opts.json !== undefined ? { body: JSON.stringify(opts.json) } : opts.text !== undefined ? { body: opts.text } : {}),
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

const company = { id: 'mstr', name: 'Strategy', ticker: 'MSTR', exchange: 'NASDAQ', currency: 'USD', asset: 'BTC' };

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error('run under the Firestore emulator');
  await fetch(`http://${host}/emulator/v1/projects/demo-premium-watch/databases/(default)/documents`, { method: 'DELETE' });
});

describe('auth', () => {
  it('public config needs no auth', async () => expect((await call('GET', '/config')).status).toBe(200));
  it('rejects missing, invalid and non-owner tokens', async () => {
    expect((await call('GET', '/me')).status).toBe(401);
    expect((await call('GET', '/me', { token: 'expired' })).status).toBe(401);
    expect((await call('POST', '/admin/companies', { token: 'intruder', json: company })).status).toBe(403);
    expect((await call('GET', '/me', { token: 'owner' })).status).toBe(200);
  });
});

describe('companies', () => {
  it('creates, refuses duplicates and edits', async () => {
    expect((await call('POST', '/admin/companies', { token: 'owner', json: company })).status).toBe(201);
    expect((await call('POST', '/admin/companies', { token: 'owner', json: company })).status).toBe(409);
    const r = await call('PUT', '/admin/companies/mstr', { token: 'owner', json: { ...company, active: false } });
    expect(r.status).toBe(200);
    expect((await db.doc('companies/mstr').get()).data()).toMatchObject({ name: 'Strategy', active: false });
  });
  it('validates', async () => {
    const r = await call('POST', '/admin/companies', { token: 'owner', json: { ...company, exchange: 'LSE' } });
    expect(r.status).toBe(400);
    expect((await json(r)).errors[0]).toMatch(/exchange/);
  });
});

describe('ledger', () => {
  beforeEach(async () => {
    await call('POST', '/admin/companies', { token: 'owner', json: company });
  });
  const row = { companyId: 'mstr', effectiveDate: '2026-10-20', type: 'holdings', value: 640031, sourceUrl: 'https://www.strategy.com/press' };

  it('adds an entry with createdAt and requires a source URL', async () => {
    const r = await call('POST', '/admin/ledger', { token: 'owner', json: row });
    expect(r.status).toBe(201);
    const { id } = await json(r);
    expect((await db.doc(`ledger/${id}`).get()).data()).toMatchObject({ ...row, createdAt: '2026-10-22T10:00:00.000Z' });
    expect((await call('POST', '/admin/ledger', { token: 'owner', json: { ...row, sourceUrl: '' } })).status).toBe(400);
    expect((await call('POST', '/admin/ledger', { token: 'owner', json: { ...row, companyId: 'nope' } })).status).toBe(400);
  });

  it('CSV import is all-or-nothing, with a dry run', async () => {
    const good = 'companyId,effectiveDate,type,value,sourceUrl,note\nmstr,2026-01-01,holdings,1000,https://x.com/a,\nmstr,2026-01-01,shares_diluted,5000,https://x.com/a,ok\n';
    const dry = await call('POST', '/admin/ledger/import?dryRun=1', { token: 'owner', text: good });
    expect(await json(dry)).toMatchObject({ valid: 2, imported: 0, dryRun: true });
    expect((await db.collection('ledger').get()).size).toBe(0);

    const badCsv = good + 'upxi,2026-01-01,holdings,1,https://x.com/a,\n';
    const bad = await call('POST', '/admin/ledger/import', { token: 'owner', text: badCsv });
    expect(bad.status).toBe(400);
    expect((await json(bad)).errors).toEqual([{ line: 4, errors: ['unknown company upxi'] }]);
    expect((await db.collection('ledger').get()).size).toBe(0);

    const ok = await call('POST', '/admin/ledger/import', { token: 'owner', text: good });
    expect(ok.status).toBe(201);
    expect((await db.collection('ledger').get()).size).toBe(2);
  });

  it('deletes an entry', async () => {
    const { id } = await json(await call('POST', '/admin/ledger', { token: 'owner', json: row }));
    expect((await call('DELETE', `/admin/ledger/${id}`, { token: 'owner' })).status).toBe(204);
    expect((await call('DELETE', `/admin/ledger/${id}`, { token: 'owner' })).status).toBe(404);
  });
});

describe('alerts', () => {
  it('creates, edits (re-arms) and deletes', async () => {
    await call('POST', '/admin/companies', { token: 'owner', json: company });
    const r = await call('POST', '/admin/alerts', { token: 'owner', json: { companyId: 'mstr', rule: 'mnav_below', params: { variant: 'diluted', threshold: 1 } } });
    expect(r.status).toBe(201);
    const { id } = await json(r);
    await db.doc(`alerts/${id}`).update({ active: true });
    await call('PUT', `/admin/alerts/${id}`, { token: 'owner', json: { companyId: 'mstr', rule: 'mnav_below', params: { variant: 'ev', threshold: 1.2 }, enabled: false } });
    expect((await db.doc(`alerts/${id}`).get()).data()).toMatchObject({ active: false, enabled: false, params: { variant: 'ev', threshold: 1.2 } });
    expect((await call('DELETE', `/admin/alerts/${id}`, { token: 'owner' })).status).toBe(204);
  });
});
