import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import Papa from 'papaparse';
import { validateLedgerEntry, type Company, type LedgerEntry } from '@pw/shared';
import { backfill } from '../backfill.ts';
import { depsFromEnv } from '../deps.ts';
import { checkProposal, latestHoldings, numberAppears, type CheckResult, type HoldingsProposal } from '../holdings/check.ts';
import { research } from '../holdings/research.ts';
import { sourceText } from '../holdings/source.ts';
import { firestore } from '../store.ts';

/**
 * Looks for newer holdings disclosures and adds them to the ledger.
 *   npm run update-holdings -- [--company mstr ...] [--dry-run]
 *
 * For each active company a headless Claude Code run (web search and fetch only) proposes the
 * latest stated total. A proposal is written only if it passes checkProposal() AND the number
 * appears in the source document, fetched here independently. Everything else is reported for
 * review. Accepted entries are saved to data/ledger/auto-<date>.csv and the company's
 * snapshots are rebuilt from the new effective date.
 */
const { values } = parseArgs({ options: { company: { type: 'string', multiple: true }, 'dry-run': { type: 'boolean', default: false } } });
const dryRun = values['dry-run']!;
const today = new Date().toISOString().slice(0, 10);
// npm runs workspace scripts from job/; paths are relative to the repo root.
const root = new URL('../../../', import.meta.url);
const path = (p: string) => fileURLToPath(new URL(p, root));

type SourceConfig = Record<string, { domains: string[]; hints: string[] }>;
const sources = JSON.parse(readFileSync(path('config/holdings-sources.json'), 'utf8')) as SourceConfig;
const sourcesFor = (id: string) => sources[id] ?? sources.default ?? { domains: ['sec.gov'], hints: [] };

const deps = depsFromEnv();
const companies = (await deps.store.listCompanies()).filter((c) => (values.company?.length ? values.company.includes(c.id) : c.active));

interface Outcome {
  company: Company;
  current: LedgerEntry | undefined;
  proposal?: HoldingsProposal;
  result: CheckResult | { status: 'error'; reason: string };
}

async function evaluate(company: Company): Promise<Outcome> {
  const current = latestHoldings(await deps.store.ledgerFor(company.id));
  const { domains, hints } = sourcesFor(company.id);
  let proposal: HoldingsProposal;
  try {
    proposal = await research({ company, current, domains, hints, today });
  } catch (e) {
    return { company, current, result: { status: 'error', reason: (e as Error).message.slice(0, 300) } };
  }
  const result = checkProposal(proposal, { current, allowedDomains: domains, today });
  if (result.status !== 'accept') return { company, current, proposal, result };
  try {
    const text = await sourceText(proposal.sourceUrl!);
    if (!numberAppears(text, proposal.holdings!)) return { company, current, proposal, result: { status: 'review', reason: `${proposal.holdings} not found in ${proposal.sourceUrl}` } };
  } catch (e) {
    return { company, current, proposal, result: { status: 'review', reason: `could not read the source: ${(e as Error).message}` } };
  }
  return { company, current, proposal, result };
}

// One company at a time: each research run is a full agent session.
const outcomes: Outcome[] = [];
for (const c of companies) outcomes.push(await evaluate(c));

const accepted = outcomes.filter((o) => o.result.status === 'accept');
if (accepted.length && !dryRun) {
  const db = firestore();
  const createdAt = new Date().toISOString();
  const rows = accepted.map((o) => {
    const p = o.proposal!;
    const v = validateLedgerEntry({ companyId: o.company.id, effectiveDate: p.effectiveDate, type: 'holdings', value: p.holdings, sourceUrl: p.sourceUrl, note: `auto: ${p.note ?? p.evidence ?? ''}`.slice(0, 300) });
    if (!v.ok) throw new Error(`${o.company.id}: ${v.errors.join('; ')}`);
    return v.value;
  });
  const batch = db.batch();
  for (const row of rows) batch.set(db.collection('ledger').doc(), { ...row, createdAt });
  await batch.commit();

  mkdirSync(path('data/ledger'), { recursive: true });
  const file = path(`data/ledger/auto-${today}.csv`);
  const csv = Papa.unparse(rows, { columns: ['companyId', 'effectiveDate', 'type', 'value', 'sourceUrl', 'note'], header: !existsSync(file) });
  appendFileSync(file, `${csv}\n`);

  for (const row of rows) {
    const r = await backfill({ from: row.effectiveDate, to: today, companyIds: [row.companyId], force: true }, deps);
    console.log(`${row.companyId}: rebuilt ${r.written} snapshot(s) from ${row.effectiveDate}, ${r.stale} stale`);
  }
}

// Summary: a few plain lines, piped to Telegram by ops/update-holdings.sh.
const fmt = (n: number | undefined) => (n === undefined ? '?' : n.toLocaleString('en-US'));
console.log(`holdings update ${today}${dryRun ? ' (dry run)' : ''}: ${accepted.length} added, ${outcomes.filter((o) => o.result.status === 'review').length} to review, ${outcomes.filter((o) => o.result.status === 'error').length} errors`);
for (const o of outcomes) {
  const { company: c, current: cur, proposal: p, result: r } = o;
  if (r.status === 'accept') console.log(`+ ${c.name}: ${fmt(cur?.value)} → ${fmt(p!.holdings)} ${c.asset} as of ${p!.effectiveDate} (${p!.sourceUrl})`);
  else if (r.status === 'none') console.log(`= ${c.name}: ${r.reason}`);
  else console.log(`! ${c.name}: ${r.status}: ${r.reason}${p?.holdings ? ` [proposed ${fmt(p.holdings)} as of ${p.effectiveDate}, ${p.sourceUrl}]` : ''}`);
}
process.exit(outcomes.some((o) => o.result.status === 'error') ? 1 : 0);
