import { initializeApp, type FirebaseApp } from 'firebase/app';
import { GoogleAuthProvider, connectAuthEmulator, getAuth, onAuthStateChanged, signInWithPopup, signOut, type Auth, type User } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';

interface PublicConfig {
  firebase: { apiKey: string; authDomain: string; projectId: string; appId?: string };
  emulators: boolean;
}

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;

/** Firebase config comes from the API at runtime, so one image works for any project. */
export async function initFirebase(): Promise<void> {
  const res = await fetch('/api/config');
  if (!res.ok) throw new Error(`could not load /api/config (${res.status})`);
  const cfg = (await res.json()) as PublicConfig;
  app = initializeApp(cfg.firebase);
  auth = getAuth(app);
  db = getFirestore(app);
  if (cfg.emulators) {
    const host = location.hostname;
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, host, 8080);
  }
}

export const firestore = () => db;
export const currentUser = () => auth.currentUser;

export function watchUser(cb: (u: User | null) => void): void {
  onAuthStateChanged(auth, cb);
}

export async function signIn(): Promise<void> {
  await signInWithPopup(auth, new GoogleAuthProvider());
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

export async function idToken(): Promise<string> {
  const u = auth.currentUser;
  if (!u) throw new Error('not signed in');
  return u.getIdToken();
}
