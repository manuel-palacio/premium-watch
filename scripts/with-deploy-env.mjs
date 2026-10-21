// Run a command with config/deploy.env loaded, against the real project (for `npm run backfill`).
// Secrets come from Secret Manager via gcloud, so they never sit in a file.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('config/deploy.env', 'utf8').split('\n').filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const secret = (name) => {
  try {
    return execFileSync('gcloud', ['secrets', 'versions', 'access', 'latest', `--secret=${name}`, `--project=${env.PROJECT_ID}`], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};
const childEnv = { ...process.env, ...env, GOOGLE_CLOUD_PROJECT: env.PROJECT_ID, SPOT_PROVIDER: 'coingecko', EODHD_API_KEY: secret('eodhd-api-key') };
const [cmd, ...args] = process.argv.slice(2);
process.exit(spawnSync(cmd, args, { stdio: 'inherit', env: childEnv }).status ?? 1);
