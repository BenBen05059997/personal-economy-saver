// D59: the operations on what the assistant remembers, as pure functions over a list. The browser's device store (index.ts) runs them on its
// own copy; the server runs them on the list that came with a question (the household keeps its memory on one device) and sends the change
// back in the reply. The same rules as src/db/memory.ts: 400 characters, no run of 12 digits, 200 items, the same text under the same kind is one item.
import { z } from "zod";
import { InputError } from "@/db/input-error";
import { MEMORY_CLASH, MEMORY_KIND_KEYS, MEMORY_LIMIT, memoryFull, MemoryItem, MemoryKind, MemoryText, SECRET_REFUSAL, hasLongNumber } from "@/lib/schema/memory";

/** What `remember` and `forget` did to the list the question carried; the browser applies it to its own copy. */
export const MemoryChange = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), item: MemoryItem }).strict(),
  z.object({ op: z.literal("forget"), id: z.string().uuid() }).strict(),
]);
export type MemoryChange = z.infer<typeof MemoryChange>;

/** The memory a question carried from the device (`items`, changed in place as the tools run) and what the tools changed (`changes`, returned in the reply). */
/** `moment` is the household's now (householdMoment, D34), so an item made by a question is dated like the cloud's. */
export type DeviceMemory = { items: MemoryItem[]; changes: MemoryChange[]; moment: Date };

type By = { madeBy: "form" | "ask" | "mcp"; askId?: string };

/** Newest first within each kind, kinds in their page order. */
export function sortMemory(items: MemoryItem[]): MemoryItem[] {
  const order = (kind: string) => MEMORY_KIND_KEYS.indexOf(kind as MemoryKind);
  return [...items].sort((a, b) => order(a.kind) - order(b.kind) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

/** The kind and the text of an item, checked: the one place the rules live (cloud and device). */
export const kindOf = (kind: unknown) => {
  const parsed = MemoryKind.safeParse(kind);
  if (!parsed.success) throw new InputError(`Choose one of: ${MEMORY_KIND_KEYS.join(", ")}.`);
  return parsed.data;
};
export const textOf = (text: unknown) => {
  const parsed = MemoryText.safeParse(text);
  if (!parsed.success) throw new InputError(parsed.error.issues[0].message);
  if (hasLongNumber(parsed.data)) throw new InputError(SECRET_REFUSAL);
  return parsed.data;
};

/** Adds one thing. The same text under the same kind returns the existing item (`added` false). */
export function addMemoryItem(items: MemoryItem[], input: { kind: string; text: string }, by: By, now: Date, id: string): { items: MemoryItem[]; item: MemoryItem; added: boolean } {
  const kind = kindOf(input.kind), text = textOf(input.text);
  const same = items.find(item => item.kind === kind && item.text === text);
  if (same) return { items, item: same, added: false };
  if (items.length >= MEMORY_LIMIT) throw new InputError(memoryFull());
  const stamp = now.toISOString();
  const item: MemoryItem = { id, kind, text, madeBy: by.madeBy, askId: by.askId ?? null, createdAt: stamp, updatedAt: stamp };
  return { items: sortMemory([...items, item]), item, added: true };
}

/** Changes the kind, the text, or both. Null when the id is not in the list. */
export function editMemoryItem(items: MemoryItem[], id: string, changes: { kind?: string; text?: string }, now: Date): { items: MemoryItem[]; item: MemoryItem } | null {
  const current = items.find(item => item.id === id);
  if (!current) return null;
  const next = { kind: changes.kind === undefined ? current.kind : kindOf(changes.kind), text: changes.text === undefined ? current.text : textOf(changes.text) };
  if (next.kind === current.kind && next.text === current.text) return { items, item: current };
  if (items.some(item => item.id !== id && item.kind === next.kind && item.text === next.text)) throw new InputError(MEMORY_CLASH);
  const item: MemoryItem = { ...current, ...next, updatedAt: now.toISOString() };
  return { items: sortMemory(items.map(existing => (existing.id === id ? item : existing))), item };
}

/** Removes one item. `removed` is false when the id is not in the list. */
export function forgetMemoryItem(items: MemoryItem[], id: string): { items: MemoryItem[]; removed: boolean } {
  const rest = items.filter(item => item.id !== id);
  return { items: rest, removed: rest.length !== items.length };
}

/** Applies the changes a reply carried, in order. Each change is checked against its schema; a forget of an item already gone is ignored. */
export function applyMemoryChanges(items: MemoryItem[], changes: unknown): MemoryItem[] {
  const parsed = z.array(MemoryChange).max(20).parse(changes);
  let next = items;
  for (const change of parsed) {
    if (change.op === "forget") next = forgetMemoryItem(next, change.id).items;
    else if (!next.some(item => item.id === change.item.id || (item.kind === change.item.kind && item.text === change.item.text))) next = sortMemory([...next, change.item]);
  }
  return next.slice(0, MEMORY_LIMIT);
}
