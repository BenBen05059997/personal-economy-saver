import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { setBankBalance } from "./bank-balance";
import { type Db, requireHousehold, recordEvent } from "./household";
import { InputError } from "./input-error";
import { minorMoney } from "@/lib/money/format";
import { Currency } from "@/lib/catalogue/types";
import { parseMinor } from "./money";
import { bills, cards, charges, households, members } from "./schema";
import { beginMoneyChange, observeRunway } from "./runway-events";
import { clockForHousehold } from "./clock";

class SettingsError extends InputError {}
const name = z.string().trim().min(1).max(80);
const amount = z.string().trim().min(1).max(16); // read by parseMinor: separators and full-width digits are fine; the limit and the decimals are checked there
const memberId = z.union([z.string().uuid(), z.literal("")]);
export const settingsInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("household"), name, bank: amount }),
  z.object({ kind: z.literal("card"), id: z.union([z.string().uuid(), z.literal("")]), label: name,
    memberId, closingDay: z.coerce.number().int().min(1).max(31), dueDay: z.coerce.number().int().min(1).max(31),
    limit: z.union([amount, z.literal("")]),
    foreignFee: z.string().trim().max(6).optional() }), // D62: a percentage with up to two decimals ("" = not entered, absent = unchanged)
  z.object({ kind: z.literal("nudge"), afterDays: z.union([z.literal(""), z.coerce.number().int().min(1).max(60)]) }), // D50: "" = off
]);

/** D62: the card's foreign transaction fee typed as a percentage ("2.2") in basis points (220); "" is null. 0 to 10 percent, up to two decimals. */
export function foreignFeeBp(text: string): number | null {
  if (text === "") return null;
  const match = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(text);
  const bp = match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : -1;
  if (bp < 0 || bp > 1000) throw new SettingsError("Enter the foreign transaction fee as a percentage from 0 to 10, like 2.2");
  return bp;
}

export async function loadSettings(db: Db, householdId: string) {
  const hid = requireHousehold(householdId);
  const [household] = await db.select({ name: households.name, currency: households.homeCurrency,
    bank: households.bankBalanceMinor, timeZone: households.timeZone, demo: households.isDemo,
    aiKeyHint: households.aiKeyHint, nudgeAfterDays: households.nudgeAfterDays, fixedToday: households.fixedToday })
    .from(households).where(eq(households.id, hid));
  if (!household) throw new SettingsError("Household no longer exists");
  const { fixedToday, ...shown } = household;
  const [people, cardRows, billRows] = await Promise.all([
    db.select({ id: members.id, name: members.displayName, role: members.role, shareBp: members.shareBp }).from(members).where(eq(members.householdId, hid))
      .orderBy(sql`(${members.role} = 'owner') desc`, members.createdAt, members.id),
    db.select().from(cards).where(eq(cards.householdId, hid)).orderBy(cards.createdAt),
    db.select({ id: bills.id, biller: bills.biller, amountMinor: bills.amountMinor, currency: bills.currency, due: bills.due, category: bills.category, businessBp: bills.businessBp, repeatDay: bills.repeatDay, repeatUnit: bills.repeatUnit, nextAmountMinor: bills.nextAmountMinor, nextAmountFrom: bills.nextAmountFrom, cancelBy: bills.cancelBy, repeatUntil: bills.repeatUntil, periodStart: bills.periodStart, periodEnd: bills.periodEnd, amountVaries: bills.amountVaries, seriesBillId: bills.seriesBillId, status: bills.status, memberId: bills.memberId, paidByMemberId: bills.paidByMemberId }).from(bills).where(eq(bills.householdId, hid)).orderBy(bills.due),
  ]);
  // `today` is the household's own date, for the bill edit form's amounts and dates.
  return { household: shown, today: clockForHousehold({ isDemo: household.demo, fixedToday, timeZone: household.timeZone }).today, people, cards: cardRows, bills: billRows };
}

export async function updateSettings(db: Db, householdId: string, input: z.infer<typeof settingsInput>) {
  const hid = requireHousehold(householdId);
  const data = settingsInput.parse(input);
  await db.transaction(async tx => {
    const [household] = await tx.select({ currency: households.homeCurrency, bank: households.bankBalanceMinor, name: households.name, nudgeAfterDays: households.nudgeAfterDays }).from(households).where(eq(households.id, hid)).for("update");
    if (!household) throw new SettingsError("Household no longer exists");
    await beginMoneyChange(tx, hid);
    for (const memberRef of [data.kind === "card" ? data.memberId : ""]) {
      if (!memberRef) continue;
      const [person] = await tx.select({ id: members.id }).from(members).where(and(eq(members.householdId, hid), eq(members.id, memberRef)));
      if (!person) throw new SettingsError("Choose a member of this household");
    }
    let changed = true;
    let title: string | null = null; // what changed, in words; nothing changed records no event
    if (data.kind === "household") {
      if (data.name !== household.name) title = `Household renamed to ${data.name}`;
      await tx.update(households).set({ name: data.name }).where(eq(households.id, hid));
      // D42: the one way to set the balance
      if (parseMinor(data.bank, household.currency) !== household.bank) await setBankBalance(tx, hid, { id: crypto.randomUUID(), amount: data.bank }, "confirmed", { madeBy: "form" });
    } else if (data.kind === "nudge") {
      const after = data.afterDays === "" ? null : data.afterDays;
      if (after !== household.nudgeAfterDays) title = after === null ? "Nudge suggestions turned off" : `Nudge suggestions on, ${after} days past due`;
      await tx.update(households).set({ nudgeAfterDays: after }).where(eq(households.id, hid));
    } else if (data.kind === "card") {
      const limitMinor = data.limit ? parseMinor(data.limit, household.currency) : null;
      if (limitMinor !== null && limitMinor < 0) throw new SettingsError("Credit limit cannot be negative");
      const feeBp = data.foreignFee === undefined ? undefined : foreignFeeBp(data.foreignFee);
      const values = { label: data.label, memberId: data.memberId || null, closingDay: data.closingDay, dueDay: data.dueDay, limitMinor, ...(feeBp === undefined ? {} : { foreignFeeBp: feeBp }) };
      if (data.id && !data.memberId) {
        const [shared] = await tx.select({ id: charges.id }).from(charges).where(and(eq(charges.householdId, hid), eq(charges.cardId, data.id), eq(charges.shared, true))).limit(1);
        if (shared) throw new SettingsError("This card has shared charges, so it needs an owner: the person who pays them");
      }
      if (data.id) {
        const [card] = await tx.select({ label: cards.label, currency: cards.currency, memberId: cards.memberId, closingDay: cards.closingDay, dueDay: cards.dueDay, limitMinor: cards.limitMinor, foreignFeeBp: cards.foreignFeeBp })
          .from(cards).where(and(eq(cards.householdId, hid), eq(cards.id, data.id)));
        if (!card) throw new SettingsError("Card no longer exists");
        if (card.currency !== household.currency) throw new SettingsError("This card needs an amount in its billing currency");
        const parts: string[] = [];
        if (card.label !== data.label) parts.push(`renamed from ${card.label}`);
        if (card.closingDay !== data.closingDay) parts.push(`closing day ${card.closingDay} → ${data.closingDay}`);
        if (card.dueDay !== data.dueDay) parts.push(`due day ${card.dueDay} → ${data.dueDay}`);
        if (card.limitMinor !== limitMinor) {
          const money = (minor: number | null) => minor === null ? "no limit" : minorMoney(minor, Currency.parse(card.currency));
          parts.push(`limit ${money(card.limitMinor)} → ${money(limitMinor)}`);
        }
        if (feeBp !== undefined && card.foreignFeeBp !== feeBp) parts.push(`foreign fee ${card.foreignFeeBp === null ? "not entered" : `${card.foreignFeeBp / 100}%`} → ${feeBp === null ? "not entered" : `${feeBp / 100}%`}`);
        if ((card.memberId ?? "") !== data.memberId) {
          const [owner] = data.memberId ? await tx.select({ name: members.displayName }).from(members).where(and(eq(members.householdId, hid), eq(members.id, data.memberId))) : [];
          parts.push(owner ? `now belongs to ${owner.name}` : "is now a household card");
        }
        if (parts.length === 1 && parts[0].match(/^(now belongs|is now)/)) title = `${data.label} ${parts[0]}`;
        else if (parts.length) title = `${data.label}: ${parts.join("; ")}`;
        changed = (await tx.update(cards).set(values).where(and(eq(cards.householdId, hid), eq(cards.id, data.id))).returning({ id: cards.id })).length === 1;
      } else {
        await tx.insert(cards).values({ householdId: hid, currency: household.currency, ...values });
        title = `${data.label} added`;
      }
    }
    if (!changed) throw new SettingsError("That row no longer exists in this household");
    if (title) await recordEvent(tx, hid, { madeBy: "form", kind: "settings_updated", title });
    await observeRunway(tx, hid);
  });
}
