import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Firestore } from 'firebase-admin/firestore';
import { COMPANY_ID_RE, parseLedgerCsv, validateAlert, validateCompany, validateLedgerEntry } from '@pw/shared';

export interface PublicConfig {
  firebase: { apiKey: string; authDomain: string; projectId: string; appId?: string };
  emulators: boolean;
}

export interface AppDeps {
  db: Firestore;
  /** Returns the uid for a valid Firebase ID token, or throws. */
  verifyToken: (token: string) => Promise<string>;
  ownerUid: string;
  publicConfig: PublicConfig;
  now?: () => Date;
}

type Env = { Variables: { uid: string } };

function bad(c: Context, errors: string[] | string, status: 400 | 404 | 409 = 400) {
  return c.json({ errors: Array.isArray(errors) ? errors : [errors] }, status);
}

async function body(c: Context): Promise<Record<string, unknown>> {
  try {
    return (await c.req.json()) as Record<string, unknown>;
  } catch {
    throw new HTTPException(400, { message: 'invalid JSON body' });
  }
}

export function createApi(deps: AppDeps): Hono<Env> {
  const { db } = deps;
  const now = () => (deps.now ?? (() => new Date()))().toISOString();
  const api = new Hono<Env>();

  api.get('/config', (c) => c.json(deps.publicConfig));
  api.get('/healthz', (c) => c.json({ ok: true }));

  const requireOwner: MiddlewareHandler<Env> = async (c, next) => {
    const m = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '');
    if (!m) return c.json({ errors: ['sign in required'] }, 401);
    let uid: string;
    try {
      uid = await deps.verifyToken(m[1]!);
    } catch {
      return c.json({ errors: ['invalid or expired token'] }, 401);
    }
    if (!deps.ownerUid || uid !== deps.ownerUid) return c.json({ errors: ['not allowed'] }, 403);
    c.set('uid', uid);
    await next();
  };
  api.use('/admin/*', requireOwner);
  api.use('/me', requireOwner);

  api.get('/me', (c) => c.json({ uid: c.get('uid'), owner: true }));

  const companyExists = async (id: string) => (await db.collection('companies').doc(id).get()).exists;

  // Companies
  api.post('/admin/companies', async (c) => {
    const r = validateCompany(await body(c));
    if (!r.ok) return bad(c, r.errors);
    const ref = db.collection('companies').doc(r.value.id);
    const { id, ...data } = r.value;
    try {
      await ref.create(data);
    } catch {
      return bad(c, `company ${id} already exists`, 409);
    }
    return c.json(r.value, 201);
  });

  api.put('/admin/companies/:id', async (c) => {
    const id = c.req.param('id');
    if (!COMPANY_ID_RE.test(id) || !(await companyExists(id))) return bad(c, 'no such company', 404);
    const r = validateCompany({ ...(await body(c)), id });
    if (!r.ok) return bad(c, r.errors);
    const { id: _id, ...data } = r.value;
    await db.collection('companies').doc(id).set(data);
    return c.json(r.value);
  });

  // Ledger
  api.post('/admin/ledger', async (c) => {
    const r = validateLedgerEntry(await body(c));
    if (!r.ok) return bad(c, r.errors);
    if (!(await companyExists(r.value.companyId))) return bad(c, `unknown company ${r.value.companyId}`);
    const ref = await db.collection('ledger').add({ ...r.value, createdAt: now() });
    return c.json({ id: ref.id, ...r.value }, 201);
  });

  api.delete('/admin/ledger/:id', async (c) => {
    const ref = db.collection('ledger').doc(c.req.param('id'));
    if (!(await ref.get()).exists) return bad(c, 'no such ledger entry', 404);
    await ref.delete();
    return c.body(null, 204);
  });

  /** CSV import. `?dryRun=1` validates without writing. All-or-nothing: any error writes nothing. */
  api.post('/admin/ledger/import', async (c) => {
    const text = await c.req.text();
    if (!text.trim()) return bad(c, 'empty CSV');
    if (text.length > 2_000_000) return bad(c, 'CSV larger than 2 MB');
    const parsed = parseLedgerCsv(text);
    const companies = new Set((await db.collection('companies').get()).docs.map((d) => d.id));
    const errors = [...parsed.errors];
    parsed.rows.forEach((row, i) => {
      if (!companies.has(row.companyId)) errors.push({ line: i + 2, errors: [`unknown company ${row.companyId}`] });
    });
    const dryRun = c.req.query('dryRun') === '1';
    if (errors.length || dryRun) {
      return c.json({ imported: 0, valid: parsed.rows.length, errors: errors.sort((a, b) => a.line - b.line), dryRun }, errors.length ? 400 : 200);
    }
    const createdAt = now();
    for (let i = 0; i < parsed.rows.length; i += 400) {
      const batch = db.batch();
      for (const row of parsed.rows.slice(i, i + 400)) batch.set(db.collection('ledger').doc(), { ...row, createdAt });
      await batch.commit();
    }
    return c.json({ imported: parsed.rows.length, errors: [] }, 201);
  });

  // Alerts
  api.post('/admin/alerts', async (c) => {
    const r = validateAlert(await body(c));
    if (!r.ok) return bad(c, r.errors);
    if (!(await companyExists(r.value.companyId))) return bad(c, `unknown company ${r.value.companyId}`);
    const ref = await db.collection('alerts').add({ ...r.value, active: false, activeSince: null });
    return c.json({ id: ref.id, ...r.value }, 201);
  });

  api.put('/admin/alerts/:id', async (c) => {
    const ref = db.collection('alerts').doc(c.req.param('id'));
    if (!(await ref.get()).exists) return bad(c, 'no such alert', 404);
    const r = validateAlert(await body(c));
    if (!r.ok) return bad(c, r.errors);
    // Changing a rule re-arms it.
    await ref.set({ ...r.value, active: false, activeSince: null });
    return c.json({ id: ref.id, ...r.value });
  });

  api.delete('/admin/alerts/:id', async (c) => {
    const ref = db.collection('alerts').doc(c.req.param('id'));
    if (!(await ref.get()).exists) return bad(c, 'no such alert', 404);
    await ref.delete();
    return c.body(null, 204);
  });

  api.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ errors: [err.message] }, err.status);
    console.error(err);
    return c.json({ errors: ['internal error'] }, 500);
  });

  return api;
}
