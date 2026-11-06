// The canvases pinned to Home (D57): a title and a recipe, which holds queries and never numbers. Home draws them with the engine each time,
// with no model call. At most 8; position 0 is first. Each change checks the recipe and records an event.
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { InputError } from "./input-error";
import { recordEvent, requireHousehold, type Db, type Maker } from "./household";
import { canvases } from "./schema";
import { problemWords, RecipeSchema, type Recipe } from "@/lib/canvas/schema";

export const MAX_PINS = 8;
export type PinnedCanvas = { id: string; title: string; recipe: Recipe; position: number; madeBy: string; createdAt: string; updatedAt: string };
type Row = typeof canvases.$inferSelect;

const pinOf = (row: Row): PinnedCanvas => ({
  id: row.id, title: row.title, recipe: row.recipe as Recipe, position: row.position, madeBy: row.madeBy,
  createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
});

function recipeOf(value: unknown): Recipe {
  const parsed = RecipeSchema.safeParse(value);
  if (!parsed.success) throw new InputError(problemWords(parsed.error));
  return parsed.data;
}
const titleOf = (title: string): string => {
  const trimmed = title.trim();
  if (trimmed.length < 1 || trimmed.length > 80) throw new InputError("A title is 1 to 80 characters.");
  return trimmed;
};

export async function listCanvases(db: Db, householdId: string): Promise<PinnedCanvas[]> {
  const hid = requireHousehold(householdId);
  return (await db.select().from(canvases).where(eq(canvases.householdId, hid)).orderBy(asc(canvases.position), asc(canvases.createdAt))).map(pinOf);
}

/** Pins a canvas last. The ninth is refused. */
export async function pinCanvas(db: Db, householdId: string, input: { title: string; recipe: unknown }, by: Maker): Promise<PinnedCanvas> {
  const hid = requireHousehold(householdId);
  const title = titleOf(input.title), recipe = recipeOf(input.recipe);
  return db.transaction(async tx => {
    await tx.execute(sql`select 1 from households where id = ${hid} for update`);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(canvases).where(eq(canvases.householdId, hid));
    if (n >= MAX_PINS) throw new InputError("Unpin one first.");
    const [row] = await tx.insert(canvases).values({ householdId: hid, title, recipe, position: n, madeBy: by.madeBy, askId: by.askId ?? null }).returning();
    await recordEvent(tx, hid, { ...by, kind: "canvas_pinned", title: `Pinned “${title}” to Home`, ref: { type: "canvas", id: row.id } });
    return pinOf(row);
  });
}

/** Replaces a pin's recipe (and title, when given). False when the id is not this household's. */
export async function updateCanvas(db: Db, householdId: string, id: string, recipe: unknown, by: Maker, title?: string): Promise<boolean> {
  const hid = requireHousehold(householdId);
  const checked = recipeOf(recipe);
  const newTitle = title === undefined ? undefined : titleOf(title);
  return db.transaction(async tx => {
    const rows = await tx.update(canvases).set({ recipe: checked, ...(newTitle && { title: newTitle }), updatedAt: sql`now()` })
      .where(and(eq(canvases.householdId, hid), eq(canvases.id, id))).returning();
    if (rows.length === 0) return false;
    await recordEvent(tx, hid, { ...by, kind: "canvas_changed", title: `Pinned canvas “${rows[0].title}” changed`, ref: { type: "canvas", id } });
    return true;
  });
}

/** Moves a pin one place up (towards 0) or down. False when the id is not this household's; moving past an end changes nothing. */
export async function moveCanvas(db: Db, householdId: string, id: string, direction: "up" | "down", by: Maker): Promise<boolean> {
  const hid = requireHousehold(householdId);
  return db.transaction(async tx => {
    const all = await tx.select().from(canvases).where(eq(canvases.householdId, hid)).orderBy(asc(canvases.position), asc(canvases.createdAt)).for("update");
    const at = all.findIndex(row => row.id === id);
    if (at < 0) return false;
    const to = direction === "up" ? at - 1 : at + 1;
    if (to < 0 || to >= all.length) return true;
    const order = all.map(row => row.id);
    [order[at], order[to]] = [order[to], order[at]];
    for (const [position, rowId] of order.entries()) await tx.update(canvases).set({ position }).where(and(eq(canvases.householdId, hid), eq(canvases.id, rowId)));
    await recordEvent(tx, hid, { ...by, kind: "canvas_changed", title: `Pinned canvas “${all[at].title}” moved ${direction}`, ref: { type: "canvas", id } });
    return true;
  });
}

/** Removes a pin and closes the gap in the order. False when the id is not this household's. */
export async function unpinCanvas(db: Db, householdId: string, id: string, by: Maker): Promise<boolean> {
  const hid = requireHousehold(householdId);
  return db.transaction(async tx => {
    const gone = await tx.delete(canvases).where(and(eq(canvases.householdId, hid), eq(canvases.id, id))).returning();
    if (gone.length === 0) return false;
    await tx.update(canvases).set({ position: sql`${canvases.position} - 1` }).where(and(eq(canvases.householdId, hid), gt(canvases.position, gone[0].position)));
    await recordEvent(tx, hid, { ...by, kind: "canvas_unpinned", title: `Unpinned “${gone[0].title}” from Home`, ref: { type: "canvas", id } });
    return true;
  });
}
