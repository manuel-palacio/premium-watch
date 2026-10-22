// Writes firestore/firestore.rules from the template, with OWNER_UID from the env or config/deploy.env.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
const env = { ...(existsSync('config/deploy.env') ? parseEnv(readFileSync('config/deploy.env', 'utf8')) : {}), ...process.env };
const uid = env.OWNER_UID || 'owner-uid-for-emulator';
if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error(`OWNER_UID looks wrong: ${uid}`);
writeFileSync('firestore/firestore.rules', readFileSync('firestore/firestore.rules.tmpl', 'utf8').replace('__OWNER_UID__', uid));
console.log(`firestore.rules rendered for uid ${uid}`);
