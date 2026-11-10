import { seedGeneralSpace } from "./spaces";
import { seedRules } from "./rules";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { fetchReferenceRate, storeReferenceRate } from "./reference-rate";
import { clockForHousehold } from "./clock";
import { type Db, requireHousehold } from "./household";
import { households, members, paypalConnections, users } from "./schema";
import { deleteHouseholdKey } from "./ai-key";
import { removeHouseholdDocuments } from "./document-cleanup";

export async function householdClock(db: Db, id: string, now = new Date()) {
  const [household] = await db.select({ isDemo: households.isDemo, fixedToday: households.fixedToday, timeZone: households.timeZone, currency: households.homeCurrency })
    .from(households).where(eq(households.id, requireHousehold(id)));
  if (!household) throw new Error("Household no longer exists");
  return { ...clockForHousehold(household, now), currency: household.currency };
}

export async function householdDate(db: Db, id: string, now?: Date) {
  return (await householdClock(db, id, now)).today;
}

/** Resolve a verified login to its one household and role. The verified auth uid is the routing key here. */
export async function accountMembership(db: Db, verifiedUid: string) {
  const [membership] = await db.select({ householdId: users.householdId, memberId: users.memberId, role: members.role }).from(users)
    .innerJoin(members, and(eq(members.householdId, users.householdId), eq(members.id, users.memberId)))
    .where(eq(users.authUserId, requireHousehold(verifiedUid)));
  return membership ?? null;
}

export async function accountHousehold(db: Db, verifiedUid: string) {
  return (await accountMembership(db, verifiedUid))?.householdId ?? null;
}

const currency = z.enum(["JPY", "USD"]);
export const setupForm = z.object({
  name: z.string().trim().min(1).max(80),
  timeZone: z.string().min(1).max(80).refine(zone => {
    try { new Intl.DateTimeFormat("en", { timeZone: zone }); return true; } catch { return false; }
  }),
  currency,
});

type Setup = z.output<typeof setupForm>;

/**
 * The one function that creates a household from the setup form (D39, D47): the household, its owner and the
 * PayPal connection row. Onboarding passes the verified uid as the id and as `authUserId` (the owner then also gets a
 * users row) and may name the visitor's demo household to delete; the blank start passes a fresh id, `isDemo` and no
 * auth user. Concurrent and retried submissions with the same id converge on one household.
 */
export async function createHousehold(db: Db, id: string, data: Setup, opts: { isDemo: boolean; authUserId?: string; replaceDemo?: string | null }) {
  requireHousehold(id);
  const reference = data.currency === "JPY" ? await fetchReferenceRate() : null;
  return db.transaction(async tx => {
    const [created] = await tx.insert(households).values({
      id, name: data.name, timeZone: data.timeZone, homeCurrency: data.currency, bankBalanceMinor: 0, isDemo: opts.isDemo,

    }).onConflictDoNothing({ target: households.id }).returning({ id: households.id });
    if (!created) {
      if (opts.authUserId) {
        const current = await accountHousehold(tx, opts.authUserId);
        if (current) return current;
      }
      throw new Error("Household unavailable");
    }
    await seedRules(tx, id);
    await seedGeneralSpace(tx, id);
    if (reference) await storeReferenceRate(tx, id, reference);
    const [owner] = await tx.insert(members).values({
      householdId: id, displayName: data.name, role: "owner", shareBp: 10_000, authUserId: opts.authUserId ?? null,
    }).returning({ id: members.id });
    if (opts.authUserId) await tx.insert(users).values({ householdId: id, memberId: owner.id, authUserId: opts.authUserId });
    await tx.insert(paypalConnections).values({ householdId: id, memberId: owner.id, balanceCurrency: data.currency });
    if (opts.replaceDemo) {
      const [old] = await tx.select({ id: households.id }).from(households)
        .where(and(eq(households.id, requireHousehold(opts.replaceDemo)), eq(households.isDemo, true))).for("update");
      if (old) {
        await deleteHouseholdKey(tx, old.id);
        await removeHouseholdDocuments(tx, old.id);
        await tx.delete(households).where(and(eq(households.id, old.id), eq(households.isDemo, true)));
      }
    }
    return id;
  });
}

export async function finishSetup(db: Db, verifiedUid: string, data: Setup, demo: string | null) {
  const id = requireHousehold(verifiedUid);
  const current = await accountHousehold(db, id);
  if (current) return current;
  return createHousehold(db, id, data, { isDemo: false, authUserId: verifiedUid, replaceDemo: demo });
}

export async function deleteOwnedHousehold(db: Db, verifiedUid: string) {
  return db.transaction(async tx => {
    const owner = await accountMembership(tx, verifiedUid);
    if (owner?.role !== "owner") return false;
    const id = owner.householdId;
    const [household] = await tx.select({ id: households.id }).from(households)
      .where(and(eq(households.id, id), eq(households.isDemo, false))).for("update");
    if (!household) return false;
    await deleteHouseholdKey(tx, id);
    await removeHouseholdDocuments(tx, id);
    const rows = await tx.delete(households).where(and(eq(households.id, id), eq(households.isDemo, false))).returning({ id: households.id });
    return rows.length === 1;
  });
}
