import { parseArgs } from 'node:util';
import { MARKET_GROUPS, type MarketGroup } from '@pw/shared';
import { depsFromEnv } from './deps.ts';
import { runClose, runIntraday } from './run.ts';

/**
 * Cloud Run job entry point.
 *   node main.js --mode close --market us|tokyo|all
 *   node main.js --mode intraday --market us|tokyo   (no-op unless INTRADAY_ENABLED=true)
 */
const { values } = parseArgs({
  options: {
    mode: { type: 'string', default: process.env.JOB_MODE ?? 'close' },
    market: { type: 'string', default: process.env.JOB_MARKET ?? 'all' },
  },
});

const market = values.market as MarketGroup | 'all';
if (market !== 'all' && !(market in MARKET_GROUPS)) {
  console.error(`--market must be one of: all, ${Object.keys(MARKET_GROUPS).join(', ')}`);
  process.exit(2);
}

const deps = depsFromEnv();
const started = Date.now();
let summary;
if (values.mode === 'close') {
  summary = await runClose(market, deps);
} else if (values.mode === 'intraday') {
  if (process.env.INTRADAY_ENABLED !== 'true') {
    console.log('intraday mode is disabled (INTRADAY_ENABLED != true); nothing to do');
    process.exit(0);
  }
  summary = await runIntraday(market, deps);
} else {
  console.error('--mode must be close or intraday');
  process.exit(2);
}

// One JSON line, so Cloud Logging indexes the fields.
console.log(JSON.stringify({ severity: summary.errors.length ? 'ERROR' : 'INFO', message: `${values.mode} run for ${market}`, ms: Date.now() - started, ...summary }));
process.exit(summary.errors.length ? 1 : 0);
