// Writes firestore/firestore.rules from the template, with OWNER_UID from the env or config/deploy.env.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const env = { ...(existsSync('config/deploy.env') ? Object.fromEntries(readFileSync('config/deploy.env', 'utf8').split('\n').filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')])) : {}), ...process.env };
const uid = env.OWNER_UID || 'owner-uid-for-emulator';
if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error(`OWNER_UID looks wrong: ${uid}`);
writeFileSync('firestore/firestore.rules', readFileSync('firestore/firestore.rules.tmpl', 'utf8').replace('__OWNER_UID__', uid));
console.log(`firestore.rules rendered for uid ${uid}`);
