import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { fetchReferenceRate, storeReferenceRate } from "./reference-rate";
import { DEMO_DATE } from "./demo";
import { type Db, requireHousehold } from "./household";
import { cards, households, members, paypalConnections, users } from "./schema";
import { deleteHouseholdKey } from "./ai-key";
import { removeHouseholdDocuments } from "./document-cleanup";

export async function householdClock(db: Db, id: string, now = new Date()) {
  const [household] = await db.select({ isDemo: households.isDemo, timeZone: households.timeZone })
    .from(households).where(eq(households.id, requireHousehold(id)));
  if (!household) throw new Error("Household no longer exists");
  return clockForHousehold(household, now);
}

export function clockForHousehold(household: Pick<typeof households.$inferSelect, "isDemo" | "timeZone">, now = new Date()) {
  const today = household.isDemo ? DEMO_DATE : new Intl.DateTimeFormat("en-CA", {
    timeZone: household.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  return { today, timeZone: household.timeZone, isDemo: household.isDemo };
}

export async function householdDate(db: Db, id: string, now?: Date) {
  return (await householdClock(db, id, now)).today;
}

// A sole owner's household has their verified Supabase uid as its id. Both predicates
// are required: the id is a routing key and never an authorization credential.
export async function accountHousehold(db: Db, verifiedUid: string) {
  const [membership] = await db.select({ id: users.householdId }).from(users)
    .where(and(eq(users.householdId, requireHousehold(verifiedUid)), eq(users.authUserId, verifiedUid)));
  return membership?.id ?? null;
}

const currency = z.enum(["JPY", "USD"]);
export const setupForm = z.object({
  name: z.string().trim().min(1).max(80),
  timeZone: z.string().min(1).max(80).refine(zone => {
    try { new Intl.DateTimeFormat("en", { timeZone: zone }); return true; } catch { return false; }
  }),
  currency,
  bank: z.string().max(16).regex(/^-?\d+(\.\d{1,2})?$/),
  card: z.string().trim().min(1).max(80),
  closingDay: z.coerce.number().int().min(1).max(31),
  dueDay: z.coerce.number().int().min(1).max(31),
  limit: z.string().max(16).regex(/^$|^\d+(\.\d{1,2})?$/),
}).refine(data => data.currency === "USD" || ![data.bank, data.limit].some(s => s.includes(".")), {
  message: "Yen amounts must be whole numbers.",
});

function minor(raw: string, currency: "JPY" | "USD") {
  const [whole, cents = ""] = raw.split(".");
  const value = Number(currency === "JPY" ? whole : whole + cents.padEnd(2, "0"));
  if (!Number.isSafeInteger(value)) throw new Error("Amount exceeds the supported range");
  return value;
}

export async function finishSetup(db: Db, verifiedUid: string, data: z.infer<typeof setupForm>, demo: string | null) {
  const id = requireHousehold(verifiedUid);
  if (await accountHousehold(db, id)) return id;
  const reference = data.currency === "JPY" ? await fetchReferenceRate() : null;
  const bank = minor(data.bank, data.currency);
  const limit = data.limit ? minor(data.limit, data.currency) : null;
  return db.transaction(async tx => {
    // Concurrent and retried submissions converge on one household and one initial card.
    const [created] = await tx.insert(households).values({
      id, name: data.name, timeZone: data.timeZone, homeCurrency: data.currency, bankBalanceMinor: bank,
    }).onConflictDoNothing({ target: households.id }).returning({ id: households.id });
    if (!created) {
      if (await accountHousehold(tx, id)) return id;
      throw new Error("Household unavailable");
    }
    if (reference) await storeReferenceRate(tx, id, reference);
    const [owner] = await tx.insert(members).values({
      householdId: id, displayName: data.name, role: "owner", authUserId: verifiedUid,
    }).returning({ id: members.id });
    await tx.insert(users).values({ householdId: id, memberId: owner.id, authUserId: verifiedUid });
    await tx.insert(cards).values({
      householdId: id, memberId: owner.id, label: data.card, currency: data.currency,
      closingDay: data.closingDay, dueDay: data.dueDay, limitMinor: limit,
    });
    await tx.insert(paypalConnections).values({ householdId: id, memberId: owner.id, balanceCurrency: data.currency });
    if (demo) {
      const [old] = await tx.select({ id: households.id }).from(households)
        .where(and(eq(households.id, requireHousehold(demo)), eq(households.isDemo, true))).for("update");
      if (old) {
        await deleteHouseholdKey(tx, old.id);
        await removeHouseholdDocuments(tx, old.id);
        await tx.delete(households).where(and(eq(households.id, old.id), eq(households.isDemo, true)));
      }
    }
    return id;
  });
}

export async function deleteOwnedHousehold(db: Db, verifiedUid: string) {
  const id = requireHousehold(verifiedUid);
  return db.transaction(async tx => {
    const [owner] = await tx.select({ id: members.id }).from(users)
      .innerJoin(members, and(eq(members.id, users.memberId), eq(members.householdId, users.householdId)))
      .where(and(eq(users.householdId, id), eq(users.authUserId, verifiedUid), eq(members.role, "owner")));
    if (!owner) return false;
    const [household] = await tx.select({ id: households.id }).from(households)
      .where(and(eq(households.id, id), eq(households.isDemo, false))).for("update");
    if (!household) return false;
    await deleteHouseholdKey(tx, id);
    await removeHouseholdDocuments(tx, id);
    const rows = await tx.delete(households).where(and(eq(households.id, id), eq(households.isDemo, false))).returning({ id: households.id });
    return rows.length === 1;
  });
}
