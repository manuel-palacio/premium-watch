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
  publicConfig: (host) => ({
    firebase: {
      apiKey: env.FIREBASE_API_KEY ?? 'demo-key',
      // Same-origin auth domain (proxied below) so sign-in works in Safari, which blocks
      // the third-party storage the default *.firebaseapp.com handler relies on.
      authDomain: env.FIREBASE_AUTH_DOMAIN || (emulators ? `${projectId}.firebaseapp.com` : host),
      projectId,
      ...(env.FIREBASE_APP_ID ? { appId: env.FIREBASE_APP_ID } : {}),
    },
    emulators,
  }),
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

// Proxy Firebase's auth handler: https://firebase.google.com/docs/auth/web/redirect-best-practices
const firebaseHost = `${projectId}.firebaseapp.com`;
app.all('/__/*', async (c) => {
  const url = new URL(c.req.url);
  const upstream = await fetch(`https://${firebaseHost}${url.pathname}${url.search}`, {
    method: c.req.method,
    headers: { accept: c.req.header('accept') ?? '*/*', 'content-type': c.req.header('content-type') ?? '' },
    ...(c.req.method === 'GET' || c.req.method === 'HEAD' ? {} : { body: await c.req.arrayBuffer() }),
    redirect: 'manual',
  });
  const headers = new Headers(upstream.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  return new Response(upstream.body, { status: upstream.status, headers });
});

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
