/**
 * The character vault: every character a player creates, stored on their own device in IndexedDB.
 * Ruleset-agnostic: it stores whole documents with a few indexed fields and never interprets game data.
 */

export interface StoredDocument {
  id: string;
  ruleset: string;
  name: string;
  updatedAt: string;
}

export interface VaultEntry<T extends StoredDocument = StoredDocument> {
  id: string;
  ruleset: string;
  name: string;
  updatedAt: string;
  /** A short line for the vault list, such as "Rogue 3 · Wood Elf". */
  summary: string;
  doc: T;
}

export interface TrashEntry<T extends StoredDocument = StoredDocument> extends VaultEntry<T> {
  deletedAt: string;
}

export interface RollEntry {
  id: string;
  characterId: string;
  at: string;
  label: string;
  expression: string;
  total: number;
  breakdown: string;
  /** "crit" or "fumble" for a natural 20 or 1 on a single d20. */
  flag?: "crit" | "fumble";
}

const DB_NAME = "mimicbox";
const DB_VERSION = 1;
const ROLL_HISTORY_LIMIT = 200;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Storage request failed."));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Storage transaction failed."));
    tx.onabort = () => reject(tx.error ?? new Error("Storage transaction was aborted."));
  });
}

export function openDatabase(factory: IDBFactory = globalThis.indexedDB, name = DB_NAME): Promise<IDBDatabase> {
  if (!factory) return Promise.reject(new Error("This browser has no on-device storage (IndexedDB), so characters can't be saved."));
  return new Promise((resolve, reject) => {
    const req = factory.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("characters")) {
        const store = db.createObjectStore("characters", { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
      if (!db.objectStoreNames.contains("trash")) db.createObjectStore("trash", { keyPath: "id" });
      if (!db.objectStoreNames.contains("rolls")) {
        const rolls = db.createObjectStore("rolls", { keyPath: "id" });
        rolls.createIndex("characterAt", ["characterId", "at"]);
      }
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Couldn't open on-device storage."));
    req.onblocked = () => reject(new Error("Mimic Box is open in another tab with an older version. Close other tabs and reload."));
  });
}

export class Vault {
  constructor(private readonly db: IDBDatabase) {}

  static async open(factory?: IDBFactory, name?: string): Promise<Vault> {
    return new Vault(await openDatabase(factory, name));
  }

  async list(): Promise<VaultEntry[]> {
    const tx = this.db.transaction("characters", "readonly");
    const all = await request(tx.objectStore("characters").getAll());
    return (all as VaultEntry[]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get<T extends StoredDocument>(id: string): Promise<VaultEntry<T> | undefined> {
    const tx = this.db.transaction("characters", "readonly");
    return (await request(tx.objectStore("characters").get(id))) as VaultEntry<T> | undefined;
  }

  /** Saves a whole document. Called after every change. */
  async put<T extends StoredDocument>(doc: T, summary: string): Promise<void> {
    const entry: VaultEntry<T> = { id: doc.id, ruleset: doc.ruleset, name: doc.name, updatedAt: doc.updatedAt, summary, doc };
    const tx = this.db.transaction("characters", "readwrite");
    tx.objectStore("characters").put(structuredClone(entry));
    await done(tx);
  }

  /** Moves a character to the trash, where it can be restored. */
  async remove(id: string): Promise<void> {
    const tx = this.db.transaction(["characters", "trash"], "readwrite");
    const entry = (await request(tx.objectStore("characters").get(id))) as VaultEntry | undefined;
    if (entry) {
      tx.objectStore("trash").put({ ...entry, deletedAt: new Date().toISOString() } satisfies TrashEntry);
      tx.objectStore("characters").delete(id);
    }
    await done(tx);
  }

  async trash(): Promise<TrashEntry[]> {
    const tx = this.db.transaction("trash", "readonly");
    const all = (await request(tx.objectStore("trash").getAll())) as TrashEntry[];
    return all.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }

  async restore(id: string): Promise<void> {
    const tx = this.db.transaction(["characters", "trash"], "readwrite");
    const entry = (await request(tx.objectStore("trash").get(id))) as TrashEntry | undefined;
    if (entry) {
      const { deletedAt: _deletedAt, ...rest } = entry;
      tx.objectStore("characters").put(rest);
      tx.objectStore("trash").delete(id);
    }
    await done(tx);
  }

  /** Permanently deletes a trashed character and its roll history. */
  async purge(id: string): Promise<void> {
    const tx = this.db.transaction(["trash", "rolls"], "readwrite");
    tx.objectStore("trash").delete(id);
    const index = tx.objectStore("rolls").index("characterAt");
    const keys = await request(index.getAllKeys(IDBKeyRange.bound([id, ""], [id, "￿"])));
    for (const key of keys) tx.objectStore("rolls").delete(key);
    await done(tx);
  }

  async addRoll(entry: RollEntry): Promise<void> {
    const tx = this.db.transaction("rolls", "readwrite");
    const store = tx.objectStore("rolls");
    store.put(entry);
    const index = store.index("characterAt");
    const keys = await request(index.getAllKeys(IDBKeyRange.bound([entry.characterId, ""], [entry.characterId, "￿"])));
    // Keys come back oldest first; trim the history to the newest entries.
    for (const key of keys.slice(0, Math.max(0, keys.length - ROLL_HISTORY_LIMIT))) store.delete(key);
    await done(tx);
  }

  async rolls(characterId: string, limit = 50): Promise<RollEntry[]> {
    const tx = this.db.transaction("rolls", "readonly");
    const index = tx.objectStore("rolls").index("characterAt");
    const all = (await request(index.getAll(IDBKeyRange.bound([characterId, ""], [characterId, "￿"])))) as RollEntry[];
    return all.reverse().slice(0, limit);
  }

  async clearRolls(characterId: string): Promise<void> {
    const tx = this.db.transaction("rolls", "readwrite");
    const keys = await request(tx.objectStore("rolls").index("characterAt").getAllKeys(IDBKeyRange.bound([characterId, ""], [characterId, "￿"])));
    for (const key of keys) tx.objectStore("rolls").delete(key);
    await done(tx);
  }

  async getSetting<T>(key: string): Promise<T | undefined> {
    const tx = this.db.transaction("settings", "readonly");
    return (await request(tx.objectStore("settings").get(key))) as T | undefined;
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    const tx = this.db.transaction("settings", "readwrite");
    tx.objectStore("settings").put(value, key);
    await done(tx);
  }

  close(): void {
    this.db.close();
  }
}

export interface StorageStatus {
  persisted: boolean;
  usageBytes: number | null;
  quotaBytes: number | null;
}

/**
 * Asks the browser to keep this site's data even when the device is low on space.
 * Browsers may say no (often until the app is installed); the app shows the result and suggests exporting.
 */
export async function requestPersistence(nav: Navigator | undefined = globalThis.navigator): Promise<StorageStatus> {
  const storage = nav?.storage;
  if (!storage) return { persisted: false, usageBytes: null, quotaBytes: null };
  let persisted = (await storage.persisted?.()) ?? false;
  if (!persisted && storage.persist) persisted = await storage.persist();
  const estimate = await storage.estimate?.();
  return { persisted, usageBytes: estimate?.usage ?? null, quotaBytes: estimate?.quota ?? null };
}
