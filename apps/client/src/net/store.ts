import { asOp, generateIdentityKeys, identityFromKeys, opKey, type Identity, type Op } from '@terra/shared';

const DB = 'terra-ignota';
// Version 2: ops became layered (protocol 10), and worlds were wiped with them.
const VERSION = 2;
const KEYS = 'keys';
const OPS = 'ops';

/**
 * Per-device storage in IndexedDB: the Ed25519 identity (the private key is
 * stored as a non-extractable CryptoKey) and every edit op this device has
 * seen, per world. Falls back to memory if IndexedDB is unavailable.
 */
export class Store {
  private readonly db: IDBDatabase | null;

  private constructor(db: IDBDatabase | null) {
    this.db = db;
  }

  static async open(): Promise<Store> {
    try {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DB, VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          // The identity is kept across versions. Ops in an older format are dropped.
          if (!db.objectStoreNames.contains(KEYS)) db.createObjectStore(KEYS);
          if (db.objectStoreNames.contains(OPS)) db.deleteObjectStore(OPS);
          db.createObjectStore(OPS);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return new Store(db);
    } catch (err) {
      console.warn('IndexedDB unavailable; edits and identity will not persist', err);
      return new Store(null);
    }
  }

  /** This device's identity, created on first use. */
  async identity(): Promise<Identity> {
    let keys = (await this.get(KEYS, 'identity')) as CryptoKeyPair | undefined;
    if (!keys) {
      keys = await generateIdentityKeys();
      await this.put(KEYS, 'identity', keys);
    }
    return identityFromKeys(keys);
  }

  /** Every op stored for a world. */
  async loadOps(world: string): Promise<Op[]> {
    if (!this.db) return [];
    const range = IDBKeyRange.bound(`${world}|`, `${world}|￿`);
    return new Promise((resolve) => {
      const req = this.db!.transaction(OPS).objectStore(OPS).getAll(range);
      req.onsuccess = () => resolve((req.result as unknown[]).map(asOp).filter((op): op is Op => op !== null));
      req.onerror = () => resolve([]);
    });
  }

  /** Store the op that stands at its key (replacing the one it beat). */
  saveOp(world: string, op: Op): void {
    void this.put(OPS, `${world}|${opKey(op)}`, op);
  }

  /** Forget the op stored at this op's key: it expired, or the host refused it. */
  deleteOp(world: string, op: Op): void {
    if (!this.db) return;
    try {
      this.db.transaction(OPS, 'readwrite').objectStore(OPS).delete(`${world}|${opKey(op)}`);
    } catch {
      // The database is closing. An expired op left behind is dropped the next time it is loaded.
    }
  }

  private get(store: string, key: string): Promise<unknown> {
    if (!this.db) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      const req = this.db!.transaction(store).objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    });
  }

  private put(store: string, key: string, value: unknown): Promise<void> {
    if (!this.db) return Promise.resolve();
    return new Promise((resolve) => {
      const tx = this.db!.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
}
