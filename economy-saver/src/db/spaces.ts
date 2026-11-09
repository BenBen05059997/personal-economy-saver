import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { BriefSchema, type BriefRecord } from "@/lib/agent/brief";
import { requireCloud } from "./place";
import { recordEvent, requireHousehold, withHousehold, type Db } from "./household";
import { InputError } from "./input-error";
import { conversationTurns, households, reminders, spaces, standingRules } from "./schema";

export type Space = typeof spaces.$inferSelect;
export const SPACE_LIMIT = 20;
const generalName = "General";
const unavailable = "Choose an open space from this household.";

function spaceName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || Array.from(trimmed).length > 60) throw new InputError("Enter a space name of up to 60 characters.");
  if (trimmed.toLowerCase() === generalName.toLowerCase()) throw new InputError("General is already the household’s main space.");
  return trimmed;
}

/** Called within the creation transaction. The database trigger also covers households made by older code. */
export async function seedGeneralSpace(db: Db, householdId: string): Promise<void> {
  const hid = requireHousehold(householdId);
  await db.insert(spaces).values({ householdId: hid, name: generalName, isGeneral: true }).onConflictDoNothing();
}

export async function generalSpace(db: Db, householdId: string): Promise<Space> {
  const hid = requireHousehold(householdId);
  return withHousehold(db, hid, async tx => {
    const [row] = await tx.select().from(spaces).where(and(eq(spaces.householdId, hid), eq(spaces.isGeneral, true)));
    if (!row) throw new Error("General space is missing for this household.");
    return row;
  });
}

const spaceOrder = [sql`${spaces.isGeneral} desc`, asc(spaces.createdAt), asc(spaces.id)];

export async function listSpaces(db: Db, householdId: string): Promise<Space[]> {
  const hid = requireHousehold(householdId);
  return withHousehold(db, hid, tx => tx.select().from(spaces).where(eq(spaces.householdId, hid)).orderBy(...spaceOrder));
}

/** The journal can be kept on this device while space names still live in the cloud. */
export async function listSpaceChoices(db: Db, householdId: string) {
  const hid = requireHousehold(householdId);
  return withHousehold(db, hid, tx => tx.select({
    id: spaces.id, name: spaces.name, isGeneral: spaces.isGeneral, status: spaces.status,
  }).from(spaces).where(eq(spaces.householdId, hid)).orderBy(...spaceOrder));
}

async function selectSpace(tx: Db, hid: string, id: string, lock = false): Promise<Space> {
  if (!z.string().uuid().safeParse(id).success) throw new InputError(unavailable);
  const query = tx.select().from(spaces).where(and(eq(spaces.householdId, hid), eq(spaces.id, id)));
  const [row] = await (lock ? query.for("update") : query);
  if (!row) throw new InputError(unavailable);
  return row;
}

export async function requireSpace(db: Db, householdId: string, id: string, lock = false): Promise<Space> {
  const hid = requireHousehold(householdId);
  return withHousehold(db, hid, async tx => {
    const row = await selectSpace(tx, hid, id, lock);
    if (row.status !== "open") throw new InputError(unavailable);
    return row;
  });
}

export async function createSpace(db: Db, householdId: string, name: string): Promise<Space> {
  const hid = requireHousehold(householdId);
  const nameToSave = spaceName(name);
  return withHousehold(db, hid, async tx => {
    await tx.select({ id: households.id }).from(households).where(eq(households.id, hid)).for("update");
    const [{ open }] = await tx.select({ open: sql<number>`count(*)::int` }).from(spaces)
      .where(and(eq(spaces.householdId, hid), eq(spaces.status, "open")));
    if (open >= SPACE_LIMIT) throw new InputError("Archive a space before opening another. A household can have 20 open spaces.");
    const [row] = await tx.insert(spaces).values({ householdId: hid, name: nameToSave }).returning();
    return row;
  });
}

export async function renameSpace(db: Db, householdId: string, id: string, name: string): Promise<void> {
  const hid = requireHousehold(householdId);
  const nameToSave = spaceName(name);
  await withHousehold(db, hid, async tx => {
    const row = await selectSpace(tx, hid, id, true);
    if (row.isGeneral) throw new InputError("General can’t be renamed.");
    await tx.update(spaces).set({ name: nameToSave }).where(and(eq(spaces.householdId, hid), eq(spaces.id, id)));
  });
}

export async function archiveSpace(db: Db, householdId: string, id: string): Promise<void> {
  const hid = requireHousehold(householdId);
  await withHousehold(db, hid, async tx => {
    const row = await selectSpace(tx, hid, id, true);
    if (row.isGeneral) throw new InputError("General can’t be archived.");
    await tx.update(spaces).set({ status: "archived" }).where(and(eq(spaces.householdId, hid), eq(spaces.id, id)));
  });
}

export async function deleteSpace(db: Db, householdId: string, id: string): Promise<void> {
  const hid = requireHousehold(householdId);
  await withHousehold(db, hid, async tx => {
    const row = await selectSpace(tx, hid, id, true);
    if (row.isGeneral) throw new InputError("General can’t be deleted.");
    await tx.delete(conversationTurns).where(and(eq(conversationTurns.householdId, hid), eq(conversationTurns.conversationId, id)));
    await tx.update(standingRules).set({ spaceId: null }).where(and(eq(standingRules.householdId, hid), eq(standingRules.spaceId, id)));
    await tx.update(reminders).set({ spaceId: null }).where(and(eq(reminders.householdId, hid), eq(reminders.spaceId, id)));
    // Notes and pins cascade. Attached documents are independent of their turns.
    await tx.delete(spaces).where(and(eq(spaces.householdId, hid), eq(spaces.id, id)));
  });
}

/** Cloud briefs belong to the journal. The household lock also serializes a move to this device. */
export async function saveBrief(db: Db, householdId: string, id: string, input: unknown, by: "ask" | "form", askId?: string): Promise<BriefRecord> {
  const hid = requireHousehold(householdId);
  const parsed = BriefSchema.safeParse(input);
  if (!parsed.success) throw new InputError(parsed.error.issues[0].message);
  return withHousehold(db, hid, async tx => {
    await tx.select({ id: households.id }).from(households).where(eq(households.id, hid)).for("update");
    await requireCloud(tx, hid, "journal");
    await requireSpace(tx, hid, id, true);
    const at = new Date();
    await tx.update(spaces).set({ brief: parsed.data, briefUpdatedAt: at, briefUpdatedBy: by })
      .where(and(eq(spaces.householdId, hid), eq(spaces.id, id)));
    await recordEvent(tx, hid, { kind: "brief_updated", madeBy: by, askId, title: by === "ask" ? "Agent updated a space brief" : "You edited a space brief" });
    return { brief: parsed.data, updatedAt: at.toISOString(), updatedBy: by };
  });
}
