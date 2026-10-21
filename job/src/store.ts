import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { Alert, AlertEvent, Company, IsoDate, IsoTimestamp, LedgerEntry, Snapshot } from '@pw/shared';

export interface Store {
  listCompanies(): Promise<Company[]>;
  ledgerFor(companyId: string): Promise<LedgerEntry[]>;
  getSnapshots(ids: string[]): Promise<Map<string, Snapshot>>;
  putSnapshots(snaps: Snapshot[]): Promise<void>;
  snapshotsSince(companyId: string, from: IsoDate): Promise<Snapshot[]>;
  alertsFor(companyId: string): Promise<Alert[]>;
  setAlertState(id: string, active: boolean, activeSince: IsoTimestamp | null): Promise<void>;
  addAlertEvent(e: Omit<AlertEvent, 'id'>): Promise<string>;
}

export function firestore(): Firestore {
  if (!getApps().length) initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? 'demo-premium-watch' });
  const db = getFirestore();
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {
    // settings() can only be called once per instance
  }
  return db;
}

const withId = <T>(d: FirebaseFirestore.DocumentSnapshot): T => ({ ...(d.data() as object), id: d.id }) as T;

export class FirestoreStore implements Store {
  private readonly db: Firestore;
  constructor(db: Firestore = firestore()) {
    this.db = db;
  }

  async listCompanies(): Promise<Company[]> {
    return (await this.db.collection('companies').get()).docs.map((d) => withId<Company>(d));
  }
  async ledgerFor(companyId: string): Promise<LedgerEntry[]> {
    return (await this.db.collection('ledger').where('companyId', '==', companyId).get()).docs.map((d) => withId<LedgerEntry>(d));
  }
  async getSnapshots(ids: string[]): Promise<Map<string, Snapshot>> {
    const out = new Map<string, Snapshot>();
    if (!ids.length) return out;
    const docs = await this.db.getAll(...ids.map((id) => this.db.collection('snapshots').doc(id)));
    for (const d of docs) if (d.exists) out.set(d.id, withId<Snapshot>(d));
    return out;
  }
  async putSnapshots(snaps: Snapshot[]): Promise<void> {
    for (let i = 0; i < snaps.length; i += 400) {
      const batch = this.db.batch();
      for (const s of snaps.slice(i, i + 400)) batch.set(this.db.collection('snapshots').doc(s.id), s);
      await batch.commit();
    }
  }
  async snapshotsSince(companyId: string, from: IsoDate): Promise<Snapshot[]> {
    const q = this.db.collection('snapshots').where('companyId', '==', companyId).where('date', '>=', from).orderBy('date');
    return (await q.get()).docs.map((d) => withId<Snapshot>(d));
  }
  async alertsFor(companyId: string): Promise<Alert[]> {
    return (await this.db.collection('alerts').where('companyId', '==', companyId).get()).docs.map((d) => withId<Alert>(d));
  }
  async setAlertState(id: string, active: boolean, activeSince: IsoTimestamp | null): Promise<void> {
    await this.db.collection('alerts').doc(id).update({ active, activeSince });
  }
  async addAlertEvent(e: Omit<AlertEvent, 'id'>): Promise<string> {
    return (await this.db.collection('alertEvents').add(e)).id;
  }
}

/** In-memory store for unit tests. */
export class MemoryStore implements Store {
  companies: Company[] = [];
  ledger: LedgerEntry[] = [];
  snapshots = new Map<string, Snapshot>();
  alerts: Alert[] = [];
  events: AlertEvent[] = [];
  writes = 0;

  async listCompanies() {
    return structuredClone(this.companies);
  }
  async ledgerFor(companyId: string) {
    return structuredClone(this.ledger.filter((e) => e.companyId === companyId));
  }
  async getSnapshots(ids: string[]) {
    return new Map(ids.filter((id) => this.snapshots.has(id)).map((id) => [id, structuredClone(this.snapshots.get(id)!)]));
  }
  async putSnapshots(snaps: Snapshot[]) {
    for (const s of snaps) this.snapshots.set(s.id, structuredClone(s));
    this.writes += snaps.length;
  }
  async snapshotsSince(companyId: string, from: IsoDate) {
    return [...this.snapshots.values()].filter((s) => s.companyId === companyId && s.date >= from).sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  async alertsFor(companyId: string) {
    return structuredClone(this.alerts.filter((a) => a.companyId === companyId));
  }
  async setAlertState(id: string, active: boolean, activeSince: IsoTimestamp | null) {
    const a = this.alerts.find((x) => x.id === id);
    if (a) Object.assign(a, { active, activeSince });
  }
  async addAlertEvent(e: Omit<AlertEvent, 'id'>) {
    const id = `ev${this.events.length + 1}`;
    this.events.push({ ...e, id });
    return id;
  }
}
