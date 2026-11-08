// D59: what a household chose to keep on this device only. The browser's IndexedDB, one object store per kind, one database per household
// (so two households on one browser never meet). Browser only: nothing here is imported by the server, and the server never sees the stored
// items except the ones a question carries. Every call is wrapped; when the browser's storage is blocked or full the error says so in words.
import type { DeviceBrief } from "@/lib/schema/device-brief";
import type { MemoryItem } from "@/lib/schema/memory";
import type { ConversationTurn } from "@/lib/schema/turn";
import { applyMemoryChanges, addMemoryItem, editMemoryItem, forgetMemoryItem, sortMemory } from "./memory-ops";
import { movePin, orderedPins, pinItem, unpinItem, updatePin, type DevicePin } from "./journal-ops";

const DEVICE_KINDS = ["memory", "canvases", "journal"] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];
export type { DeviceBrief };
export type DeviceJournal = { turns: ConversationTurn[]; briefs: DeviceBrief[] };
const JOURNAL_STORES = ["journal", "briefs"];
type DeviceStore = DeviceKind | "briefs";
type DeviceItems = { memory: MemoryItem; canvases: DevicePin; journal: ConversationTurn };

/** Written for a person: shown on the Your data row, in Ask and on Home when this browser's storage will not work. */
class DeviceStoreError extends Error {}
const UNAVAILABLE = "This browser can’t keep data on this device right now (its storage is blocked or full). Keep it in our cloud instead, or allow storage for this site and try again.";

const open = (householdId: string): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  if (typeof indexedDB === "undefined") { reject(new DeviceStoreError(UNAVAILABLE)); return; }
  try {
    const request = indexedDB.open(`pes-device-${householdId}`, 2);
    request.onupgradeneeded = event => {
      if (event.oldVersion === 0) for (const kind of DEVICE_KINDS) request.result.createObjectStore(kind, { keyPath: "id" });
      if (event.oldVersion < 2) request.result.createObjectStore("briefs", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new DeviceStoreError(UNAVAILABLE));
    request.onblocked = () => reject(new DeviceStoreError(UNAVAILABLE));
  } catch { reject(new DeviceStoreError(UNAVAILABLE)); }
});

async function transact<T>(householdId: string, stores: string | string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => () => T): Promise<T> {
  const database = await open(householdId);
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = database.transaction(stores, mode);
      tx.oncomplete = () => resolve(result());
      tx.onerror = tx.onabort = () => reject(new DeviceStoreError(UNAVAILABLE));
      let result: () => T;
      try { result = work(tx); }
      catch (error) { tx.abort(); reject(error); }
    });
  } catch { throw new DeviceStoreError(UNAVAILABLE); }
  finally { database.close(); }
}

function run<T>(householdId: string, kind: DeviceStore, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return transact(householdId, kind, mode, tx => {
    const request = work(tx.objectStore(kind));
    return () => request ? request.result : undefined;
  });
}

/** Every item of a kind, as stored. */
export async function listDevice<K extends DeviceKind>(householdId: string, kind: K): Promise<DeviceItems[K][]> {
  return (await run<DeviceItems[K][]>(householdId, kind, "readonly", store => store.getAll())) ?? [];
}

/** Replaces the whole kind with these items in one transaction (all or nothing). */
export async function replaceDevice<K extends DeviceKind>(householdId: string, kind: K, items: DeviceItems[K][]): Promise<void> {
  await run(householdId, kind, "readwrite", store => { store.clear(); for (const item of items) store.put(item); });
}

export async function countDevice(householdId: string, kind: DeviceKind): Promise<number> {
  if (kind !== "journal") return (await listDevice(householdId, kind)).length;
  const { turns, briefs } = await readDeviceJournal(householdId);
  return turns.length + briefs.length;
}
/** Deletes every item of a kind and returns how many went. */
export async function clearDevice(householdId: string, kind: DeviceKind): Promise<number> {
  if (kind === "journal") return transact(householdId, JOURNAL_STORES, "readwrite", tx => {
    const turns = tx.objectStore("journal"), briefs = tx.objectStore("briefs");
    const turnsCount = turns.count(), briefsCount = briefs.count();
    turns.clear();
    briefs.clear();
    return () => turnsCount.result + briefsCount.result;
  });
  const n = await countDevice(householdId, kind);
  await replaceDevice(householdId, kind, []);
  return n;
}

// ------------------------------------------------------------------ memory
/** The household's moment now: `moment` (ISO, from the server) plus the time passed since `openedAt` (a browser clock reading). */
export const householdMomentSince = (moment: string, openedAt: number): Date => new Date(Date.parse(moment) + (Date.now() - openedAt));
export const deviceMemory = async (householdId: string): Promise<MemoryItem[]> => sortMemory(await listDevice(householdId, "memory"));
export async function applyDeviceMemoryChanges(householdId: string, changes: unknown): Promise<void> {
  await replaceDevice(householdId, "memory", applyMemoryChanges(await listDevice(householdId, "memory"), changes));
}
export async function addDeviceMemory(householdId: string, input: { kind: string; text: string }, now: Date): Promise<MemoryItem> {
  const result = addMemoryItem(await listDevice(householdId, "memory"), input, { madeBy: "form" }, now, crypto.randomUUID());
  if (result.added) await replaceDevice(householdId, "memory", result.items);
  return result.item;
}
export async function editDeviceMemory(householdId: string, id: string, changes: { kind?: string; text?: string }, now: Date): Promise<MemoryItem | null> {
  const result = editMemoryItem(await listDevice(householdId, "memory"), id, changes, now);
  if (!result) return null;
  await replaceDevice(householdId, "memory", result.items);
  return result.item;
}
export async function forgetDeviceMemory(householdId: string, id: string): Promise<boolean> {
  const result = forgetMemoryItem(await listDevice(householdId, "memory"), id);
  if (result.removed) await replaceDevice(householdId, "memory", result.items);
  return result.removed;
}

// ------------------------------------------------------------------ journal
function journalSnapshot(tx: IDBTransaction, onRead?: (value: DeviceJournal) => void): () => DeviceJournal {
  const turns = tx.objectStore("journal").getAll() as IDBRequest<ConversationTurn[]>;
  const briefs = tx.objectStore("briefs").getAll() as IDBRequest<DeviceBrief[]>;
  const snapshot = () => ({ turns: turns.result, briefs: briefs.result });
  if (onRead) {
    const done = () => {
      if (turns.readyState === "done" && briefs.readyState === "done") onRead(snapshot());
    };
    turns.onsuccess = briefs.onsuccess = done;
  }
  return snapshot;
}

export function readDeviceJournal(householdId: string): Promise<DeviceJournal> {
  return transact(householdId, JOURNAL_STORES, "readonly", tx => journalSnapshot(tx));
}

export function replaceDeviceJournal(householdId: string, journal: DeviceJournal): Promise<void> {
  return transact(householdId, JOURNAL_STORES, "readwrite", tx => {
    const turns = tx.objectStore("journal"), briefs = tx.objectStore("briefs");
    turns.clear();
    briefs.clear();
    for (const item of journal.turns) turns.put(item);
    for (const item of journal.briefs) briefs.put(item);
    return () => undefined;
  });
}

/** If another tab wrote to the journal during upload, keep the local copy rather than erasing its new work. */
export function clearMovedDeviceJournal(householdId: string, expected: DeviceJournal): Promise<boolean> {
  return transact(householdId, JOURNAL_STORES, "readwrite", tx => {
    let cleared = false;
    journalSnapshot(tx, current => {
      if (JSON.stringify(current) !== JSON.stringify(expected)) return;
      tx.objectStore("journal").clear();
      tx.objectStore("briefs").clear();
      cleared = true;
    });
    return () => cleared;
  });
}

export async function readDeviceBrief(householdId: string, spaceId: string): Promise<DeviceBrief | null> {
  return (await run<DeviceBrief>(householdId, "briefs", "readonly", store => store.get(spaceId))) ?? null;
}
export async function readDeviceBriefs(householdId: string): Promise<DeviceBrief[]> {
  return (await run<DeviceBrief[]>(householdId, "briefs", "readonly", store => store.getAll())) ?? [];
}
export async function writeDeviceBrief(householdId: string, item: DeviceBrief): Promise<void> {
  await run(householdId, "briefs", "readwrite", store => store.put(item));
}

export async function saveDeviceTurn(householdId: string, turn: ConversationTurn, brief?: DeviceBrief): Promise<void> {
  if (!brief) {
    await run(householdId, "journal", "readwrite", store => store.put(turn));
    return;
  }
  await transact(householdId, JOURNAL_STORES, "readwrite", tx => {
    tx.objectStore("journal").put(turn);
    tx.objectStore("briefs").put(brief);
    return () => undefined;
  });
}
export async function setDeviceThumb(householdId: string, id: string, thumb: 1 | -1 | null): Promise<boolean> {
  const turns = await listDevice(householdId, "journal");
  if (!turns.some(turn => turn.id === id)) return false;
  await replaceDevice(householdId, "journal", turns.map(turn => (turn.id === id ? { ...turn, thumb } : turn)));
  return true;
}
export async function deleteDeviceConversation(householdId: string, conversationId: string): Promise<number> {
  const turns = await listDevice(householdId, "journal");
  const rest = turns.filter(turn => turn.conversationId !== conversationId);
  if (rest.length !== turns.length) await replaceDevice(householdId, "journal", rest);
  return turns.length - rest.length;
}

// ------------------------------------------------------------------ pinned canvases
export const devicePins = async (householdId: string): Promise<DevicePin[]> => orderedPins(await listDevice(householdId, "canvases"));
export async function pinOnDevice(householdId: string, input: { title: string; recipe: unknown; spaceId?: string }): Promise<void> {
  await replaceDevice(householdId, "canvases", pinItem(await listDevice(householdId, "canvases"), input, new Date(), crypto.randomUUID()));
}
export async function updateDevicePin(householdId: string, id: string, recipe: unknown): Promise<boolean> {
  const next = updatePin(await listDevice(householdId, "canvases"), id, recipe);
  if (next) await replaceDevice(householdId, "canvases", next);
  return next !== null;
}
export async function moveDevicePin(householdId: string, id: string, direction: "up" | "down", generalId?: string): Promise<boolean> {
  const next = movePin(await listDevice(householdId, "canvases"), id, direction, generalId);
  if (next) await replaceDevice(householdId, "canvases", next);
  return next !== null;
}
export async function unpinOnDevice(householdId: string, id: string): Promise<boolean> {
  const next = unpinItem(await listDevice(householdId, "canvases"), id);
  if (next) await replaceDevice(householdId, "canvases", next);
  return next !== null;
}

/** Clears the copies this browser keeps for a deleted space in a single IndexedDB transaction. */
export async function deleteDeviceSpace(householdId: string, spaceId: string, kinds: DeviceKind[]): Promise<void> {
  if (kinds.length === 0) return;
  const journal = kinds.includes("journal");
  await transact(householdId, journal ? [...kinds, "briefs"] : kinds, "readwrite", tx => {
    if (journal) tx.objectStore("briefs").delete(spaceId);
    for (const kind of kinds) {
      const rows = tx.objectStore(kind).openCursor();
      rows.onsuccess = () => {
        const row = rows.result;
        if (!row) return;
        if ((kind === "journal" ? row.value.conversationId : row.value.spaceId) === spaceId) row.delete();
        row.continue();
      };
    }
    return () => undefined;
  });
}
