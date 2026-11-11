import { generateIdentityKeys, identityFromKeys, type Identity, type TileOp } from '@terra/shared';

const DB = 'terra-ignota';
const VERSION = 1;
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
          req.result.createObjectStore(KEYS);
          req.result.createObjectStore(OPS);
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
  async loadOps(world: string): Promise<TileOp[]> {
    if (!this.db) return [];
    const range = IDBKeyRange.bound(`${world}|`, `${world}|￿`);
    return new Promise((resolve) => {
      const req = this.db!.transaction(OPS).objectStore(OPS).getAll(range);
      req.onsuccess = () => resolve(req.result as TileOp[]);
      req.onerror = () => resolve([]);
    });
  }

  /** Store the winning op for a tile (replacing the one it beat). */
  saveOp(world: string, op: TileOp): void {
    void this.put(OPS, `${world}|${op.x},${op.y}`, op);
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
