import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { setBankBalance } from "./bank-balance";
import { type Db, requireHousehold, recordEvent } from "./household";
import { InputError } from "./input-error";
import { minorMoney } from "@/lib/money/format";
import { Currency } from "@/lib/catalogue/types";
import { parseMinor } from "./money";
import { memberCount } from "./people";
import { bills, cards, charges, households, members } from "./schema";
import { beginMoneyChange, observeRunway } from "./runway-events";

export class SettingsError extends InputError {}
const name = z.string().trim().min(1).max(80);
const amount = z.string().trim().min(1).max(16); // read by parseMinor: separators and full-width digits are fine; the limit and the decimals are checked there
const memberId = z.union([z.string().uuid(), z.literal("")]);
export const settingsInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("household"), name, bank: amount }),
  z.object({ kind: z.literal("card"), id: z.union([z.string().uuid(), z.literal("")]), label: name,
    memberId, closingDay: z.coerce.number().int().min(1).max(31), dueDay: z.coerce.number().int().min(1).max(31),
    limit: z.union([amount, z.literal("")]) }),
  z.object({ kind: z.literal("bill-owner"), id: z.string().uuid(), memberId, paidByMemberId: memberId.default("") }), // D45: a shared bill (memberId "") may name who pays it
]);

export async function loadSettings(db: Db, householdId: string) {
  const hid = requireHousehold(householdId);
  const [household] = await db.select({ name: households.name, currency: households.homeCurrency,
    bank: households.bankBalanceMinor, timeZone: households.timeZone, demo: households.isDemo,
    aiKeyHint: households.aiKeyHint, aiReadsDay: households.aiReadsDay, aiReadsToday: households.aiReadsToday })
    .from(households).where(eq(households.id, hid));
  if (!household) throw new SettingsError("Household no longer exists");
  const [people, cardRows, billRows] = await Promise.all([
    db.select({ id: members.id, name: members.displayName, role: members.role, shareBp: members.shareBp }).from(members).where(eq(members.householdId, hid))
      .orderBy(sql`(${members.role} = 'owner') desc`, members.createdAt, members.id),
    db.select().from(cards).where(eq(cards.householdId, hid)).orderBy(cards.createdAt),
    db.select({ id: bills.id, biller: bills.biller, amountMinor: bills.amountMinor, currency: bills.currency, repeatDay: bills.repeatDay, repeatUnit: bills.repeatUnit, status: bills.status, memberId: bills.memberId, paidByMemberId: bills.paidByMemberId }).from(bills).where(eq(bills.householdId, hid)).orderBy(bills.due),
  ]);
  return { household, people, cards: cardRows, bills: billRows };
}

export async function updateSettings(db: Db, householdId: string, input: z.infer<typeof settingsInput>) {
  const hid = requireHousehold(householdId);
  const data = settingsInput.parse(input);
  await db.transaction(async tx => {
    const [household] = await tx.select({ currency: households.homeCurrency, bank: households.bankBalanceMinor, name: households.name }).from(households).where(eq(households.id, hid)).for("update");
    if (!household) throw new SettingsError("Household no longer exists");
    await beginMoneyChange(tx, hid);
    for (const memberRef of [data.kind === "bill-owner" || data.kind === "card" ? data.memberId : "", data.kind === "bill-owner" ? data.paidByMemberId : ""]) {
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
      if (parseMinor(data.bank, household.currency) !== household.bank) await setBankBalance(tx, hid, { id: crypto.randomUUID(), amount: data.bank }, "confirmed");
    } else if (data.kind === "card") {
      const limitMinor = data.limit ? parseMinor(data.limit, household.currency) : null;
      if (limitMinor !== null && limitMinor < 0) throw new SettingsError("Credit limit cannot be negative");
      const values = { label: data.label, memberId: data.memberId || null, closingDay: data.closingDay, dueDay: data.dueDay, limitMinor };
      if (data.id && !data.memberId) {
        const [shared] = await tx.select({ id: charges.id }).from(charges).where(and(eq(charges.householdId, hid), eq(charges.cardId, data.id), eq(charges.shared, true))).limit(1);
        if (shared) throw new SettingsError("This card has shared charges, so it needs an owner: the person who pays them");
      }
      if (data.id) {
        const [card] = await tx.select({ label: cards.label, currency: cards.currency, memberId: cards.memberId, closingDay: cards.closingDay, dueDay: cards.dueDay, limitMinor: cards.limitMinor })
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
    } else {
      // Who pays only means something for a shared bill, so a bill given an owner drops it.
      const paidBy = data.memberId ? null : data.paidByMemberId || null;
      if (paidBy && await memberCount(tx, hid) < 2) throw new SettingsError("Splitting a bill needs a second person; add one in People");
      const [bill] = await tx.update(bills).set({ memberId: data.memberId || null, paidByMemberId: paidBy }).where(and(eq(bills.householdId, hid), eq(bills.id, data.id))).returning({ biller: bills.biller });
      changed = !!bill;
      if (bill) title = `${bill.biller} bill owner updated`;
    }
    if (!changed) throw new SettingsError("That row no longer exists in this household");
    if (title) await recordEvent(tx, hid, { kind: "settings_updated", title });
    await observeRunway(tx, hid);
  });
}
