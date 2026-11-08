// D59: where each movable kind (memory, canvases, journal) is kept: our cloud (this database) or this device only (the browser).
// A kind is read from one place only. Moving is two steps in the browser (fetch, store, confirm); the server deletes its copies and sets the
// place in one transaction, or (back to the cloud) inserts what the browser posts, checked against the schemas, and sets the place.
// Every query is scoped by household_id.
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { InputError } from "./input-error";
import { recordEvent, requireHousehold, withHousehold, type Db, type Maker } from "./household";
import { canvases, conversationTurns, households, memories, spaces } from "./schema";
import { RecipeSchema } from "@/lib/canvas/schema";
import { MEMORY_LIMIT, MemoryItem, hasLongNumber, SECRET_REFUSAL } from "@/lib/schema/memory";
import { ConversationTurn, DEVICE_MEMORY_SOURCE_LABEL, TURN_VERSION } from "@/lib/schema/turn";
import { MAX_PINS } from "@/lib/canvas/schema";
import { DeviceBriefSchema, type DeviceBrief } from "@/lib/schema/device-brief";

export const MOVABLE = ["memory", "canvases", "journal"] as const;
export type Movable = (typeof MOVABLE)[number];
export const isMovable = (value: unknown): value is Movable => (MOVABLE as readonly unknown[]).includes(value);
export type Place = "cloud" | "device";
export type Places = Record<Movable, Place>;

/** What `recall` says, and what `remember` and `forget` refuse with, for an MCP client when the household keeps its memory on one device. */
export const DEVICE_MEMORY_WORDS = "This household keeps its memory on one device. Ask in the app on that device.";
const NAMES: Record<Movable, string> = { memory: "what the assistant remembers", canvases: "pinned canvases", journal: "Ask conversations" };
const COLUMN = { memory: "memoryPlace", canvases: "canvasPlace", journal: "journalPlace" } as const;

export async function readPlaces(db: Db, householdId: string): Promise<Places> {
  const hid = requireHousehold(householdId);
  const [row] = await db.select({ memory: households.memoryPlace, canvases: households.canvasPlace, journal: households.journalPlace }).from(households).where(eq(households.id, hid));
  if (!row) throw new InputError("Household not found");
  const place = (value: string): Place => (value === "device" ? "device" : "cloud");
  return { memory: place(row.memory), canvases: place(row.canvases), journal: place(row.journal) };
}

/** Refuses a cloud write for a kind the household keeps on its device, so a kind is never written to both places. */
export async function requireCloud(db: Db, householdId: string, kind: Movable): Promise<void> {
  if ((await readPlaces(db, householdId))[kind] === "device")
    throw new InputError(`You keep ${NAMES[kind]} on this device only. Change that in Settings, Your data, to use it here.`);
}

/** A pin as it travels between the cloud and the device: the layout and its order, nothing else. */
const PinItem = z.object({
  id: z.string().uuid(), title: z.string().trim().min(1).max(80), recipe: RecipeSchema,
  spaceId: z.string().uuid().optional(), position: z.number().int().min(0), createdAt: z.string().datetime(),
}).strict();
export type PinItem = z.infer<typeof PinItem>;

const ItemsFor = {
  memory: z.array(MemoryItem).max(MEMORY_LIMIT),
  canvases: z.array(PinItem).max(MAX_PINS),
  journal: z.array(ConversationTurn),
} as const;

const lock = async (tx: Db, hid: string) => {
  const [row] = await tx.select().from(households).where(eq(households.id, hid)).for("update");
  if (!row) throw new InputError("Household not found");
  return row;
};

async function briefRows(db: Db, hid: string): Promise<DeviceBrief[]> {
  const rows = await db.select({
    id: spaces.id, brief: spaces.brief, updatedAt: spaces.briefUpdatedAt, updatedBy: spaces.briefUpdatedBy,
  }).from(spaces).where(and(eq(spaces.householdId, hid), isNotNull(spaces.briefUpdatedAt))).orderBy(asc(spaces.id));
  return rows.map(row => DeviceBriefSchema.parse({ ...row, updatedAt: row.updatedAt?.toISOString() }));
}

async function briefRevision(briefs: DeviceBrief[]): Promise<string | undefined> {
  if (!briefs.length) return undefined;
  const bytes = new TextEncoder().encode(JSON.stringify(briefs));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** The items the browser takes to keep on this device: everything of the kind, in the shape the device store holds. */
export async function itemsToMove(db: Db, householdId: string, what: Movable, includeBriefs = false) {
  const hid = requireHousehold(householdId);
  return withHousehold(db, hid, async tx => {
    if ((await readPlaces(tx, hid))[what] === "device") throw new InputError(`${NAMES[what][0].toUpperCase()}${NAMES[what].slice(1)} are already kept on this device.`);
    switch (what) {
      case "memory": {
        const rows = await tx.select().from(memories).where(eq(memories.householdId, hid)).orderBy(asc(memories.createdAt), asc(memories.id));
        return rows.map(r => ({ id: r.id, kind: r.kind, text: r.text, madeBy: r.madeBy, askId: r.askId, ...(r.spaceId && { spaceId: r.spaceId }), createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() }));
      }
      case "canvases": {
        const rows = await tx.select().from(canvases).where(eq(canvases.householdId, hid)).orderBy(asc(canvases.position), asc(canvases.createdAt));
        return rows.map(r => ({ id: r.id, title: r.title, recipe: r.recipe, ...(r.spaceId && { spaceId: r.spaceId }), position: r.position, createdAt: r.createdAt.toISOString() }));
      }
      case "journal": {
        const rows = await tx.select().from(conversationTurns).where(eq(conversationTurns.householdId, hid)).orderBy(asc(conversationTurns.createdAt), asc(conversationTurns.id));
        const named = await tx.select({ id: spaces.id }).from(spaces).where(eq(spaces.householdId, hid));
        const spaceIds = new Set(named.map(space => space.id));
        const items = rows.map(r => ({
          version: TURN_VERSION, ...(spaceIds.has(r.conversationId) && { spaceId: r.conversationId }), id: r.id, conversationId: r.conversationId, question: r.question, kind: r.kind, reply: r.reply, choices: r.choices ?? null,
          recipe: r.recipe ?? null, ...(r.documentId && { documentId: r.documentId }), sources: r.sources, thumb: r.thumb === 1 ? 1 : r.thumb === -1 ? -1 : null, createdAt: r.createdAt.toISOString(),
        }));
        if (!includeBriefs) return items;
        const briefs = await briefRows(tx, hid);
        return { items, briefs, briefRevision: await briefRevision(briefs) };
      }
    }
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

const sameIds = (a: string[], b: string[]) => {
  const bIds = new Set(b);
  return a.length === b.length && bIds.size === b.length && a.every(id => bIds.has(id));
};
const CHANGED = "Something changed while it was being moved. Nothing was moved; try again.";
/** The journal copy is stale. The cloud still has its own copy. */
export class JournalMoveChanged extends InputError {}

/** After the browser has stored the items it fetched: deletes this household's copies and sets the place, in one transaction. `ids` are the ids the browser stored; if the cloud now holds others, nothing moves. */
export async function moveToDevice(db: Db, householdId: string, what: Movable, ids: string[], by: Maker, expectedBriefRevision?: string): Promise<number> {
  const hid = requireHousehold(householdId);
  return withHousehold(db, hid, async tx => {
    const row = await lock(tx, hid);
    if (row[COLUMN[what]] === "device") throw new InputError("That is already kept on this device.");
    const table = what === "memory" ? memories : what === "canvases" ? canvases : conversationTurns;
    const held = (await tx.select({ id: table.id }).from(table).where(eq(table.householdId, hid))).map(r => r.id);
    if (!sameIds(held, ids)) {
      if (what === "journal") throw new JournalMoveChanged(CHANGED);
      throw new InputError(CHANGED);
    }
    const briefs = what === "journal" ? await briefRows(tx, hid) : [];
    if (await briefRevision(briefs) !== expectedBriefRevision) throw new JournalMoveChanged(CHANGED);
    await tx.delete(table).where(eq(table.householdId, hid));
    if (what === "memory") {
      // The cloud journal can remember that it cited an item without keeping a copy of the device note's text.
      await tx.update(conversationTurns).set({ sources: sql`(
        select jsonb_agg(case when item->>'kind' = 'memory'
          then jsonb_set(item, '{label}', to_jsonb(${DEVICE_MEMORY_SOURCE_LABEL}::text))
          else item end order by ord)
        from jsonb_array_elements(${conversationTurns.sources}) with ordinality as source(item, ord)
      )` }).where(and(eq(conversationTurns.householdId, hid), sql`${conversationTurns.sources} @> '[{"kind":"memory"}]'::jsonb`));
    }

    if (briefs.length > 0) await tx.update(spaces).set({ brief: {}, briefUpdatedAt: null, briefUpdatedBy: null })
      .where(eq(spaces.householdId, hid));
    await tx.update(households).set({ [COLUMN[what]]: "device" }).where(eq(households.id, hid));
    await recordEvent(tx, hid, { ...by, kind: "data_moved", title: `Moved ${NAMES[what]} to this device` }); // never an item
    return held.length + briefs.length;
  });
}

/** Back to the cloud: the browser posts the items; each is checked against its schema, inserted with its id, and the place is set, in one transaction. */
export async function moveToCloud(db: Db, householdId: string, what: Movable, items: unknown, by: Maker, briefItems: unknown = []): Promise<number> {
  const hid = requireHousehold(householdId);
  const parsed = ItemsFor[what].safeParse(items);
  const briefs = z.array(DeviceBriefSchema).safeParse(briefItems);
  if (!parsed.success || !briefs.success || (what !== "journal" && briefs.data.length > 0)
    || new Set(briefs.data.map(brief => brief.id)).size !== briefs.data.length) {
    throw new InputError("The items on this device are not in a shape the cloud can keep, so nothing was moved.");
  }
  return withHousehold(db, hid, async tx => {
    const row = await lock(tx, hid);
    if (row[COLUMN[what]] !== "device") throw new InputError("That is already kept in our cloud.");
    const own = await tx.select({ id: spaces.id }).from(spaces).where(eq(spaces.householdId, hid));
    const spaceIds = new Set(own.map(space => space.id));
    let count = 0;
    if (what === "memory") {
      const list = parsed.data as MemoryItem[];
      if (list.some(item => hasLongNumber(item.text))) throw new InputError(SECRET_REFUSAL);
      const seen = new Set<string>();
      for (const item of list) {
        if (item.spaceId && !spaceIds.has(item.spaceId)) continue;
        const key = `${item.spaceId ?? ""}\u0000${item.kind}\u0000${item.text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await tx.insert(memories).values({ id: item.id, householdId: hid, kind: item.kind, text: item.text, spaceId: item.spaceId ?? null, madeBy: item.madeBy, askId: item.askId, createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt) }).onConflictDoNothing();
        count++;
      }
    } else if (what === "canvases") {
      const list = [...(parsed.data as PinItem[])].sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
      for (const pin of list) {
        if (pin.spaceId && !spaceIds.has(pin.spaceId)) continue;
        await tx.insert(canvases).values({ id: pin.id, householdId: hid, title: pin.title, recipe: pin.recipe, position: pin.position, spaceId: pin.spaceId ?? null, madeBy: by.madeBy, createdAt: new Date(pin.createdAt) }).onConflictDoNothing();
        count++;
      }
    } else {
      for (const turn of parsed.data as ConversationTurn[]) {
        if (turn.spaceId && (turn.spaceId !== turn.conversationId || !spaceIds.has(turn.spaceId))) continue;
        await tx.insert(conversationTurns).values({
          id: turn.id, householdId: hid, conversationId: turn.conversationId, question: turn.question, kind: turn.kind, reply: turn.reply,
          choices: turn.choices, recipe: turn.recipe, documentId: turn.documentId ?? null, sources: turn.sources, thumb: turn.thumb, createdAt: new Date(turn.createdAt),
        }).onConflictDoNothing();
        count++;
      }
    }
    for (const item of briefs.data) {
      if (!spaceIds.has(item.id)) continue;
      await tx.update(spaces).set({ brief: item.brief, briefUpdatedAt: new Date(item.updatedAt), briefUpdatedBy: item.updatedBy })
        .where(and(eq(spaces.householdId, hid), eq(spaces.id, item.id)));
      count++;
    }
    await tx.update(households).set({ [COLUMN[what]]: "cloud" }).where(eq(households.id, hid));
    await recordEvent(tx, hid, { ...by, kind: "data_moved", title: `Moved ${NAMES[what]} to our cloud` });
    return count;
  });
}
