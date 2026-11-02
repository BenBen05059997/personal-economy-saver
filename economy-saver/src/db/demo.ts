import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { type Db, requireHousehold } from "./household";
import { households } from "./schema";
import { seedBen } from "./seed";
import { deleteHouseholdKey } from "./ai-key";
import { removeHouseholdDocuments } from "./document-cleanup";

export const DEMO_DATE = "2026-11-14";

export async function findDemoHousehold(db: Db, id: string): Promise<string | null> {
  if (!z.string().uuid().safeParse(id).success) return null;
  const [demo] = await db.select({ id: households.id }).from(households)
    .where(and(eq(households.id, requireHousehold(id)), eq(households.isDemo, true)));
  return demo?.id ?? null;
}

export async function resetDemoHousehold(db: Db, id: string): Promise<string | null> {
  return db.transaction(async tx => {
    const [existing] = await tx.select({ id: households.id }).from(households)
      .where(and(eq(households.id, requireHousehold(id)), eq(households.isDemo, true))).for("update");
    if (!existing) return null;
    await deleteHouseholdKey(tx, id);
    await removeHouseholdDocuments(tx, id);
    const [deleted] = await tx.delete(households)
      .where(and(eq(households.id, requireHousehold(id)), eq(households.isDemo, true)))
      .returning({ id: households.id });
    if (!deleted) return null;
    return seedBen(tx, { isDemo: true });
  });
}
