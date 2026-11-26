/**
 * The DM's campaigns, kept on the DM's device in their own IndexedDB database, apart from the player vault.
 */
import type { HostCampaign } from "@mimicbox/table";

export interface StudioCampaign extends HostCampaign {
  /** WebSocket relays the DM runs; empty means the public Nostr relays. */
  relays: string[];
}

const DB = "mimicbox-studio";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error("This browser has no on-device storage, so campaigns can't be saved."));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("campaigns", { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Couldn't open campaign storage."));
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("campaigns", mode);
    const req = fn(tx.objectStore("campaigns"));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? new Error("Saving the campaign failed."));
  });
}

export const listCampaigns = () => run<StudioCampaign[]>("readonly", (s) => s.getAll() as IDBRequest<StudioCampaign[]>).then((l) => l.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
export const getCampaign = (id: string) => run<StudioCampaign | undefined>("readonly", (s) => s.get(id) as IDBRequest<StudioCampaign | undefined>);
export const saveCampaign = (c: StudioCampaign) => run("readwrite", (s) => s.put(c)).then(() => undefined);
export const deleteCampaign = (id: string) => run("readwrite", (s) => s.delete(id)).then(() => undefined);

/** Relays from the page address, for a group running its own relay: studio.html?relay=wss://example. */
export function relaysFromAddress(): string[] {
  return new URLSearchParams(location.search).getAll("relay").filter((u) => /^wss?:\/\//.test(u));
}
