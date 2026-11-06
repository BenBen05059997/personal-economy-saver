// D59: where each movable kind (memory, canvases, journal) is kept: our cloud (this database) or this device only (the browser).
// A kind is read from one place only. Moving is two steps in the browser (fetch, store, confirm); the server deletes its copies and sets the
// place in one transaction, or (back to the cloud) inserts what the browser posts, checked against the schemas, and sets the place.
// Every query is scoped by household_id.
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { InputError } from "./input-error";
import { recordEvent, requireHousehold, type Db, type Maker } from "./household";
import { canvases, conversationTurns, households, memories } from "./schema";
import { RecipeSchema } from "@/lib/canvas/schema";
import { MEMORY_LIMIT, MemoryItem, hasLongNumber, SECRET_REFUSAL } from "@/lib/schema/memory";
import { ConversationTurn, TURN_LIMIT, TURN_VERSION } from "@/lib/schema/turn";
import { MAX_PINS } from "@/lib/canvas/schema";

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
export const PinItem = z.object({
  id: z.string().uuid(), title: z.string().trim().min(1).max(80), recipe: RecipeSchema,
  position: z.number().int().min(0), createdAt: z.string().datetime(),
}).strict();
export type PinItem = z.infer<typeof PinItem>;

const ItemsFor = {
  memory: z.array(MemoryItem).max(MEMORY_LIMIT),
  canvases: z.array(PinItem).max(MAX_PINS),
  journal: z.array(ConversationTurn).max(TURN_LIMIT),
} as const;

const lock = async (tx: Db, hid: string) => {
  const [row] = await tx.select().from(households).where(eq(households.id, hid)).for("update");
  if (!row) throw new InputError("Household not found");
  return row;
};

/** The items the browser takes to keep on this device: everything of the kind, in the shape the device store holds. */
export async function itemsToMove(db: Db, householdId: string, what: Movable): Promise<unknown[]> {
  const hid = requireHousehold(householdId);
  if ((await readPlaces(db, hid))[what] === "device") throw new InputError(`${NAMES[what][0].toUpperCase()}${NAMES[what].slice(1)} are already kept on this device.`);
  switch (what) {
    case "memory": {
      const rows = await db.select().from(memories).where(eq(memories.householdId, hid)).orderBy(asc(memories.createdAt), asc(memories.id));
      return rows.map(r => ({ id: r.id, kind: r.kind, text: r.text, madeBy: r.madeBy, askId: r.askId, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() }));
    }
    case "canvases": {
      const rows = await db.select().from(canvases).where(eq(canvases.householdId, hid)).orderBy(asc(canvases.position), asc(canvases.createdAt));
      return rows.map(r => ({ id: r.id, title: r.title, recipe: r.recipe, position: r.position, createdAt: r.createdAt.toISOString() }));
    }
    case "journal": {
      const rows = await db.select().from(conversationTurns).where(eq(conversationTurns.householdId, hid)).orderBy(asc(conversationTurns.createdAt), asc(conversationTurns.id));
      return rows.map(r => ({
        version: TURN_VERSION, id: r.id, conversationId: r.conversationId, question: r.question, kind: r.kind, reply: r.reply, choices: r.choices ?? null,
        recipe: r.recipe ?? null, sources: r.sources, thumb: r.thumb === 1 ? 1 : r.thumb === -1 ? -1 : null, createdAt: r.createdAt.toISOString(),
      }));
    }
  }
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((id, i) => id === [...b].sort()[i]);
const CHANGED = "Something changed while it was being moved. Nothing was moved; try again.";

/** After the browser has stored the items it fetched: deletes this household's copies and sets the place, in one transaction. `ids` are the ids the browser stored; if the cloud now holds others, nothing moves. */
export async function moveToDevice(db: Db, householdId: string, what: Movable, ids: string[], by: Maker): Promise<number> {
  const hid = requireHousehold(householdId);
  return db.transaction(async tx => {
    const row = await lock(tx, hid);
    if (row[COLUMN[what]] === "device") throw new InputError("That is already kept on this device.");
    const table = what === "memory" ? memories : what === "canvases" ? canvases : conversationTurns;
    const held = (await tx.select({ id: table.id }).from(table).where(eq(table.householdId, hid))).map(r => r.id);
    if (!sameIds(held, ids)) throw new InputError(CHANGED);
    await tx.delete(table).where(and(eq(table.householdId, hid), inArray(table.id, held.length ? held : ["00000000-0000-0000-0000-000000000000"])));
    await tx.update(households).set({ [COLUMN[what]]: "device" }).where(eq(households.id, hid));
    await recordEvent(tx, hid, { ...by, kind: "data_moved", title: `Moved ${NAMES[what]} to this device` }); // never an item
    return held.length;
  });
}

/** Back to the cloud: the browser posts the items; each is checked against its schema, inserted with its id, and the place is set, in one transaction. */
export async function moveToCloud(db: Db, householdId: string, what: Movable, items: unknown, by: Maker): Promise<number> {
  const hid = requireHousehold(householdId);
  const parsed = ItemsFor[what].safeParse(items);
  if (!parsed.success) throw new InputError("The items on this device are not in a shape the cloud can keep, so nothing was moved.");
  return db.transaction(async tx => {
    const row = await lock(tx, hid);
    if (row[COLUMN[what]] !== "device") throw new InputError("That is already kept in our cloud.");
    let count = 0;
    if (what === "memory") {
      const list = parsed.data as MemoryItem[];
      if (list.some(item => hasLongNumber(item.text))) throw new InputError(SECRET_REFUSAL);
      const seen = new Set<string>();
      for (const item of list) {
        const key = `${item.kind}\u0000${item.text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await tx.insert(memories).values({ id: item.id, householdId: hid, kind: item.kind, text: item.text, madeBy: item.madeBy, askId: item.askId, createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt) }).onConflictDoNothing();
        count++;
      }
    } else if (what === "canvases") {
      const list = [...(parsed.data as PinItem[])].sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
      for (const [position, pin] of list.entries()) {
        await tx.insert(canvases).values({ id: pin.id, householdId: hid, title: pin.title, recipe: pin.recipe, position, madeBy: by.madeBy, createdAt: new Date(pin.createdAt) }).onConflictDoNothing();
        count++;
      }
    } else {
      for (const turn of parsed.data as ConversationTurn[]) {
        await tx.insert(conversationTurns).values({
          id: turn.id, householdId: hid, conversationId: turn.conversationId, question: turn.question, kind: turn.kind, reply: turn.reply,
          choices: turn.choices, recipe: turn.recipe, sources: turn.sources, thumb: turn.thumb, createdAt: new Date(turn.createdAt),
        }).onConflictDoNothing();
        count++;
      }
    }
    await tx.update(households).set({ [COLUMN[what]]: "cloud" }).where(eq(households.id, hid));
    await recordEvent(tx, hid, { ...by, kind: "data_moved", title: `Moved ${NAMES[what]} to our cloud` });
    return count;
  });
}
