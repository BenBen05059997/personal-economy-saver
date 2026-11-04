import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { InputError } from "./input-error";
import { recordEvent, requireHousehold, type Db, type Maker } from "./household";
import { fromMinor, parseAmountMinor } from "./money";
import { Currency } from "@/lib/catalogue/types";
import { dayLabel, minorMoney } from "@/lib/money/format";
import { observeRunway } from "./runway-events";
import { clockForHousehold } from "./clock";
import { HORIZON_MESSAGE, latestDate } from "@/lib/money/horizon";
import { occurrenceDates, RepeatUnitSchema } from "@/lib/money/repeat";
import type { RepeatUnit } from "@/lib/money/types";
import { memberCount } from "./people";
import { BusinessBp, CategoryKeySchema } from "@/lib/money/categories";
import { bills, households, members } from "./schema";

/** "Nov 25", or "Jan 1, 2030" when the due date is in another year than today. */
export function dueLabel(due: string, today: string) {
  return dayLabel(due) + (due.slice(0, 4) === today.slice(0, 4) ? "" : `, ${due.slice(0, 4)}`);
}

export const billInput = z.object({
  id: z.string().uuid(),
  biller: z.string().trim().min(1).max(160),
  amount: z.string().trim(),
  due: z.string().date(),
  category: CategoryKeySchema, // D46: a key from lib/money/categories.ts
  businessBp: BusinessBp.default(0), // D46: business share in basis points
  memberId: z.string().uuid().nullable().default(null), // null = shared
  paidByMemberId: z.string().uuid().nullable().default(null), // D45: who pays a shared bill, for every occurrence; needs memberId null and two or more members
  repeat: RepeatUnitSchema.nullable().default(null), // D48: month = every month on the due date's day (D41), year = every year on its month and day; null = one-off
  nextAmount: z.string().trim().nullable().default(null), // D48: the amount from nextAmountFrom on; needs a repeat
  nextAmountFrom: z.string().date().nullable().default(null), // after the due date
  cancelBy: z.string().date().nullable().default(null), // D48: information only; before the next occurrence
});

/** What a bill's schedule is, in minor units of its own currency: shared by the typed-in bill and the reader's review. */
export type BillSchedule = { repeat: RepeatUnit | null; nextAmountMinor: number | null; nextAmountFrom: string | null; cancelBy: string | null };

/** The day of the month a monthly bill repeats on: its due date's day; null for any other bill. */
export const repeatDayFor = (due: string, repeat: RepeatUnit | null) => (repeat === "month" ? Number(due.slice(8, 10)) : null);

/** Refuses a schedule that does not hang together (D48), in words. `today` is the household's own date. */
export function checkSchedule(due: string, today: string, schedule: BillSchedule) {
  const { repeat, nextAmountMinor, nextAmountFrom, cancelBy } = schedule;
  const latest = latestDate(today);
  if ((nextAmountMinor === null) !== (nextAmountFrom === null)) throw new InputError("Give the new amount together with the date it starts");
  if (nextAmountFrom !== null) {
    if (repeat === null) throw new InputError("A new amount needs a bill that repeats: choose Every month or Every year");
    if (nextAmountFrom <= due) throw new InputError("The new amount must start after the due date");
    if (nextAmountFrom > latest) throw new InputError(HORIZON_MESSAGE);
  }
  if (cancelBy !== null) {
    if (cancelBy > latest) throw new InputError(HORIZON_MESSAGE);
    const next = repeat === null ? due : occurrenceDates(due, repeat, repeatDayFor(due, repeat), today, latest)[0] ?? due;
    if (cancelBy >= next) throw new InputError(`Choose a cancel-by date before the bill is next charged on ${dueLabel(next, today)}`);
  }
}

/** Activity's words for what a bill repeats and carries, "Every year · Changes to ¥12,000 from Dec 1, 2027 · Cancel by Nov 20"; empty for a plain one. */
export function scheduleWords(schedule: BillSchedule, currency: Currency, today: string): string[] {
  return [
    ...(schedule.repeat === "year" ? ["Every year"] : []),
    ...(schedule.nextAmountMinor !== null && schedule.nextAmountFrom !== null ? [`Changes to ${minorMoney(schedule.nextAmountMinor, currency)} from ${dueLabel(schedule.nextAmountFrom, today)}`] : []),
    ...(schedule.cancelBy !== null ? [`Cancel by ${dueLabel(schedule.cancelBy, today)}`] : []),
  ];
}

/**
 * Adds a bill in the household's home currency. "confirmed" counts in the forecast at once (forms);
 * "pending" waits in To check until `confirmPending` (the agent). `repeat` "month" stores the due date's day of the month as
 * `repeat_day`, "year" repeats on the due date's month and day; the bill expands into occurrences only once confirmed (D41, D48).
 * `nextAmount` from `nextAmountFrom` changes what later occurrences cost; `cancelBy` is a date to act by, information only.
 * Idempotent on `id`: the same id with the same
 * fields returns it again without a second event, different fields throw. A shared bill (no member) may name who pays it
 * (`paidByMemberId`, D45): it then counts in who owes whom.
 */
export async function insertBill(db: Db, householdId: string, input: z.infer<typeof billInput>, status: "confirmed" | "pending", by: Maker): Promise<string> {
  const hid = requireHousehold(householdId);
  const data = billInput.parse(input);
  return db.transaction(async tx => {
    const [household] = await tx.select({ id: households.id, currency: households.homeCurrency, previous: households.runwayShort, isDemo: households.isDemo, fixedToday: households.fixedToday, timeZone: households.timeZone })
      .from(households).where(eq(households.id, hid)).for("update");
    if (!household) throw new InputError("Household not found");
    const amountMinor = parseAmountMinor(data.amount, household.currency);
    if (data.memberId) {
      const [member] = await tx.select({ id: members.id }).from(members).where(and(eq(members.householdId, hid), eq(members.id, data.memberId)));
      if (!member) throw new InputError("Choose a member of this household");
    }
    let paidByName: string | null = null;
    if (data.paidByMemberId) {
      if (data.memberId) throw new InputError("A bill with an owner is not split; choose Shared to say who pays it");
      if (await memberCount(tx, hid) < 2) throw new InputError("Splitting a bill needs a second person; add one in Settings, People");
      const [payer] = await tx.select({ name: members.displayName }).from(members).where(and(eq(members.householdId, hid), eq(members.id, data.paidByMemberId)));
      if (!payer) throw new InputError("Choose a member of this household to pay the bill");
      paidByName = payer.name;
    }
    const repeatDay = repeatDayFor(data.due, data.repeat);
    const schedule: BillSchedule = {
      repeat: data.repeat, nextAmountMinor: data.nextAmount === null ? null : parseAmountMinor(data.nextAmount, household.currency),
      nextAmountFrom: data.nextAmountFrom, cancelBy: data.cancelBy,
    };
    const [existing] = await tx.select().from(bills).where(and(eq(bills.householdId, hid), eq(bills.id, data.id)));
    if (existing) {
      if (existing.biller !== data.biller || existing.amountMinor !== amountMinor || existing.due !== data.due
        || existing.category !== data.category || existing.businessBp !== data.businessBp || existing.memberId !== data.memberId || existing.repeatDay !== repeatDay
        || existing.repeatUnit !== data.repeat || existing.nextAmountMinor !== schedule.nextAmountMinor || existing.nextAmountFrom !== data.nextAmountFrom || existing.cancelBy !== data.cancelBy
        || existing.paidByMemberId !== data.paidByMemberId) {
        throw new InputError("This bill identifier is already in use");
      }
      return data.id;
    }
    const { today } = clockForHousehold(household);
    if (data.due > latestDate(today)) throw new InputError(HORIZON_MESSAGE);
    checkSchedule(data.due, today, schedule);
    if (status === "confirmed" && household.previous === null) await observeRunway(tx, hid);
    await tx.insert(bills).values({
      id: data.id, householdId: hid, memberId: data.memberId, paidByMemberId: data.paidByMemberId, biller: data.biller, amountMinor,
      currency: household.currency, due: data.due, category: data.category, businessBp: data.businessBp, status, repeatDay,
      repeatUnit: data.repeat, nextAmountMinor: schedule.nextAmountMinor, nextAmountFrom: data.nextAmountFrom, cancelBy: data.cancelBy,
      madeBy: by.madeBy, askId: by.askId ?? null,
    });
    if (status === "pending") {
      await recordEvent(tx, hid, { ...by, kind: "to_check", title: `${data.biller} bill to check`, ref: { type: "bill", id: data.id }, notify: true });
    } else {
      const body = [...(paidByName ? [`Shared, paid by ${paidByName}`] : []), ...scheduleWords(schedule, Currency.parse(household.currency), today)];
      await recordEvent(tx, hid, {
        kind: "bill_added", ...by, title: `${data.biller} added, due ${dueLabel(data.due, today)}`,
        ...(body.length > 0 && { body: body.join(" · ") }),
        amount: { value: fromMinor(amountMinor, household.currency), currency: household.currency }, ref: { type: "bill", id: data.id },
      });
      await observeRunway(tx, hid);
    }
    return data.id;
  });
}

/**
 * Removes a bill of this household, a confirmed one or one still waiting in To check, and records a `bill_removed` event
 * ("Removed bill Rent ¥82,000"). A repeating bill is one stored row, so it goes as a whole series, every past and future
 * occurrence with it. Settlements already recorded stay as they are; the split simply recounts from the rows left.
 * False when this household has no such bill.
 */
export async function removeBill(db: Db, householdId: string, id: string): Promise<boolean> {
  const hid = requireHousehold(householdId);
  const billId = z.string().uuid().parse(id);
  return db.transaction(async tx => {
    const [household] = await tx.select({ id: households.id, previous: households.runwayShort }).from(households).where(eq(households.id, hid)).for("update");
    if (!household) throw new InputError("Household not found");
    if (household.previous === null) await observeRunway(tx, hid);
    const [row] = await tx.delete(bills).where(and(eq(bills.householdId, hid), eq(bills.id, billId))).returning();
    if (!row) return false;
    await recordEvent(tx, hid, { madeBy: "form",
      kind: "bill_removed", title: `Removed bill ${row.biller} ${minorMoney(row.amountMinor, Currency.parse(row.currency))}`,
      ...(row.repeatUnit !== null && { body: `Every ${row.repeatUnit}, so every occurrence is gone` }),
      amount: { value: fromMinor(row.amountMinor, row.currency), currency: row.currency }, ref: { type: "bill", id: billId },
    });
    if (row.status === "confirmed") await observeRunway(tx, hid);
    return true;
  });
}
