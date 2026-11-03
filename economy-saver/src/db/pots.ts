// Pots (D43): money set aside with a reason. One function per job, called by the Plan form (confirmed rows) and by the
// agent's add_pot tool (pending rows, confirmed in To check). Money in a confirmed pot is not spendable: the engine
// starts the runway from cash less the pots (availableCash), so every write here ends with the runway observed.
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { InputError } from "./input-error";
import { recordEvent, requireHousehold, type Db } from "./household";
import { fromMinor, parseAmountMinor, parseMinor } from "./money";
import { observeRunway } from "./runway-events";
import { households, members, pots } from "./schema";
import { Currency } from "@/lib/catalogue/types";
import { minorMoney } from "@/lib/money/format";

export const potInput = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  target: z.string().trim().nullable().default(null), // plain number in the home currency
  targetDate: z.string().date().nullable().default(null),
  saved: z.string().trim().default("0"), // saved so far; zero is fine
  fillPct: z.string().trim().nullable().default(null), // share of each client payment, "25" or "12.5"
  memberId: z.string().uuid().nullable().default(null),
});

type PotInput = z.infer<typeof potInput>;
type Fields = { name: string; targetMinor: number | null; targetDate: string | null; savedMinor: number; fillBp: number | null; memberId: string | null };

/** "25" or "12.5" as basis points (2500, 1250); 0.01 to 100 percent. */
export function parseFillBp(text: string): number {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text.trim());
  const bp = match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : 0;
  if (bp < 1 || bp > 10_000) throw new InputError("Enter a share between 0.01 and 100 percent, such as 25");
  return bp;
}

export const percent = (bp: number) => String(bp / 100);

const blank = (value: string | null) => value === null || value === "" ? null : value;

function fieldsOf(data: PotInput, currency: string): Fields {
  const target = blank(data.target);
  const savedMinor = parseMinor(data.saved === "" ? "0" : data.saved, currency);
  if (savedMinor < 0) throw new InputError("The amount saved cannot be negative");
  if (blank(data.targetDate) !== null && target === null) throw new InputError("A target date needs a target amount");
  return {
    name: data.name,
    targetMinor: target === null ? null : parseAmountMinor(target, currency),
    targetDate: blank(data.targetDate),
    savedMinor,
    fillBp: blank(data.fillPct) === null ? null : parseFillBp(data.fillPct!),
    memberId: data.memberId,
  };
}

const same = (a: Fields, b: Fields) => a.name === b.name && a.targetMinor === b.targetMinor && a.targetDate === b.targetDate
  && a.savedMinor === b.savedMinor && a.fillBp === b.fillBp && a.memberId === b.memberId;

async function lockHousehold(tx: Db, hid: string) {
  const [household] = await tx.select({ id: households.id, currency: households.homeCurrency, previous: households.runwayShort })
    .from(households).where(eq(households.id, hid)).for("update");
  if (!household) throw new InputError("Household not found");
  return household;
}

function describe(f: Fields, currency: Currency) {
  const money = (minor: number | null) => minor === null ? "none" : minorMoney(minor, currency);
  return {
    saved: money(f.savedMinor), target: money(f.targetMinor), by: f.targetDate ?? "none",
    fill: f.fillBp === null ? "none" : percent(f.fillBp) + "%", name: f.name,
  };
}

/** The old and new value of every field that changed, for the event body: "Saved ¥10,000 → ¥15,000". */
function changes(before: Fields, after: Fields, currency: Currency): string {
  const [old, now] = [describe(before, currency), describe(after, currency)];
  const label = { name: "Name", saved: "Saved", target: "Target", by: "Target date", fill: "Set aside" } as const;
  return (Object.keys(label) as (keyof typeof label)[]).filter(key => old[key] !== now[key])
    .map(key => `${label[key]} ${old[key]} → ${now[key]}`).join("; ");
}

function addedEvent(tx: Db, hid: string, id: string, f: Fields, currency: string) {
  return recordEvent(tx, hid, {
    kind: "pot_added", title: `${f.name} pot added`,
    ...(f.savedMinor > 0 && { amount: { value: fromMinor(f.savedMinor, currency), currency } }),
    ref: { type: "pot", id },
  });
}

/**
 * Creates or edits a pot in the household's home currency. "confirmed" (the Plan form) counts at once and records a
 * `pot_added` event, or a `pot_updated` event with the old and new values when the id already names a confirmed pot;
 * "pending" (the agent and MCP) waits in To check until `confirmPending` and counts for nothing. Idempotent on `id`: the
 * same id with the same fields returns it again with no second event; a pending call with an id already in use by
 * different fields throws.
 */
export async function savePot(db: Db, householdId: string, input: PotInput, status: "confirmed" | "pending"): Promise<string> {
  const hid = requireHousehold(householdId);
  const data = potInput.parse(input);
  return db.transaction(async tx => {
    const household = await lockHousehold(tx, hid);
    const currency = Currency.parse(household.currency);
    const fields = fieldsOf(data, household.currency);
    if (fields.memberId) {
      const [member] = await tx.select({ id: members.id }).from(members).where(and(eq(members.householdId, hid), eq(members.id, fields.memberId)));
      if (!member) throw new InputError("Choose a member of this household");
    }
    const [existing] = await tx.select().from(pots).where(and(eq(pots.householdId, hid), eq(pots.id, data.id)));
    if (existing) {
      const before: Fields = { name: existing.name, targetMinor: existing.targetMinor, targetDate: existing.targetDate, savedMinor: existing.savedMinor, fillBp: existing.fillBp, memberId: existing.memberId };
      if (same(before, fields)) return data.id;
      if (status !== "confirmed" || existing.status !== "confirmed") throw new InputError("This pot identifier is already in use");
      if (household.previous === null) await observeRunway(tx, hid);
      await tx.update(pots).set(fields).where(and(eq(pots.householdId, hid), eq(pots.id, data.id)));
      await recordEvent(tx, hid, { kind: "pot_updated", title: `${fields.name} pot updated`, body: changes(before, fields, currency), ref: { type: "pot", id: data.id } });
      await observeRunway(tx, hid);
      return data.id;
    }
    if (status === "confirmed" && household.previous === null) await observeRunway(tx, hid);
    await tx.insert(pots).values({ id: data.id, householdId: hid, currency: household.currency, status, ...fields });
    if (status === "pending") {
      await recordEvent(tx, hid, { kind: "to_check", title: `${fields.name} pot to check`, ref: { type: "pot", id: data.id }, notify: true });
    } else {
      await addedEvent(tx, hid, data.id, fields, household.currency);
      await observeRunway(tx, hid);
    }
    return data.id;
  });
}

/** `confirmPending` for a pending pot: it counts from now on. False when nothing pending matches. The caller holds the household lock. */
export async function confirmPot(tx: Db, householdId: string, id: string): Promise<boolean> {
  const hid = requireHousehold(householdId);
  const [household] = await tx.select({ previous: households.runwayShort }).from(households).where(eq(households.id, hid));
  if (!household) return false;
  const pending = and(eq(pots.householdId, hid), eq(pots.id, id), eq(pots.status, "pending"));
  if (household.previous === null) {
    const [match] = await tx.select({ id: pots.id }).from(pots).where(pending);
    if (!match) return false;
    await observeRunway(tx, hid);
  }
  const [row] = await tx.update(pots).set({ status: "confirmed" }).where(pending).returning();
  if (!row) return false;
  await addedEvent(tx, hid, id, row, row.currency);
  await observeRunway(tx, hid);
  return true;
}

/** Removes a pot. Its money goes back to cash that can be spent. False when this household has no such pot. */
export async function removePot(db: Db, householdId: string, id: string): Promise<boolean> {
  const hid = requireHousehold(householdId);
  const potId = z.string().uuid().parse(id);
  return db.transaction(async tx => {
    const household = await lockHousehold(tx, hid);
    if (household.previous === null) await observeRunway(tx, hid);
    const [row] = await tx.delete(pots).where(and(eq(pots.householdId, hid), eq(pots.id, potId))).returning();
    if (!row) return false;
    await recordEvent(tx, hid, {
      kind: "pot_removed", title: `${row.name} pot removed`,
      ...(row.status === "confirmed" && row.savedMinor > 0 && { body: `${minorMoney(row.savedMinor, Currency.parse(row.currency))} is cash you can spend again`, amount: { value: fromMinor(row.savedMinor, row.currency), currency: row.currency } }),
      ref: { type: "pot", id: potId },
    });
    if (row.status === "confirmed") await observeRunway(tx, hid);
    return true;
  });
}

/**
 * A client payment of `creditedMinor` (in the household's home currency) has just been credited. Inside the caller's
 * transaction, adds round(credited × fill share) to every confirmed pot with a fill rule and records one event per pot,
 * such as "Set aside ¥15,000 for Tax (25% of Lumen Studio's payment)". The caller holds the household lock and observes
 * the runway after the credit, which covers these moves. Returns how many pots were filled.
 */
export async function fillPots(tx: Db, householdId: string, creditedMinor: number, sourceLabel: string): Promise<number> {
  const hid = requireHousehold(householdId);
  if (!Number.isSafeInteger(creditedMinor) || creditedMinor < 0) throw new Error("A credited amount must be a non-negative integer");
  if (creditedMinor === 0) return 0;
  const rules = await tx.select().from(pots)
    .where(and(eq(pots.householdId, hid), eq(pots.status, "confirmed"), isNotNull(pots.fillBp)))
    .orderBy(pots.createdAt, pots.name, pots.id);
  let filled = 0;
  for (const pot of rules) {
    const share = Number((BigInt(creditedMinor) * BigInt(pot.fillBp!) * BigInt(2) + BigInt(10_000)) / BigInt(20_000)); // half up, exact beyond 2^53
    if (share === 0) continue;
    await tx.update(pots).set({ savedMinor: sql`${pots.savedMinor} + ${share}` }).where(and(eq(pots.householdId, hid), eq(pots.id, pot.id)));
    await recordEvent(tx, hid, {
      kind: "pot_filled",
      title: `Set aside ${minorMoney(share, Currency.parse(pot.currency))} for ${pot.name} (${percent(pot.fillBp!)}% of ${sourceLabel})`,
      amount: { value: fromMinor(share, pot.currency), currency: pot.currency },
      ref: { type: "pot", id: pot.id },
    });
    filled += 1;
  }
  return filled;
}
