// D58: what the assistant remembers. One function per job; the Memory page and (next) the agent's remember / forget
// tools call these. Delete is real (D59): the row goes, and no event ever carries a memory's text.
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { InputError } from "./input-error";
import { recordEvent, requireHousehold, type Db } from "./household";
import { households, memories } from "./schema";
import { MEMORY_LIMIT, MemoryKind, MemoryText, MEMORY_KIND_KEYS, SECRET_REFUSAL, hasLongNumber, type MemoryItem } from "@/lib/schema/memory";

type MemoryMaker = { madeBy: "form" | "ask" | "mcp"; askId?: string };
type Row = typeof memories.$inferSelect;

const itemOf = (r: Row): MemoryItem => ({
  id: r.id, kind: r.kind, text: r.text, madeBy: r.madeBy as MemoryItem["madeBy"], askId: r.askId,
  createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
});

const kindOf = (kind: unknown) => {
  const parsed = MemoryKind.safeParse(kind);
  if (!parsed.success) throw new InputError(`Choose one of: ${MEMORY_KIND_KEYS.join(", ")}.`);
  return parsed.data;
};
const textOf = (text: unknown) => {
  const parsed = MemoryText.safeParse(text);
  if (!parsed.success) throw new InputError(parsed.error.issues[0].message);
  if (hasLongNumber(parsed.data)) throw new InputError(SECRET_REFUSAL);
  return parsed.data;
};
const idOf = (id: string) => z.string().uuid().safeParse(id).success;

const record = (tx: Db, hid: string, by: MemoryMaker, title: string) =>
  recordEvent(tx, hid, { ...by, kind: "memory_changed", title }); // never a body, never the text

async function lock(tx: Db, hid: string) {
  const [row] = await tx.select({ id: households.id }).from(households).where(eq(households.id, hid)).for("update");
  if (!row) throw new InputError("Household not found");
}

/** Everything the assistant knows, newest first within each kind (kinds in their page order). */
export async function listMemory(db: Db, householdId: string): Promise<MemoryItem[]> {
  const hid = requireHousehold(householdId);
  const rows = await db.select().from(memories).where(eq(memories.householdId, hid)).orderBy(desc(memories.createdAt), desc(memories.id));
  const order = (k: string) => MEMORY_KIND_KEYS.indexOf(k as MemoryKind);
  return rows.map(itemOf).sort((a, b) => order(a.kind) - order(b.kind));
}

/** Adds one thing. The same text already held under the same kind returns the existing item. */
export async function addMemory(db: Db, householdId: string, input: { kind: string; text: string }, by: MemoryMaker): Promise<MemoryItem> {
  const hid = requireHousehold(householdId);
  const kind = kindOf(input.kind), text = textOf(input.text);
  return db.transaction(async tx => {
    await lock(tx, hid);
    const [same] = await tx.select().from(memories).where(and(eq(memories.householdId, hid), eq(memories.kind, kind), eq(memories.text, text)));
    if (same) return itemOf(same);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(memories).where(eq(memories.householdId, hid));
    if (n >= MEMORY_LIMIT) throw new InputError(`The assistant can hold ${MEMORY_LIMIT} things. Delete some first.`);
    const [row] = await tx.insert(memories).values({ householdId: hid, kind, text, madeBy: by.madeBy, askId: by.askId ?? null }).returning();
    await record(tx, hid, by, by.madeBy === "form" ? `You added a ${kind} for the assistant to remember` : `The assistant remembered a ${kind}`);
    return itemOf(row);
  });
}

/** Changes the kind, the text, or both. Null when the id is not this household's. */
export async function editMemory(db: Db, householdId: string, id: string, changes: { kind?: string; text?: string }, by: MemoryMaker): Promise<MemoryItem | null> {
  const hid = requireHousehold(householdId);
  if (!idOf(id)) return null;
  const kind = changes.kind === undefined ? undefined : kindOf(changes.kind);
  const text = changes.text === undefined ? undefined : textOf(changes.text);
  return db.transaction(async tx => {
    await lock(tx, hid);
    const [current] = await tx.select().from(memories).where(and(eq(memories.householdId, hid), eq(memories.id, id)));
    if (!current) return null;
    const next = { kind: kind ?? current.kind, text: text ?? current.text };
    if (next.kind === current.kind && next.text === current.text) return itemOf(current);
    const [clash] = await tx.select({ id: memories.id }).from(memories)
      .where(and(eq(memories.householdId, hid), eq(memories.kind, next.kind), eq(memories.text, next.text)));
    if (clash) throw new InputError("The assistant already knows that.");
    const [row] = await tx.update(memories).set({ ...next, updatedAt: sql`now()` }).where(and(eq(memories.householdId, hid), eq(memories.id, id))).returning();
    await record(tx, hid, by, "You edited something the assistant remembers");
    return itemOf(row);
  });
}

/** Deletes one thing for good. False when the id is not this household's. */
export async function deleteMemory(db: Db, householdId: string, id: string, by: MemoryMaker): Promise<boolean> {
  const hid = requireHousehold(householdId);
  if (!idOf(id)) return false;
  return db.transaction(async tx => {
    const gone = await tx.delete(memories).where(and(eq(memories.householdId, hid), eq(memories.id, id))).returning({ id: memories.id });
    if (gone.length === 0) return false;
    await record(tx, hid, by, "You deleted something the assistant remembered");
    return true;
  });
}

/** Deletes everything the assistant knows. Returns how many items went. */
export async function forgetEverything(db: Db, householdId: string, by: MemoryMaker): Promise<number> {
  const hid = requireHousehold(householdId);
  return db.transaction(async tx => {
    const gone = await tx.delete(memories).where(eq(memories.householdId, hid)).returning({ id: memories.id });
    if (gone.length > 0) await record(tx, hid, by, "The assistant forgot everything");
    return gone.length;
  });
}
