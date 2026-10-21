import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, collection, setDoc, deleteDoc } from 'firebase/firestore';

const OWNER = 'owner-uid-for-emulator';
let env: RulesTestEnvironment;

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-premium-watch',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: host!, port: Number(port) },
  });
});
afterAll(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'companies/mstr'), { name: 'Strategy' });
    await setDoc(doc(db, 'snapshots/mstr_2026-10-21'), { companyId: 'mstr', final: true });
  });
});

const COLLECTIONS = ['companies', 'ledger', 'snapshots', 'alerts', 'alertEvents'];

describe('owner', () => {
  it('can read every collection', async () => {
    const db = env.authenticatedContext(OWNER).firestore();
    await assertSucceeds(getDoc(doc(db, 'companies/mstr')));
    for (const c of COLLECTIONS) await assertSucceeds(getDocs(collection(db, c)));
  });
  it('cannot write from the client (writes go through the admin API)', async () => {
    const db = env.authenticatedContext(OWNER).firestore();
    await assertFails(setDoc(doc(db, 'snapshots/mstr_2026-10-21'), { final: false }));
    await assertFails(setDoc(doc(db, 'ledger/x'), { value: 1 }));
    await assertFails(deleteDoc(doc(db, 'companies/mstr')));
  });
});

describe('anyone else', () => {
  it('another signed-in user can read nothing', async () => {
    const db = env.authenticatedContext('someone-else').firestore();
    for (const c of COLLECTIONS) await assertFails(getDocs(collection(db, c)));
    await assertFails(getDoc(doc(db, 'companies/mstr')));
    await assertFails(setDoc(doc(db, 'companies/evil'), { name: 'x' }));
  });
  it('unauthenticated can read or write nothing', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'snapshots/mstr_2026-10-21')));
    await assertFails(setDoc(doc(db, 'alerts/a'), { enabled: true }));
  });
  it('unknown collections are covered too', async () => {
    await assertFails(getDoc(doc(env.authenticatedContext('x').firestore(), 'whatever/doc')));
  });
});
