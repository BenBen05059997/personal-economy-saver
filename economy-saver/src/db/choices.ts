// Choices (D81): something the person chose or the app found in their records, kept so a saving can name what it was about. One
// function per job: the Saving forms and the agent's tools call them. A confirmed choice stays on the record; withdrawing it
// sets a day and keeps the row. A pending one (the agent's draft) waits in To check and counts for nothing.
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { CategoryKeySchema, type CategoryKey } from "@/lib/money/categories";
import { minorMoney } from "@/lib/money/format";
import type { Choice, PendingChoice } from "@/lib/money/types";
import { Currency } from "@/lib/catalogue/types";
import { householdMoment } from "./clock";
import { InputError } from "./input-error";
import { lockHousehold, recordEvent, requireHousehold, withHousehold, type Db, type Maker } from "./household";
import { fromMinor } from "./money";
import * as s from "./schema";

export type ChoiceInput = {
  id: string; source: "said" | "found"; happenedOn: string; aboutMinor: number; words: string;
  category: CategoryKey | null; foundKey: string | null; memberId: string | null;
};

const choiceInput = z.object({
  id: z.uuid(),
  source: z.enum(["said", "found"]),
  happenedOn: z.string().date(),
  aboutMinor: z.number().int().positive({ error: "Enter an amount above zero" }),
  words: z.string().trim().min(1, "Say what it was about").max(160, "Keep it to 160 characters or fewer"),
  category: CategoryKeySchema.nullable(),
  foundKey: z.string().trim().min(1).nullable(),
  memberId: z.uuid().nullable(),
});

const dayOf = (column: typeof s.choices.confirmedAt) => sql<string>`to_char(timezone(${s.households.timeZone}, ${column}), 'YYYY-MM-DD')`;

/** Saves a choice in the household's home currency. "confirmed" counts at once; "pending" waits in To check until `confirmChoice`. Idempotent on `id`: the same id with the same fields returns it again with no second event; a different one throws. */
export async function saveChoice(db: Db, householdId: string, input: ChoiceInput, status: "confirmed" | "pending", by: Maker): Promise<string> {
  const hid = requireHousehold(householdId);
  const parsed = choiceInput.safeParse(input);
  if (!parsed.success) throw new InputError(parsed.error.issues[0].message);
  const data = parsed.data;
  if ((data.source === "found") !== (data.foundKey !== null)) throw new InputError(data.source === "found" ? "Something the app found needs its key" : "Only something the app found has a key");
  const memberId = data.memberId ?? by.memberId ?? null;
  await withHousehold(db, hid, async tx => {
    const household = await lockHousehold(tx, hid);
    if (memberId) {
      const [member] = await tx.select({ id: s.members.id }).from(s.members).where(and(eq(s.members.householdId, hid), eq(s.members.id, memberId)));
      if (!member) throw new InputError("Choose a member of this household");
    }
    const currency = Currency.parse(household.currency);
    const [existing] = await tx.select().from(s.choices).where(and(eq(s.choices.householdId, hid), eq(s.choices.id, data.id)));
    if (existing) {
      const same = existing.source === data.source && existing.happenedOn === data.happenedOn && existing.aboutMinor === data.aboutMinor && existing.words === data.words
        && existing.category === data.category && existing.foundKey === data.foundKey && existing.memberId === memberId;
      if (!same) throw new InputError("This choice identifier is already in use");
      return;
    }
    if (data.foundKey !== null) {
      const [dupe] = await tx.select({ id: s.choices.id }).from(s.choices).where(and(eq(s.choices.householdId, hid), eq(s.choices.foundKey, data.foundKey)));
      if (dupe) throw new InputError("The app has already found this one");
    }
    await tx.insert(s.choices).values({
      id: data.id, householdId: hid, memberId, source: data.source, happenedOn: data.happenedOn, aboutMinor: data.aboutMinor, currency: household.currency,
      words: data.words, category: data.category, foundKey: data.foundKey, status, madeBy: by.madeBy, askId: by.askId ?? null,
      confirmedAt: status === "confirmed" ? householdMoment(household) : null,
    });
    const amount = { value: fromMinor(data.aboutMinor, household.currency), currency: household.currency };
    if (status === "pending") await recordEvent(tx, hid, { madeBy: by.madeBy, ...(by.askId && { askId: by.askId }), kind: "to_check", title: `A choice to check: ${data.words}`, amount, ref: { type: "choice", id: data.id }, notify: true });
    else await recordEvent(tx, hid, { madeBy: by.madeBy, ...(by.askId && { askId: by.askId }), kind: "choice_added", title: `Choice noted: ${data.words} (${minorMoney(data.aboutMinor, currency)})`, amount, ref: { type: "choice", id: data.id } });
  });
  return data.id;
}

/** `confirmPending` for a pending choice: it counts from now on. False when nothing pending matches. The caller holds the household lock. */
export async function confirmChoice(tx: Db, householdId: string, id: string): Promise<boolean> {
  const hid = requireHousehold(householdId);
  const [household] = await tx.select({ isDemo: s.households.isDemo, fixedToday: s.households.fixedToday, timeZone: s.households.timeZone }).from(s.households).where(eq(s.households.id, hid));
  if (!household) return false;
  const [row] = await tx.update(s.choices).set({ status: "confirmed", confirmedAt: householdMoment(household) })
    .where(and(eq(s.choices.householdId, hid), eq(s.choices.id, id), eq(s.choices.status, "pending"))).returning();
  if (!row) return false;
  await recordEvent(tx, hid, { madeBy: "form", kind: "choice_added", title: `Choice noted: ${row.words} (${minorMoney(row.aboutMinor, Currency.parse(row.currency))})`,
    amount: { value: fromMinor(row.aboutMinor, row.currency), currency: row.currency }, ref: { type: "choice", id } });
  return true;
}

/** Withdraws a confirmed choice: it gets a day and the row stays. False when this household has no such confirmed choice, or it was already withdrawn. */
export async function withdrawChoice(db: Db, householdId: string, id: string): Promise<boolean> {
  const hid = requireHousehold(householdId);
  const choiceId = z.uuid().parse(id);
  return withHousehold(db, hid, async tx => {
    const household = await lockHousehold(tx, hid);
    const [row] = await tx.update(s.choices).set({ withdrawnAt: householdMoment(household) })
      .where(and(eq(s.choices.householdId, hid), eq(s.choices.id, choiceId), eq(s.choices.status, "confirmed"), sql`${s.choices.withdrawnAt} is null`)).returning();
    if (!row) return false;
    await recordEvent(tx, hid, { madeBy: "form", kind: "choice_withdrawn", title: `Choice withdrawn: ${row.words}`, ref: { type: "choice", id: choiceId } });
    return true;
  });
}

/** Removes a choice that still waits in To check. False when this household has no such pending choice. */
export async function removePendingChoice(db: Db, householdId: string, id: string): Promise<boolean> {
  const hid = requireHousehold(householdId);
  const choiceId = z.uuid().parse(id);
  return withHousehold(db, hid, async tx => {
    await lockHousehold(tx, hid);
    const removed = await tx.delete(s.choices).where(and(eq(s.choices.householdId, hid), eq(s.choices.id, choiceId), eq(s.choices.status, "pending"))).returning({ id: s.choices.id });
    return removed.length > 0;
  });
}

const columns = {
  id: s.choices.id, source: s.choices.source, happenedOn: s.choices.happenedOn, minor: s.choices.aboutMinor, words: s.choices.words, category: s.choices.category,
  foundKey: s.choices.foundKey, memberId: s.choices.memberId, madeBy: s.choices.madeBy,
};
const base = (row: { id: string; source: "said" | "found"; happenedOn: string; minor: number; words: string; category: string | null; foundKey: string | null; memberId: string | null }) => ({
  id: row.id, source: row.source, happenedOn: row.happenedOn, minor: row.minor, words: row.words,
  category: row.category === null ? null : CategoryKeySchema.parse(row.category), foundKey: row.foundKey, memberId: row.memberId,
});

/** The household's confirmed choices, all time, withdrawn ones included, oldest first. */
export async function loadChoices(db: Db, householdId: string): Promise<Choice[]> {
  const hid = requireHousehold(householdId);
  return withHousehold(db, hid, async tx => {
    const rows = await tx.select({ ...columns, confirmedOn: dayOf(s.choices.confirmedAt), withdrawnOn: sql<string | null>`to_char(timezone(${s.households.timeZone}, ${s.choices.withdrawnAt}), 'YYYY-MM-DD')` })
      .from(s.choices).innerJoin(s.households, eq(s.households.id, s.choices.householdId))
      .where(and(eq(s.choices.householdId, hid), eq(s.choices.status, "confirmed")))
      .orderBy(asc(s.choices.happenedOn), asc(s.choices.createdAt), asc(s.choices.id));
    return rows.map((row): Choice => ({ ...base(row), confirmedOn: row.confirmedOn, withdrawnOn: row.withdrawnOn }));
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

/** The choices waiting in To check, oldest first. The caller is already inside the household's scope: `loadMoneyState` reads it. */
export async function loadPendingChoices(db: Db, householdId: string): Promise<PendingChoice[]> {
  const hid = requireHousehold(householdId);
  const rows = await db.select(columns).from(s.choices).where(and(eq(s.choices.householdId, hid), eq(s.choices.status, "pending")))
    .orderBy(asc(s.choices.createdAt), asc(s.choices.id));
  return rows.map((row): PendingChoice => ({ ...base(row), ...(row.madeBy !== "form" && { madeBy: row.madeBy }) }));
}
