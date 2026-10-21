import { notifierFromEnv } from './notify.ts';
import { RoutedMarketData, spotFromEnv } from './providers/index.ts';
import type { Deps } from './run.ts';
import { FirestoreStore } from './store.ts';

export function depsFromEnv(env: NodeJS.ProcessEnv = process.env, now = new Date()): Deps {
  return {
    store: new FirestoreStore(),
    market: RoutedMarketData.fromEnv(env),
    spot: spotFromEnv(env),
    notifier: notifierFromEnv(env),
    now,
    appUrl: env.APP_URL ?? 'http://localhost:5173',
    log: (m) => console.log(m),
  };
}
