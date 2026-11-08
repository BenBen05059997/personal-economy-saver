// D58: what the assistant remembers. One function per job; the Memory page and (next) the agent's remember / forget
// tools call these. Delete is real (D59): the row goes, and no event ever carries a memory's text.
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { InputError } from "./input-error";
import { recordEvent, requireHousehold, withHousehold, type Db } from "./household";
import { households, memories } from "./schema";
import { requireCloud } from "./place";
import { requireSpace } from "./spaces";
import { householdMoment } from "./clock";
import { MEMORY_CLASH, MEMORY_LIMIT, memoryFull, type MemoryItem } from "@/lib/schema/memory";
import { kindOf, sortMemory, textOf } from "@/lib/store/memory-ops";

type MemoryMaker = { madeBy: "form" | "ask" | "mcp"; askId?: string };
type Row = typeof memories.$inferSelect;

const itemOf = (r: Row): MemoryItem => ({
  id: r.id, kind: r.kind, text: r.text, madeBy: r.madeBy as MemoryItem["madeBy"], askId: r.askId,
  ...(r.spaceId !== null && { spaceId: r.spaceId }),
  createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
});

const scope = (id: string | null | undefined) => id === undefined ? undefined : id === null ? isNull(memories.spaceId) : eq(memories.spaceId, id);

const idOf = (id: string) => z.string().uuid().safeParse(id).success;

const record = (tx: Db, hid: string, by: MemoryMaker, title: string) =>
  recordEvent(tx, hid, { ...by, kind: "memory_changed", title }); // never a body, never the text

/** Locks the household row and returns its clock, so a memory is dated on the household's clock like Activity (D34). */
async function lock(tx: Db, hid: string) {
  const [row] = await tx.select({ id: households.id, isDemo: households.isDemo, fixedToday: households.fixedToday, timeZone: households.timeZone }).from(households).where(eq(households.id, hid)).for("update");
  if (!row) throw new InputError("Household not found");
  return row;
}

/** Everything the assistant knows, newest first within each kind (kinds in their page order). */
export async function listMemory(db: Db, householdId: string, spaceId?: string | null): Promise<MemoryItem[]> {
  const hid = requireHousehold(householdId);
  const rows = await withHousehold(db, hid, tx => tx.select().from(memories).where(and(eq(memories.householdId, hid), scope(spaceId))));
  return sortMemory(rows.map(itemOf));
}

/** Adds one thing. The same text already held under the same kind returns the existing item. */
export async function addMemory(db: Db, householdId: string, input: { kind: string; text: string; spaceId?: string | null }, by: MemoryMaker): Promise<MemoryItem> {
  const hid = requireHousehold(householdId);
  const kind = kindOf(input.kind), text = textOf(input.text);
  return withHousehold(db, hid, async tx => {
    const clock = await lock(tx, hid);
    await requireCloud(tx, hid, "memory");
    const spaceId = input.spaceId ? (await requireSpace(tx, hid, input.spaceId, true)).id : null;
    const [same] = await tx.select().from(memories).where(and(eq(memories.householdId, hid), eq(memories.kind, kind), eq(memories.text, text), scope(spaceId)));
    if (same) return itemOf(same);
    const moment = householdMoment(clock);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(memories).where(eq(memories.householdId, hid));
    if (n >= MEMORY_LIMIT) throw new InputError(memoryFull());
    const [row] = await tx.insert(memories).values({ householdId: hid, spaceId, kind, text, madeBy: by.madeBy, askId: by.askId ?? null, createdAt: moment, updatedAt: moment }).returning();
    await record(tx, hid, by, by.madeBy === "form" ? `You added a ${kind} for the assistant to remember` : `The assistant remembered a ${kind}`);
    return itemOf(row);
  });
}

/** Changes the kind, the text, or both. Null when the id is not this household's. */
export async function editMemory(db: Db, householdId: string, id: string, changes: { kind?: string; text?: string; spaceId?: string | null }, by: MemoryMaker): Promise<MemoryItem | null> {
  const hid = requireHousehold(householdId);
  if (!idOf(id)) return null;
  const kind = changes.kind === undefined ? undefined : kindOf(changes.kind);
  const text = changes.text === undefined ? undefined : textOf(changes.text);
  return withHousehold(db, hid, async tx => {
    const clock = await lock(tx, hid);
    await requireCloud(tx, hid, "memory");
    const [current] = await tx.select().from(memories).where(and(eq(memories.householdId, hid), eq(memories.id, id), scope(changes.spaceId)));
    if (!current) return null;
    const next = { kind: kind ?? current.kind, text: text ?? current.text };
    if (next.kind === current.kind && next.text === current.text) return itemOf(current);
    const [clash] = await tx.select({ id: memories.id }).from(memories)
      .where(and(eq(memories.householdId, hid), eq(memories.kind, next.kind), eq(memories.text, next.text), scope(current.spaceId)));
    if (clash) throw new InputError(MEMORY_CLASH);
    const [row] = await tx.update(memories).set({ ...next, updatedAt: householdMoment(clock) }).where(and(eq(memories.householdId, hid), eq(memories.id, id))).returning();
    await record(tx, hid, by, "You edited something the assistant remembers");
    return itemOf(row);
  });
}

/** Deletes one thing for good. False when the id is not this household's. */
export async function deleteMemory(db: Db, householdId: string, id: string, by: MemoryMaker, spaceId?: string | null): Promise<boolean> {
  const hid = requireHousehold(householdId);
  if (!idOf(id)) return false;
  return withHousehold(db, hid, async tx => {
    const gone = await tx.delete(memories).where(and(eq(memories.householdId, hid), eq(memories.id, id), scope(spaceId))).returning({ id: memories.id });
    if (gone.length === 0) return false;
    await record(tx, hid, by, "You deleted something the assistant remembered");
    return true;
  });
}

/** Deletes everything the assistant knows. Returns how many items went. */
export async function forgetEverything(db: Db, householdId: string, by: MemoryMaker, spaceId?: string | null): Promise<number> {
  const hid = requireHousehold(householdId);
  return withHousehold(db, hid, async tx => {
    const gone = await tx.delete(memories).where(and(eq(memories.householdId, hid), scope(spaceId))).returning({ id: memories.id });
    if (gone.length > 0) await record(tx, hid, by, spaceId ? "The assistant forgot the space notes" : "The assistant forgot everything");
    return gone.length;
  });
}
