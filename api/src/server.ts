import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { createApi } from './app.ts';

const env = process.env;
const projectId = env.GOOGLE_CLOUD_PROJECT ?? env.FIREBASE_PROJECT_ID ?? 'demo-premium-watch';
const emulators = Boolean(env.FIRESTORE_EMULATOR_HOST);

initializeApp({ projectId });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
const auth = getAuth();

if (!env.OWNER_UID) console.warn('OWNER_UID is not set: every admin request will be refused');

const api = createApi({
  db,
  ownerUid: env.OWNER_UID ?? '',
  verifyToken: async (token) => (await auth.verifyIdToken(token, true)).uid,
  publicConfig: {
    firebase: {
      apiKey: env.FIREBASE_API_KEY ?? 'demo-key',
      authDomain: env.FIREBASE_AUTH_DOMAIN ?? `${projectId}.firebaseapp.com`,
      projectId,
      ...(env.FIREBASE_APP_ID ? { appId: env.FIREBASE_APP_ID } : {}),
    },
    emulators,
  },
});

const app = new Hono();
app.use(
  '*',
  secureHeaders({
    // signInWithPopup needs the opener to stay reachable from the popup.
    crossOriginOpenerPolicy: 'same-origin-allow-popups',
    contentSecurityPolicy: undefined,
  }),
);
app.route('/api', api);

const staticRoot = env.STATIC_DIR ?? './public';
app.use('/assets/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'public, max-age=31536000, immutable');
});
app.use('*', serveStatic({ root: staticRoot }));
// SPA fallback (the app uses hash routes, but keep deep links working).
app.get('*', serveStatic({ root: staticRoot, path: 'index.html' }));

const port = Number(env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`api listening on :${port} (project ${projectId}${emulators ? ', emulators' : ''})`));
