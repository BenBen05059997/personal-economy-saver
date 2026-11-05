import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { InputError } from "./input-error";
import { recordEvent, requireHousehold, type Db, type Maker } from "./household";
import { fromMinor, parseAmountMinor } from "./money";
import { Currency } from "@/lib/catalogue/types";
import { dayLabel, minorMoney, repeatWords } from "@/lib/money/format";
import { observeRunway } from "./runway-events";
import { clockForHousehold } from "./clock";
import { HORIZON_MESSAGE, latestDate } from "@/lib/money/horizon";
import { amountOn, nextAmountOf, nextOccurrenceAfter, occurrenceDates, RepeatUnitSchema } from "@/lib/money/repeat";
import type { RepeatUnit } from "@/lib/money/types";
import { memberCount } from "./people";
import { BusinessBp, CategoryKeySchema, categoryLabel, type CategoryKey } from "@/lib/money/categories";
import { monthName } from "@/lib/money/spending";
import { linkPreview, occurrenceInMonth, seriesToJoin, type LinkPreview, type VariesSeries } from "@/lib/money/varies";
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
  amountVaries: z.boolean().default(false), // D54: a monthly bill forecast from its own past; needs repeat "month" and no next amount
});

/** What a bill's schedule is, in minor units of its own currency: shared by the typed-in bill and the reader's review. */
export type BillSchedule = { repeat: RepeatUnit | null; nextAmountMinor: number | null; nextAmountFrom: string | null; cancelBy: string | null; amountVaries: boolean };

/** The day of the month a monthly bill repeats on: its due date's day; null for any other bill. */
export const repeatDayFor = (due: string, repeat: RepeatUnit | null) => (repeat === "month" ? Number(due.slice(8, 10)) : null);

/** Refuses a schedule that does not hang together (D48), in words. `today` is the household's own date. */
export function checkSchedule(due: string, today: string, schedule: BillSchedule) {
  const { repeat, nextAmountMinor, nextAmountFrom, cancelBy, amountVaries } = schedule;
  const latest = latestDate(today);
  if (amountVaries && repeat !== "month") throw new InputError("Only a bill that repeats every month can have an amount that changes every month");
  if (amountVaries && nextAmountMinor !== null) throw new InputError("A bill whose amount changes every month is forecast from its own past: leave the new amount empty");
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
  const change = nextAmountOf(schedule);
  return [
    ...(schedule.repeat === "year" ? [repeatWords("year")] : []),
    ...(schedule.amountVaries ? ["Amount varies every month"] : []),
    ...(change ? [`Changes to ${minorMoney(change.amount, currency)} from ${dueLabel(change.from, today)}`] : []),
    ...(schedule.cancelBy !== null ? [`Cancel by ${dueLabel(schedule.cancelBy, today)}`] : []),
  ];
}

/**
 * Checks whose a bill is (D45): an owner of this household, or shared and paid by one of them. Returns the names for Activity.
 * `storedPayer` is the payer an edited bill already has: keeping it needs no second person (a household left with one person
 * after a removal keeps its payer, which counts again once someone joins).
 */
async function checkWhose(tx: Db, hid: string, memberId: string | null, paidByMemberId: string | null, storedPayer: string | null = null): Promise<{ ownerName: string | null; paidByName: string | null }> {
  let ownerName: string | null = null;
  if (memberId) {
    const [member] = await tx.select({ name: members.displayName }).from(members).where(and(eq(members.householdId, hid), eq(members.id, memberId)));
    if (!member) throw new InputError("Choose a member of this household");
    ownerName = member.name;
  }
  let paidByName: string | null = null;
  if (paidByMemberId) {
    if (memberId) throw new InputError("A bill with an owner is not split; choose Shared to say who pays it");
    if (paidByMemberId !== storedPayer && await memberCount(tx, hid) < 2) throw new InputError("Splitting a bill needs a second person; add one in Settings, People");
    const [payer] = await tx.select({ name: members.displayName }).from(members).where(and(eq(members.householdId, hid), eq(members.id, paidByMemberId)));
    if (!payer) throw new InputError("Choose a member of this household to pay the bill");
    paidByName = payer.name;
  }
  return { ownerName, paidByName };
}

/**
 * Adds a bill in the household's home currency. "confirmed" counts in the forecast at once (forms);
 * "pending" waits in To check until `confirmPending` (the agent). `repeat` "month" stores the due date's day of the month as
 * `repeat_day`, "year" repeats on the due date's month and day; the bill expands into occurrences only once confirmed (D41, D48).
 * `nextAmount` from `nextAmountFrom` changes what later occurrences cost; `cancelBy` is a date to act by, information only.
 * Idempotent on `id`: the same id with the same
 * fields returns it again without a second event, different fields throw. A shared bill (no member) may name who pays it
 * (`paidByMemberId`, D45): it then counts in who owes whom. `amountVaries` (D54) marks a monthly bill forecast from its own
 * past; a confirmed one-off joins its series through `linkToSeries`, said in its Activity event.
 */
export async function insertBill(db: Db, householdId: string, input: z.input<typeof billInput>, status: "confirmed" | "pending", by: Maker): Promise<string> {
  const hid = requireHousehold(householdId);
  const data = billInput.parse(input);
  return db.transaction(async tx => {
    const [household] = await tx.select({ id: households.id, currency: households.homeCurrency, previous: households.runwayShort, isDemo: households.isDemo, fixedToday: households.fixedToday, timeZone: households.timeZone })
      .from(households).where(eq(households.id, hid)).for("update");
    if (!household) throw new InputError("Household not found");
    const amountMinor = parseAmountMinor(data.amount, household.currency);
    const { paidByName } = await checkWhose(tx, hid, data.memberId, data.paidByMemberId);
    const repeatDay = repeatDayFor(data.due, data.repeat);
    const schedule: BillSchedule = {
      repeat: data.repeat, nextAmountMinor: data.nextAmount === null ? null : parseAmountMinor(data.nextAmount, household.currency),
      nextAmountFrom: data.nextAmountFrom, cancelBy: data.cancelBy, amountVaries: data.amountVaries,
    };
    const [existing] = await tx.select().from(bills).where(and(eq(bills.householdId, hid), eq(bills.id, data.id)));
    if (existing) {
      if (existing.biller !== data.biller || existing.amountMinor !== amountMinor || existing.due !== data.due
        || existing.category !== data.category || existing.businessBp !== data.businessBp || existing.memberId !== data.memberId || existing.repeatDay !== repeatDay
        || existing.repeatUnit !== data.repeat || existing.nextAmountMinor !== schedule.nextAmountMinor || existing.nextAmountFrom !== data.nextAmountFrom || existing.cancelBy !== data.cancelBy
        || existing.paidByMemberId !== data.paidByMemberId || existing.amountVaries !== data.amountVaries) {
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
      repeatUnit: data.repeat, nextAmountMinor: schedule.nextAmountMinor, nextAmountFrom: data.nextAmountFrom, cancelBy: data.cancelBy, amountVaries: data.amountVaries,
      madeBy: by.madeBy, askId: by.askId ?? null,
    });
    if (status === "pending") {
      await recordEvent(tx, hid, { ...by, kind: "to_check", title: `${data.biller} bill to check`, ref: { type: "bill", id: data.id }, notify: true });
    } else {
      const linked = await linkToSeries(tx, hid, data.id);
      const body = [...(paidByName ? [`Shared, paid by ${paidByName}`] : []), ...scheduleWords(schedule, Currency.parse(household.currency), today), ...(linked ? [linked] : [])];
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

/** "November", or "November 2027" when the month is in another year than today. */
const monthWords = (date: string, today: string) => monthName(date.slice(0, 7)) + (date.slice(0, 4) === today.slice(0, 4) ? "" : ` ${date.slice(0, 4)}`);

/** Activity's words for a real bill joining its series (D54): "Linked to Tokyo Gas: replaces November's estimate". */
function linkWords(series: VariesSeries, due: string, today: string) {
  return occurrenceInMonth(series, due) === null ? `Linked to ${series.biller}: counts toward its estimate` : `Linked to ${series.biller}: replaces ${monthWords(due, today)}’s estimate`;
}

/**
 * This household's confirmed amount-varies monthly bills in `category`, as `seriesToJoin` reads them (with their stored amounts),
 * and their confirmed linked real bills other than `except`. Bills are stored in the household's currency, so minor units add up.
 */
async function variesSeries(tx: Db, hid: string, category: CategoryKey, except: string | null) {
  const rows = await tx.select({ id: bills.id, biller: bills.biller, due: bills.due, repeatDay: bills.repeatDay, amountMinor: bills.amountMinor }).from(bills)
    .where(and(eq(bills.householdId, hid), eq(bills.amountVaries, true), eq(bills.status, "confirmed"), eq(bills.category, category)));
  const series = rows.map((r): VariesSeries & { storedMinor: number } => {
    if (r.repeatDay === null) throw new Error("An amount-varies bill repeats every month and has its day");
    return { id: r.id, biller: r.biller, category, due: r.due, repeatDay: r.repeatDay, storedMinor: r.amountMinor };
  });
  const takenRows = series.length === 0 ? [] : await tx.select({ seriesBillId: bills.seriesBillId, due: bills.due, amountMinor: bills.amountMinor }).from(bills)
    .where(and(eq(bills.householdId, hid), eq(bills.status, "confirmed"), inArray(bills.seriesBillId, series.map(r => r.id)), ...(except === null ? [] : [ne(bills.id, except)])));
  return { series, taken: takenRows.flatMap(r => (r.seriesBillId === null ? [] : [{ seriesBillId: r.seriesBillId, due: r.due, amountMinor: r.amountMinor }])) };
}

/**
 * D54, for the reader's review card: the series a one-off bill read as `bill` would join if confirmed as it is, the month and the
 * estimate it replaces there (`linkPreview`); null when it would not link. Reads this household's bills only; changes nothing.
 */
export async function previewLink(db: Db, householdId: string, bill: { biller: string; category: CategoryKey; due: string }): Promise<LinkPreview | null> {
  const hid = requireHousehold(householdId);
  const { series, taken } = await variesSeries(db, hid, bill.category, null);
  return linkPreview(series, taken, bill);
}

/**
 * D54: links a confirmed one-off bill of this household to its amount-varies series when `seriesToJoin` finds exactly one (same
 * name key and category, no real bill of that series in the same month yet), so it replaces that month's estimate. Returns the
 * words for the bill's Activity event, or null when nothing was linked (not found, not a confirmed one-off, already linked, no
 * series). Runs inside the caller's transaction: the form's insert, the To check confirm and the reader's confirm.
 */
export async function linkToSeries(db: Db, householdId: string, billId: string): Promise<string | null> {
  const hid = requireHousehold(householdId);
  const id = z.string().uuid().parse(billId);
  const [row] = await db.select({ bill: bills, isDemo: households.isDemo, fixedToday: households.fixedToday, timeZone: households.timeZone }).from(bills)
    .innerJoin(households, eq(households.id, bills.householdId)).where(and(eq(bills.householdId, hid), eq(bills.id, id)));
  if (!row || row.bill.status !== "confirmed" || row.bill.repeatUnit !== null || row.bill.seriesBillId !== null) return null;
  const category = CategoryKeySchema.parse(row.bill.category);
  const { series, taken } = await variesSeries(db, hid, category, id);
  const match = seriesToJoin(series, taken, { biller: row.bill.biller, category, due: row.bill.due });
  if (match === null) return null;
  await db.update(bills).set({ seriesBillId: match.id }).where(and(eq(bills.householdId, hid), eq(bills.id, id)));
  return linkWords(match, row.bill.due, clockForHousehold(row).today);
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

/**
 * What Settings → Bills → Edit sends: the same fields as `billInput` for what it can change (name, amount, due date, category,
 * business share, whose and who pays, the last day to cancel), plus `amountFrom` for a repeating bill: the occurrence the new amount starts at.
 */
export const billEditInput = billInput.pick({ id: true, biller: true, amount: true, due: true, category: true, businessBp: true, memberId: true, paidByMemberId: true })
  .extend({
    amountFrom: z.string().date().nullable().default(null),
    amountVaries: z.boolean().optional(), // D54, a monthly bill: absent = unchanged
    seriesBillId: z.string().uuid().nullable().optional(), // D54, a one-off: the amount-varies series it is part of; null = none, absent = unchanged
    cancelBy: z.string().date().nullable().optional(), // D48: the last day to cancel; null = none, absent = unchanged
  });

const bpWords = (bp: number) => (bp === 0 ? "personal" : bp === 10_000 ? "work" : `${bp / 100}% work`);

/**
 * Edits a confirmed bill of this household from Settings and records one `bill_changed` event saying what changed
 * ("Amount ¥1,200 → ¥980 from Dec 1 · Category Other → Food"); saving the same values records nothing. Name, category,
 * business share, whose and who pays change the whole series (a repeating bill is one row). The amount:
 * - a one-off bill: the stored amount.
 * - a repeating bill: from `amountFrom` (empty = the next due date on or after today) on, through the D48 next-amount
 *   mechanism. From the first due date or earlier the stored amount itself changes (every occurrence, as a typo fix);
 *   later, the bill's one scheduled change becomes the new amount from that date, replacing a later scheduled change.
 *   A bill already scheduled to change before `amountFrom` cannot hold a second change, so that is refused in words.
 * D54: `amountVaries` turns "amount changes every month" on or off for a monthly bill (off unlinks its real bills; on refuses a bill
 * with a scheduled change); while on, the amount is the stored one, the estimate before any real bill, and has no date. `seriesBillId`
 * links a one-off to an amount-varies series of this household with the same category (null unlinks), at most one real bill per
 * month; a linked bill keeps the series' category.
 * A bill waiting in To check is corrected there, not here. False when this household has no such bill.
 */
export async function updateBill(db: Db, householdId: string, input: z.infer<typeof billEditInput>, by: Maker): Promise<boolean> {
  const hid = requireHousehold(householdId);
  const data = billEditInput.parse(input);
  return db.transaction(async tx => {
    const [household] = await tx.select({ id: households.id, currency: households.homeCurrency, previous: households.runwayShort, isDemo: households.isDemo, fixedToday: households.fixedToday, timeZone: households.timeZone })
      .from(households).where(eq(households.id, hid)).for("update");
    if (!household) throw new InputError("Household not found");
    const [bill] = await tx.select().from(bills).where(and(eq(bills.householdId, hid), eq(bills.id, data.id))).for("update");
    if (!bill) return false;
    if (bill.status !== "confirmed") throw new InputError("This bill is waiting in To check; correct it there");
    const currency = Currency.parse(bill.currency);
    const money = (minor: number) => minorMoney(minor, currency);
    const amountMinor = parseAmountMinor(data.amount, bill.currency);
    const { ownerName, paidByName } = await checkWhose(tx, hid, data.memberId, data.paidByMemberId, bill.paidByMemberId);
    const { today } = clockForHousehold(household);
    if (data.due > latestDate(today)) throw new InputError(HORIZON_MESSAGE);
    const repeat = bill.repeatUnit === null ? null : RepeatUnitSchema.parse(bill.repeatUnit);
    const repeatDay = repeatDayFor(data.due, repeat);
    const parts: string[] = [];
    if (bill.biller !== data.biller) parts.push(`Name ${bill.biller} → ${data.biller}`);
    if (bill.due !== data.due) parts.push(`${repeat === null ? "Due" : "Starts"} ${dueLabel(bill.due, today)} → ${dueLabel(data.due, today)}`);
    let base = bill.amountMinor;
    let next = nextAmountOf(bill);
    const varies = data.amountVaries ?? bill.amountVaries;
    if (varies && !bill.amountVaries && next !== null) {
      throw new InputError(`This bill already changes to ${money(next.amount)} from ${dueLabel(next.from, today)}; give it one amount from its first due date before marking it as changing every month`);
    }
    if (repeat === null || varies) {
      if (amountMinor !== base) parts.push(`Amount ${money(base)} → ${money(amountMinor)}`);
      base = amountMinor;
    } else {
      const from = data.amountFrom ?? nextOccurrenceAfter({ due: data.due, repeatUnit: repeat, repeatDay: repeatDay ?? undefined }, bumpDay(today, -1)) ?? data.due;
      if (from > latestDate(today)) throw new InputError(HORIZON_MESSAGE);
      const before = amountOn(base, next, from);
      if (amountMinor !== before) {
        if (from <= data.due) {
          base = amountMinor;
          parts.push(`Amount ${money(before)} → ${money(amountMinor)} from the first due date`);
        } else if (next !== null && next.from < from) {
          throw new InputError(`This bill already changes to ${money(next.amount)} from ${dueLabel(next.from, today)}; choose that date or an earlier one for the new amount`);
        } else {
          if (next !== null && next.from > from) parts.push(`The change to ${money(next.amount)} from ${dueLabel(next.from, today)} is replaced`);
          next = amountMinor === base ? null : { amount: amountMinor, from };
          parts.push(`Amount ${money(before)} → ${money(amountMinor)} from ${dueLabel(from, today)}`);
        }
      }
    }
    if (varies !== bill.amountVaries) parts.push(varies ? "Amount varies every month" : "Amount no longer varies");
    const series = data.seriesBillId === undefined ? bill.seriesBillId : data.seriesBillId;
    const seriesWords = await checkSeries(tx, hid, { id: data.id, repeat, due: data.due, category: data.category }, series, bill.seriesBillId, today);
    if (series !== bill.seriesBillId) parts.push(seriesWords ?? `No longer part of ${await billerOf(tx, hid, bill.seriesBillId!)}`);
    if (bill.category !== data.category) parts.push(`Category ${categoryLabel(CategoryKeySchema.parse(bill.category))} → ${categoryLabel(data.category)}`);
    if (bill.businessBp !== data.businessBp) parts.push(`For work ${bpWords(bill.businessBp)} → ${bpWords(data.businessBp)}`);
    if (bill.memberId !== data.memberId || bill.paidByMemberId !== data.paidByMemberId) {
      parts.push(ownerName ? `Now ${ownerName}’s` : paidByName ? `Shared, paid by ${paidByName}` : "Shared");
    }
    const cancelBy = data.cancelBy === undefined ? bill.cancelBy : data.cancelBy;
    if (cancelBy !== bill.cancelBy) {
      parts.push(cancelBy === null ? "No last day to cancel" : `Last day to cancel ${bill.cancelBy === null ? "" : `${dueLabel(bill.cancelBy, today)} → `}${dueLabel(cancelBy, today)}`);
    }
    if (parts.length === 0) return true;
    const schedule: BillSchedule = { repeat, nextAmountMinor: next?.amount ?? null, nextAmountFrom: next?.from ?? null, cancelBy, amountVaries: varies };
    checkSchedule(data.due, today, schedule);
    if (household.previous === null) await observeRunway(tx, hid);
    if (!varies && bill.amountVaries) {
      // Without "varies" its real bills would count next to the series' own amount; they stay as plain one-offs.
      const freed = await tx.update(bills).set({ seriesBillId: null }).where(and(eq(bills.householdId, hid), eq(bills.seriesBillId, data.id))).returning({ id: bills.id });
      if (freed.length > 0) parts.push(`${freed.length} real ${freed.length === 1 ? "bill stays" : "bills stay"} as ${freed.length === 1 ? "a one-off" : "one-offs"}`);
    }
    await tx.update(bills).set({
      biller: data.biller, amountMinor: base, due: data.due, repeatDay, category: data.category, businessBp: data.businessBp,
      memberId: data.memberId, paidByMemberId: data.paidByMemberId, nextAmountMinor: schedule.nextAmountMinor, nextAmountFrom: schedule.nextAmountFrom,
      cancelBy, amountVaries: varies, seriesBillId: series,
    }).where(and(eq(bills.householdId, hid), eq(bills.id, data.id)));
    await recordEvent(tx, hid, {
      kind: "bill_changed", ...by, title: `${data.biller} bill changed`, body: parts.join(" · "),
      amount: { value: fromMinor(amountMinor, bill.currency), currency: bill.currency }, ref: { type: "bill", id: data.id },
    });
    await observeRunway(tx, hid);
    return true;
  });
}

/**
 * Checks the series an edited bill is to be part of (D54) and returns the words for its event when the link is new or its
 * month or category changed; null when nothing about the link needs saying. `stored` is the series it is part of now.
 */
async function checkSeries(tx: Db, hid: string, bill: { id: string; repeat: RepeatUnit | null; due: string; category: CategoryKey }, series: string | null, stored: string | null, today: string): Promise<string | null> {
  if (series === null) return null;
  if (bill.repeat !== null) throw new InputError("Only a one-off bill can be part of a monthly bill whose amount changes");
  const [row] = await tx.select({ id: bills.id, biller: bills.biller, category: bills.category, due: bills.due, repeatDay: bills.repeatDay, amountVaries: bills.amountVaries, status: bills.status })
    .from(bills).where(and(eq(bills.householdId, hid), eq(bills.id, series)));
  if (!row || !row.amountVaries || row.status !== "confirmed" || row.repeatDay === null) throw new InputError("Choose a monthly bill of this household whose amount changes every month");
  const category = CategoryKeySchema.parse(row.category);
  if (category !== bill.category) throw new InputError(`A bill that is part of ${row.biller} has its category, ${categoryLabel(category)}; choose Part of: none to change it`);
  const { taken } = await variesSeries(tx, hid, category, bill.id);
  if (taken.some(t => t.seriesBillId === series && t.due.slice(0, 7) === bill.due.slice(0, 7))) throw new InputError(`${row.biller} already has a real bill for ${monthWords(bill.due, today)}`);
  if (series === stored) return null;
  return linkWords({ id: row.id, biller: row.biller, category, due: row.due, repeatDay: row.repeatDay }, bill.due, today).replace(/^Linked to /, "Part of ");
}

/** The name of a bill of this household (the series an edited bill leaves). */
async function billerOf(tx: Db, hid: string, id: string) {
  const [row] = await tx.select({ biller: bills.biller }).from(bills).where(and(eq(bills.householdId, hid), eq(bills.id, id)));
  if (!row) throw new Error("The series of a linked bill is missing");
  return row.biller;
}

const bumpDay = (iso: string, days: number) => new Date(Date.parse(iso + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);
