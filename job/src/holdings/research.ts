import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Company, LedgerEntry } from '@pw/shared';
import type { HoldingsProposal } from './check.ts';

const run = promisify(execFile);

const SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean', description: 'true only if a newer official total was found' },
    holdings: { type: 'number', description: 'total coins held, as a plain number' },
    effectiveDate: { type: 'string', description: 'YYYY-MM-DD the total is stated as of' },
    sourceUrl: { type: 'string', description: 'URL of the document that states the total' },
    evidence: { type: 'string', description: 'the sentence from the source that states the total, verbatim' },
    note: { type: 'string', description: 'short note, e.g. "8-K 2026-10-27: +390 BTC"' },
  },
  required: ['found'],
  additionalProperties: false,
} as const;

export interface ResearchInput {
  company: Company;
  current: LedgerEntry | undefined;
  domains: string[];
  hints: string[];
  today: string;
}

export function researchPrompt({ company: c, current, domains, hints, today }: ResearchInput): string {
  return [
    `Today is ${today}. Find the latest officially disclosed total ${c.asset} holdings of ${c.name} (${c.exchange}: ${c.ticker}).`,
    current
      ? `Our ledger has ${current.value} ${c.asset} as of ${current.effectiveDate} (source: ${current.sourceUrl}). Look for a total stated as of a LATER date.`
      : 'Our ledger has no holdings for this company yet.',
    `Use only primary sources on these domains: ${domains.join(', ')}. Start from: ${hints.length ? hints.join(' , ') : 'the company filings on these domains'}.`,
    'Rules:',
    '- Report the TOTAL held as stated by the company (not a purchase amount, not an aggregator estimate). Include staked or locked coins if the company counts them in its total.',
    '- effectiveDate is the "as of" date of that total, not the filing date.',
    '- sourceUrl must be the document whose text contains the number (for SEC, the 8-K or exhibit .htm, not the filing index).',
    '- evidence is the sentence containing the number, copied verbatim.',
    `- If nothing newer than ${current?.effectiveDate ?? 'the ledger'} is disclosed, return found=false with a short note on what you checked.`,
  ].join('\n');
}

/** Runs one headless Claude Code research pass, limited to web search and fetch. */
export async function research(input: ResearchInput, env: NodeJS.ProcessEnv = process.env): Promise<HoldingsProposal> {
  const childEnv = { ...env };
  delete childEnv.ANTHROPIC_API_KEY; // use the subscription login
  const args = [
    '-p',
    researchPrompt(input),
    '--model',
    env.HOLDINGS_MODEL ?? 'sonnet',
    '--tools',
    'WebSearch,WebFetch',
    '--allowedTools',
    'WebSearch,WebFetch',
    '--permission-mode',
    'dontAsk',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(SCHEMA),
  ];
  const { stdout } = await run(env.CLAUDE_BIN ?? 'claude', args, { env: childEnv, timeout: 15 * 60_000, maxBuffer: 32 * 1024 * 1024 });
  const out = JSON.parse(stdout) as { is_error?: boolean; result?: string; structured_output?: HoldingsProposal };
  if (out.is_error || !out.structured_output) throw new Error(`research failed: ${out.result ?? 'no structured output'}`);
  return out.structured_output;
}
