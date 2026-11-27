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
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = (e) => {
      if (e.oldVersion < 1) req.result.createObjectStore("campaigns", { keyPath: "id" });
      // Map tiles, keyed "mapId:tx:ty", kept apart from campaigns so campaigns stay small.
      if (e.oldVersion < 2) req.result.createObjectStore("tiles");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Couldn't open campaign storage."));
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>, store = "campaigns"): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
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

export async function saveTiles(mapId: string, tiles: Map<string, string>): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("tiles", "readwrite");
    for (const [key, data] of tiles) tx.objectStore("tiles").put(data, `${mapId}:${key}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Saving the map failed. The device may be out of space."));
  });
}

/** Every tile of a map, keyed "tx:ty". */
export async function loadTiles(mapId: string): Promise<Map<string, string>> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("tiles", "readonly");
    const out = new Map<string, string>();
    const req = tx.objectStore("tiles").openCursor(IDBKeyRange.bound(`${mapId}:`, `${mapId}:\uffff`));
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return;
      out.set(String(cur.key).slice(mapId.length + 1), cur.value as string);
      cur.continue();
    };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error ?? new Error("Couldn't read the map."));
  });
}

export const deleteTiles = (mapId: string) => run("readwrite", (s) => s.delete(IDBKeyRange.bound(`${mapId}:`, `${mapId}:\uffff`)), "tiles").then(() => undefined);

/** Handout pictures, kept in the same store as map tiles under "image:<id>". */
export const saveImage = (id: string, data: string) =>
  run("readwrite", (s) => s.put(data, `image:${id}`), "tiles").then(
    () => undefined,
    () => {
      throw new Error("Saving the picture failed. The device may be out of space.");
    },
  );
export const loadImage = (id: string) => run<string | undefined>("readonly", (s) => s.get(`image:${id}`) as IDBRequest<string | undefined>, "tiles");
export const deleteImage = (id: string) => run("readwrite", (s) => s.delete(`image:${id}`), "tiles").then(() => undefined);
