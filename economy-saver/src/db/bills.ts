import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { InputError } from "./input-error";
import { recordEvent, requireHousehold, type Db } from "./household";
import { fromMinor, parseAmountMinor } from "./money";
import { observeRunway } from "./runway-events";
import { bills, households, members } from "./schema";

export const billInput = z.object({
  id: z.string().uuid(),
  biller: z.string().trim().min(1).max(160),
  amount: z.string().trim(),
  due: z.string().date(),
  category: z.string().trim().min(1).max(100),
  memberId: z.string().uuid().nullable().default(null),
  monthly: z.boolean().default(false), // true: repeats every month on the due date's day (D41)
});

/**
 * Adds a bill in the household's home currency. "confirmed" counts in the forecast at once (forms);
 * "pending" waits in To check until `confirmPending` (the agent). `monthly` stores the due date's day of the month as
 * `repeat_day`; the bill expands into occurrences only once confirmed (D41). Idempotent on `id`: the same id with the same
 * fields returns it again without a second event, different fields throw.
 */
export async function insertBill(db: Db, householdId: string, input: z.infer<typeof billInput>, status: "confirmed" | "pending"): Promise<string> {
  const hid = requireHousehold(householdId);
  const data = billInput.parse(input);
  return db.transaction(async tx => {
    const [household] = await tx.select({ id: households.id, currency: households.homeCurrency, previous: households.runwayShort })
      .from(households).where(eq(households.id, hid)).for("update");
    if (!household) throw new InputError("Household not found");
    const amountMinor = parseAmountMinor(data.amount, household.currency);
    if (data.memberId) {
      const [member] = await tx.select({ id: members.id }).from(members).where(and(eq(members.householdId, hid), eq(members.id, data.memberId)));
      if (!member) throw new InputError("Choose a member of this household");
    }
    const repeatDay = data.monthly ? Number(data.due.slice(8, 10)) : null;
    const [existing] = await tx.select().from(bills).where(and(eq(bills.householdId, hid), eq(bills.id, data.id)));
    if (existing) {
      if (existing.biller !== data.biller || existing.amountMinor !== amountMinor || existing.due !== data.due
        || existing.category !== data.category || existing.memberId !== data.memberId || existing.repeatDay !== repeatDay) {
        throw new InputError("This bill identifier is already in use");
      }
      return data.id;
    }
    if (status === "confirmed" && household.previous === null) await observeRunway(tx, hid);
    await tx.insert(bills).values({
      id: data.id, householdId: hid, memberId: data.memberId, biller: data.biller, amountMinor,
      currency: household.currency, due: data.due, category: data.category, status, repeatDay,
    });
    if (status === "pending") {
      await recordEvent(tx, hid, { kind: "to_check", title: `${data.biller} bill to check`, ref: { type: "bill", id: data.id }, notify: true });
    } else {
      await recordEvent(tx, hid, {
        kind: "bill_added", title: `${data.biller} added`,
        amount: { value: fromMinor(amountMinor, household.currency), currency: household.currency }, ref: { type: "bill", id: data.id },
      });
      await observeRunway(tx, hid);
    }
    return data.id;
  });
}
