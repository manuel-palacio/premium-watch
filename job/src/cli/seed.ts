import { parseArgs } from 'node:util';
import type { Company } from '@pw/shared';
import { getAuth } from 'firebase-admin/auth';
import { firestore } from '../store.ts';

/**
 * Seed the companies collection (skips ones that exist).
 * `--demo` also writes a small made-up ledger for local development against the emulator;
 * it refuses to run outside the emulator.
 */
const { values } = parseArgs({ options: { demo: { type: 'boolean', default: false } } });

export const SEED_COMPANIES: Company[] = [
  { id: 'mstr', name: 'Strategy', ticker: 'MSTR', exchange: 'NASDAQ', currency: 'USD', asset: 'BTC', active: true },
  { id: 'metaplanet', name: 'Metaplanet', ticker: '3350', exchange: 'TSE', currency: 'JPY', asset: 'BTC', active: true },
  { id: 'upxi', name: 'Upexi', ticker: 'UPXI', exchange: 'NASDAQ', currency: 'USD', asset: 'SOL', active: true },
  { id: 'dfdv', name: 'DeFi Development', ticker: 'DFDV', exchange: 'NASDAQ', currency: 'USD', asset: 'SOL', active: true },
];

// Round, invented numbers so the UI has something to draw. NOT real holdings.
const DEMO: Record<string, [string, number, number, number, number, number][]> = {
  //            date        holdings   basic          diluted        debt     cash
  mstr: [
    ['2025-01-01', 450_000, 220_000_000, 260_000_000, 7e9, 0.1e9],
    ['2025-07-01', 600_000, 260_000_000, 300_000_000, 8e9, 0.1e9],
    ['2026-03-01', 650_000, 280_000_000, 330_000_000, 8.2e9, 0.2e9],
  ],
  metaplanet: [
    ['2025-01-01', 1_800, 600_000_000, 700_000_000, 5e9, 1e9],
    ['2025-07-01', 15_000, 650_000_000, 900_000_000, 20e9, 3e9],
    ['2026-03-01', 30_000, 1_100_000_000, 1_400_000_000, 40e9, 5e9],
  ],
  upxi: [
    ['2025-05-01', 700_000, 40_000_000, 60_000_000, 0.15e9, 0.01e9],
    ['2025-12-01', 2_000_000, 60_000_000, 90_000_000, 0.2e9, 0.02e9],
  ],
  dfdv: [
    ['2025-05-01', 600_000, 20_000_000, 30_000_000, 0.1e9, 0.01e9],
    ['2025-12-01', 2_100_000, 28_000_000, 40_000_000, 0.2e9, 0.02e9],
  ],
};

const db = firestore();
let added = 0;
for (const c of SEED_COMPANIES) {
  const ref = db.collection('companies').doc(c.id);
  if ((await ref.get()).exists) continue;
  const { id: _id, ...data } = c;
  await ref.set(data);
  added++;
}
console.log(`companies: ${added} added, ${SEED_COMPANIES.length - added} already present`);

if (values.demo) {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    console.error('--demo only runs against the emulator (FIRESTORE_EMULATOR_HOST is not set)');
    process.exit(2);
  }
  const batch = db.batch();
  let n = 0;
  for (const [companyId, rows] of Object.entries(DEMO)) {
    for (const [effectiveDate, holdings, basic, diluted, debt, cash] of rows) {
      const vals = { holdings, shares_basic: basic, shares_diluted: diluted, debt, cash };
      for (const [type, value] of Object.entries(vals)) {
        const id = `demo-${companyId}-${effectiveDate}-${type}`;
        batch.set(db.collection('ledger').doc(id), {
          companyId,
          effectiveDate,
          type,
          value,
          sourceUrl: 'https://example.com/demo-data',
          note: 'demo data, not real',
          createdAt: `${effectiveDate}T00:00:00.000Z`,
        });
        n++;
      }
    }
  }
  await batch.commit();
  console.log(`demo ledger: ${n} entries written`);

  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    // A Google-linked owner account, so the emulator's sign-in popup offers it.
    const uid = 'owner-uid-for-emulator';
    const email = 'owner@example.com';
    const r = await getAuth().importUsers([{ uid, email, emailVerified: true, displayName: 'Dev Owner', providerData: [{ uid: 'dev-owner-google', providerId: 'google.com', email, displayName: 'Dev Owner' }] }]);
    console.log(r.failureCount ? `owner account: ${r.errors[0]?.error.message}` : `owner account ${email} (uid ${uid}) ready in the Auth emulator`);
  }
}
process.exit(0);
