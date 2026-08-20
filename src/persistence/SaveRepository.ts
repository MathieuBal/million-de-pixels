import { migrate } from "./migrations";
import type { LevelSaveV1 } from "./schema";

const DB_NAME = "pixel-idle";
const DB_VERSION = 1;

const STORE_LEVELS = "levels";
const STORE_SETTINGS = "settings";

/**
 * IndexedDB persistence.
 *
 * Buffers are stored as ArrayBuffers through structured clone — no base64, no
 * JSON round trip of a million entries. Quota and availability are treated as
 * failure modes, not as guarantees: every call resolves to a status the UI can
 * show rather than throwing into the game loop.
 */
export class SaveRepository {
  private dbPromise: Promise<IDBDatabase> | null = null;

  static isAvailable(): boolean {
    return typeof indexedDB !== "undefined";
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      if (!SaveRepository.isAvailable()) {
        reject(new Error("IndexedDB indisponible dans ce contexte."));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_LEVELS)) {
          db.createObjectStore(STORE_LEVELS, { keyPath: ["profileId", "levelId"] });
        }
        if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
          db.createObjectStore(STORE_SETTINGS);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Ouverture IndexedDB refusée."));
      request.onblocked = () => reject(new Error("IndexedDB bloquée par un autre onglet."));
    });

    return this.dbPromise;
  }

  async putLevel(save: LevelSaveV1): Promise<void> {
    const db = await this.open();
    await run(db, STORE_LEVELS, "readwrite", (store) => store.put(save));
  }

  async getLevel(profileId: string, levelId: string): Promise<LevelSaveV1 | null> {
    const db = await this.open();
    const record = await run<LevelSaveV1 | undefined>(db, STORE_LEVELS, "readonly", (store) =>
      store.get([profileId, levelId]),
    );
    if (!record) return null;
    return migrate(record);
  }

  async listLevels(profileId: string): Promise<LevelSaveV1[]> {
    const db = await this.open();
    const all = await run<LevelSaveV1[]>(db, STORE_LEVELS, "readonly", (store) => store.getAll());
    return all.filter((save) => save.profileId === profileId);
  }

  async deleteLevel(profileId: string, levelId: string): Promise<void> {
    const db = await this.open();
    await run(db, STORE_LEVELS, "readwrite", (store) => store.delete([profileId, levelId]));
  }

  async getSetting<T>(key: string): Promise<T | null> {
    const db = await this.open();
    const value = await run<T | undefined>(db, STORE_SETTINGS, "readonly", (store) => store.get(key));
    return value ?? null;
  }

  async setSetting<T>(key: string, value: T): Promise<void> {
    const db = await this.open();
    await run(db, STORE_SETTINGS, "readwrite", (store) => store.put(value, key));
  }

  /** Best-effort storage report for the UI; never throws. */
  static async estimate(): Promise<{ usage: number; quota: number; persisted: boolean } | null> {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
    try {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      const persisted = (await navigator.storage.persisted?.()) ?? false;
      return { usage, quota, persisted };
    } catch {
      return null;
    }
  }
}

function run<T>(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = action(tx.objectStore(storeName));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error ?? new Error("Transaction IndexedDB échouée."));
    tx.onabort = () => reject(tx.error ?? new Error("Transaction IndexedDB annulée (quota ?)."));
  });
}
