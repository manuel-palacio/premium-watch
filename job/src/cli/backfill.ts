import { parseArgs } from 'node:util';
import { isIsoDate } from '@pw/shared';
import { backfill } from '../backfill.ts';
import { depsFromEnv } from '../deps.ts';

const { values } = parseArgs({
  options: {
    from: { type: 'string' },
    to: { type: 'string', default: new Date().toISOString().slice(0, 10) },
    company: { type: 'string', multiple: true },
    force: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
});

if (!values.from || !isIsoDate(values.from) || !isIsoDate(values.to!)) {
  console.error('usage: npm run backfill -- --from YYYY-MM-DD [--to YYYY-MM-DD] [--company mstr ...] [--force] [--dry-run]');
  process.exit(2);
}

const deps = depsFromEnv();
console.log(`backfill ${values.from}..${values.to} via ${deps.market.name}`);
const r = await backfill({ from: values.from, to: values.to!, ...(values.company ? { companyIds: values.company } : {}), force: values.force!, dryRun: values['dry-run']! }, deps);
console.log(`done: ${r.written} written, ${r.skipped} final kept (use --force to rebuild), ${r.stale} stale`);
process.exit(0);
