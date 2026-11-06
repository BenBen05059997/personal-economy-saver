// D59: what a household chose to keep on this device only. The browser's IndexedDB, one object store per kind, one database per household
// (so two households on one browser never meet). Browser only: nothing here is imported by the server, and the server never sees the stored
// items except the ones a question carries. Every call is wrapped; when the browser's storage is blocked or full the error says so in words.
import type { MemoryItem } from "@/lib/schema/memory";
import type { ConversationTurn } from "@/lib/schema/turn";
import { applyMemoryChanges, addMemoryItem, editMemoryItem, forgetMemoryItem, sortMemory } from "./memory-ops";
import { appendTurn, latestOf, movePin, orderedPins, pinItem, recentOf, unpinItem, updatePin, type DevicePin } from "./journal-ops";

export const DEVICE_KINDS = ["memory", "canvases", "journal"] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];
export type DeviceItems = { memory: MemoryItem; canvases: DevicePin; journal: ConversationTurn };

/** Written for a person: shown on the Your data row, in Ask and on Home when this browser's storage will not work. */
export class DeviceStoreError extends Error {}
const UNAVAILABLE = "This browser can’t keep data on this device right now (its storage is blocked or full). Keep it in our cloud instead, or allow storage for this site and try again.";

const open = (householdId: string): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  if (typeof indexedDB === "undefined") { reject(new DeviceStoreError(UNAVAILABLE)); return; }
  try {
    const request = indexedDB.open(`pes-device-${householdId}`, 1);
    request.onupgradeneeded = () => { for (const kind of DEVICE_KINDS) request.result.createObjectStore(kind, { keyPath: "id" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new DeviceStoreError(UNAVAILABLE));
    request.onblocked = () => reject(new DeviceStoreError(UNAVAILABLE));
  } catch { reject(new DeviceStoreError(UNAVAILABLE)); }
});

async function run<T>(householdId: string, kind: DeviceKind, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const database = await open(householdId);
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = database.transaction(kind, mode);
      const request = work(tx.objectStore(kind));
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = tx.onabort = () => reject(new DeviceStoreError(UNAVAILABLE));
    });
  } catch { throw new DeviceStoreError(UNAVAILABLE); }
  finally { database.close(); }
}

/** Every item of a kind, as stored. */
export async function listDevice<K extends DeviceKind>(householdId: string, kind: K): Promise<DeviceItems[K][]> {
  return (await run<DeviceItems[K][]>(householdId, kind, "readonly", store => store.getAll())) ?? [];
}

/** Replaces the whole kind with these items in one transaction (all or nothing). */
export async function replaceDevice<K extends DeviceKind>(householdId: string, kind: K, items: DeviceItems[K][]): Promise<void> {
  await run(householdId, kind, "readwrite", store => { store.clear(); for (const item of items) store.put(item); });
}

export const countDevice = async (householdId: string, kind: DeviceKind): Promise<number> => (await listDevice(householdId, kind)).length;
/** Deletes every item of a kind and returns how many went. */
export async function clearDevice(householdId: string, kind: DeviceKind): Promise<number> {
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
export async function saveDeviceTurn(householdId: string, turn: ConversationTurn): Promise<void> {
  await replaceDevice(householdId, "journal", appendTurn(await listDevice(householdId, "journal"), turn));
}
export const deviceRecent = async (householdId: string, conversationId: string, now = new Date()) => recentOf(await listDevice(householdId, "journal"), conversationId, now);
export const deviceLatest = async (householdId: string, now = new Date()) => latestOf(await listDevice(householdId, "journal"), now);
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
export async function pinOnDevice(householdId: string, input: { title: string; recipe: unknown }): Promise<void> {
  await replaceDevice(householdId, "canvases", pinItem(await listDevice(householdId, "canvases"), input, new Date(), crypto.randomUUID()));
}
export async function updateDevicePin(householdId: string, id: string, recipe: unknown): Promise<boolean> {
  const next = updatePin(await listDevice(householdId, "canvases"), id, recipe);
  if (next) await replaceDevice(householdId, "canvases", next);
  return next !== null;
}
export async function moveDevicePin(householdId: string, id: string, direction: "up" | "down"): Promise<boolean> {
  const next = movePin(await listDevice(householdId, "canvases"), id, direction);
  if (next) await replaceDevice(householdId, "canvases", next);
  return next !== null;
}
export async function unpinOnDevice(householdId: string, id: string): Promise<boolean> {
  const next = unpinItem(await listDevice(householdId, "canvases"), id);
  if (next) await replaceDevice(householdId, "canvases", next);
  return next !== null;
}
