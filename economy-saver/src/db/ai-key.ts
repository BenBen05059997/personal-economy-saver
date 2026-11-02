import { and, eq, sql } from "drizzle-orm";
import { pgSchema, text, uuid } from "drizzle-orm/pg-core";
import { requireHousehold, type Db } from "./household";
import { households } from "./schema";

/** Messages contain configuration names and fixed text only; safe for a response. */
export class AiKeyError extends Error {}
const secretName = (hid: string) => `household:${hid}:anthropic`;
// Vault is an existing private extension schema, outside the application's migrations.
const vault = pgSchema("vault");
const secrets = vault.table("secrets", { id: uuid("id").notNull(), name: text("name") });
const decrypted = vault.table("decrypted_secrets", { id: uuid("id").notNull(), name: text("name"), key: text("decrypted_secret") });

async function lockedHousehold(db: Db, hid: string) {
  const [household] = await db.select().from(households).where(eq(households.id, hid)).for("update");
  if (!household) throw new AiKeyError("Household no longer exists");
  return household;
}

/** Call immediately before EACH provider invocation, including retries. Never log the return value. */
export async function readerKey(db: Db, householdId: string, now = new Date()): Promise<string> {
  const hid = requireHousehold(householdId);
  try {
    return await db.transaction(async tx => {
      const household = await lockedHousehold(tx, hid);
      if (household.aiKeySecretId) {
        const [secret] = await tx.select({ key: decrypted.key }).from(decrypted)
          .innerJoin(households, eq(households.aiKeySecretId, decrypted.id))
          .where(and(eq(households.id, hid), eq(decrypted.name, secretName(hid))));
        if (!secret?.key) throw new AiKeyError("Saved AI key is unavailable. Replace it in Settings.");
        return secret.key;
      }
      const key = process.env.ANTHROPIC_API_KEY?.trim();
      if (!key) throw new AiKeyError("ANTHROPIC_API_KEY is not set");
      const rawLimit = process.env.ANTHROPIC_DAILY_READ_LIMIT;
      if (!rawLimit?.trim()) throw new AiKeyError("ANTHROPIC_DAILY_READ_LIMIT is not set");
      const limit = Number(rawLimit);
      if (!Number.isSafeInteger(limit) || limit < 1) throw new AiKeyError("ANTHROPIC_DAILY_READ_LIMIT must be a positive integer");
      // Actual local date, including for the date-anchored demo. Quota resets at local midnight.
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: household.timeZone,
        year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
      const used = household.aiReadsDay === day ? household.aiReadsToday : 0;
      if (used >= limit) throw new AiKeyError("Daily AI allowance reached. Add your own key in Settings or try after local midnight.");
      await tx.update(households).set({ aiReadsDay: day, aiReadsToday: used + 1 }).where(eq(households.id, hid));
      return key;
    });
  } catch (error) {
    if (error instanceof AiKeyError) throw error;
    throw new AiKeyError("AI key storage is unavailable. Check DATABASE_URL and Supabase Vault permissions.");
  }
}

export async function saveHouseholdKey(db: Db, householdId: string, key: string) {
  const hid = requireHousehold(householdId);
  if (!/^sk-ant-[A-Za-z0-9_-]{20,500}$/.test(key)) throw new AiKeyError("Enter a valid Anthropic API key");
  try {
    await db.transaction(async tx => {
      const household = await lockedHousehold(tx, hid);
      const name = secretName(hid);
      if (household.aiKeySecretId) {
        // The id pointer alone cannot authorize changing another household's secret.
        const existing = await tx.select({ id: secrets.id }).from(secrets)
          .innerJoin(households, eq(households.aiKeySecretId, secrets.id))
          .where(and(eq(households.id, hid), eq(secrets.name, name)));
        if (!existing.length) throw new AiKeyError("Saved AI key ownership could not be verified");
        await tx.select({ updated: sql`updated` }).from(sql`(select vault.update_secret(${household.aiKeySecretId}::uuid, ${key}, ${name}) as updated) as changed_secret`);
      } else {
        const [secret] = await tx.select({ id: sql<string>`id` }).from(sql`(select vault.create_secret(${key}, ${name}, 'Household Anthropic key') as id) as created_secret`);
        await tx.update(households).set({ aiKeySecretId: secret.id }).where(eq(households.id, hid));
      }
      await tx.update(households).set({ aiKeyHint: `sk-ant-…${key.slice(-4)}` }).where(eq(households.id, hid));
    });
  } catch (error) {
    if (error instanceof AiKeyError) throw error;
    throw new AiKeyError("AI key storage is unavailable. Check DATABASE_URL and Supabase Vault permissions.");
  }
}

/** Caller must hold the household row lock in its transaction. Safe to call when no key is saved. */
export async function deleteHouseholdKey(tx: Db, householdId: string) {
  const hid = requireHousehold(householdId);
  try {
    const household = await lockedHousehold(tx, hid);
    if (household.aiKeySecretId) {
      const deleted = await tx.delete(secrets).where(and(eq(secrets.id, household.aiKeySecretId), eq(secrets.name, secretName(hid)),
        sql`exists (select 1 from ${households} where ${households.id} = ${hid}::uuid and ${households.aiKeySecretId} = ${secrets.id})`)).returning({ id: secrets.id });
      if (deleted.length !== 1) throw new AiKeyError("Saved AI key ownership could not be verified");
    }
    await tx.update(households).set({ aiKeySecretId: null, aiKeyHint: null }).where(eq(households.id, hid));
  } catch (error) {
    if (error instanceof AiKeyError) throw error;
    throw new AiKeyError("AI key deletion is unavailable. Check Supabase Vault permissions.");
  }
}
