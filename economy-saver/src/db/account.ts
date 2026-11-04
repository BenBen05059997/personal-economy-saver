import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { fetchReferenceRate, storeReferenceRate } from "./reference-rate";
import { clockForHousehold } from "./clock";
import { type Db, requireHousehold } from "./household";
import { cards, households, members, paypalConnections, users } from "./schema";
import { deleteHouseholdKey } from "./ai-key";
import { removeHouseholdDocuments } from "./document-cleanup";
import { InputError } from "./input-error";
import { parseMinor } from "./money";

export async function householdClock(db: Db, id: string, now = new Date()) {
  const [household] = await db.select({ isDemo: households.isDemo, fixedToday: households.fixedToday, timeZone: households.timeZone })
    .from(households).where(eq(households.id, requireHousehold(id)));
  if (!household) throw new Error("Household no longer exists");
  return clockForHousehold(household, now);
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

const blank = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);
const currency = z.enum(["JPY", "USD"]);
export const setupForm = z.object({
  name: z.string().trim().min(1).max(80),
  timeZone: z.string().min(1).max(80).refine(zone => {
    try { new Intl.DateTimeFormat("en", { timeZone: zone }); return true; } catch { return false; }
  }),
  currency,
  bank: z.string().trim().min(1).max(16), // read by parseMinor: separators and full-width digits are fine; the limit and the decimals are checked there
  // D51: the card is optional. The label, closing day and payment day come together or not at all; a blank field counts as absent.
  card: z.preprocess(blank, z.string().trim().min(1).max(80).optional()),
  closingDay: z.preprocess(blank, z.coerce.number().int().min(1).max(31).optional()),
  dueDay: z.preprocess(blank, z.coerce.number().int().min(1).max(31).optional()),
  limit: z.string().trim().max(16).default(""),
}).refine(d => (d.card !== undefined) === (d.closingDay !== undefined) && (d.card !== undefined) === (d.dueDay !== undefined),
  { message: "A card needs a name, a closing day and a payment day. Fill all three or leave the card out.", path: ["card"] });

type Setup = z.output<typeof setupForm>;

/**
 * The one function that creates a household from the setup form (D39, D47): the household, its owner, the optional card and the
 * PayPal connection row. Onboarding passes the verified uid as the id and as `authUserId` (the owner then also gets a
 * users row) and may name the visitor's demo household to delete; the blank start passes a fresh id, `isDemo` and no
 * auth user. Concurrent and retried submissions with the same id converge on one household.
 */
export async function createHousehold(db: Db, id: string, data: Setup, opts: { isDemo: boolean; authUserId?: string; replaceDemo?: string | null }) {
  requireHousehold(id);
  const reference = data.currency === "JPY" ? await fetchReferenceRate() : null;
  const bank = parseMinor(data.bank, data.currency);
  const limit = data.limit ? parseMinor(data.limit, data.currency) : null;
  if (limit !== null && limit < 0) throw new InputError("Credit limit cannot be negative");
  return db.transaction(async tx => {
    const [created] = await tx.insert(households).values({
      id, name: data.name, timeZone: data.timeZone, homeCurrency: data.currency, bankBalanceMinor: bank, isDemo: opts.isDemo, nudgeAfterDays: 3, // D51: the nudge rule is on for a new household; fixedToday stays null (the real date)

    }).onConflictDoNothing({ target: households.id }).returning({ id: households.id });
    if (!created) {
      if (opts.authUserId && await accountHousehold(tx, id)) return id;
      throw new Error("Household unavailable");
    }
    if (reference) await storeReferenceRate(tx, id, reference);
    const [owner] = await tx.insert(members).values({
      householdId: id, displayName: data.name, role: "owner", shareBp: 10_000, authUserId: opts.authUserId ?? null,
    }).returning({ id: members.id });
    if (opts.authUserId) await tx.insert(users).values({ householdId: id, memberId: owner.id, authUserId: opts.authUserId });
    if (data.card !== undefined && data.closingDay !== undefined && data.dueDay !== undefined) {
      await tx.insert(cards).values({
        householdId: id, memberId: owner.id, label: data.card, currency: data.currency,
        closingDay: data.closingDay, dueDay: data.dueDay, limitMinor: limit,
      });
    }
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
  if (await accountHousehold(db, id)) return id;
  return createHousehold(db, id, data, { isDemo: false, authUserId: verifiedUid, replaceDemo: demo });
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
