import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parseLedgerCsv } from '@pw/shared';
import { firestore } from '../store.ts';

/**
 * Import a ledger CSV (same format and checks as Admin > CSV import), all-or-nothing.
 *   npm run import-ledger -- file.csv [--dry-run]
 */
const { values, positionals } = parseArgs({ allowPositionals: true, options: { 'dry-run': { type: 'boolean', default: false } } });
const file = positionals[0];
if (!file) {
  console.error('usage: npm run import-ledger -- file.csv [--dry-run]');
  process.exit(2);
}

const parsed = parseLedgerCsv(readFileSync(file, 'utf8'));
if (parsed.errors.length) {
  for (const e of parsed.errors) console.error(`line ${e.line}: ${e.errors.join('; ')}`);
  process.exit(1);
}

const db = firestore();
const known = new Set((await db.collection('companies').get()).docs.map((d) => d.id));
const unknown = [...new Set(parsed.rows.map((r) => r.companyId))].filter((id) => !known.has(id));
if (unknown.length) {
  console.error(`unknown companies: ${unknown.join(', ')}`);
  process.exit(1);
}

if (values['dry-run']) {
  console.log(`${parsed.rows.length} rows valid (dry run, nothing written)`);
  process.exit(0);
}

const createdAt = new Date().toISOString();
const batch = db.batch();
for (const row of parsed.rows) batch.set(db.collection('ledger').doc(), { ...row, createdAt });
await batch.commit();
console.log(`${parsed.rows.length} ledger entries written`);
process.exit(0);
