import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { type Db, requireHousehold, recordEvent } from "./household";
import { InputError } from "./input-error";
import { parseMinor } from "./money";
import { bills, cards, households, members } from "./schema";
import { beginMoneyChange, observeRunway } from "./runway-events";

export class SettingsError extends InputError {}
const name = z.string().trim().min(1).max(80);
const amount = z.string().max(16).regex(/^-?\d+(\.\d{1,2})?$/);
const memberId = z.union([z.string().uuid(), z.literal("")]);
export const settingsInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("household"), name, bank: amount }),
  z.object({ kind: z.literal("member"), id: z.string().uuid(), name }),
  z.object({ kind: z.literal("card"), id: z.union([z.string().uuid(), z.literal("")]), label: name,
    memberId, closingDay: z.coerce.number().int().min(1).max(31), dueDay: z.coerce.number().int().min(1).max(31),
    limit: z.union([amount, z.literal("")]) }),
  z.object({ kind: z.literal("bill-owner"), id: z.string().uuid(), memberId }),
]);

export async function loadSettings(db: Db, householdId: string) {
  const hid = requireHousehold(householdId);
  const [household] = await db.select({ name: households.name, currency: households.homeCurrency,
    bank: households.bankBalanceMinor, timeZone: households.timeZone, demo: households.isDemo,
    aiKeyHint: households.aiKeyHint, aiReadsDay: households.aiReadsDay, aiReadsToday: households.aiReadsToday })
    .from(households).where(eq(households.id, hid));
  if (!household) throw new SettingsError("Household no longer exists");
  const [people, cardRows, billRows] = await Promise.all([
    db.select({ id: members.id, name: members.displayName, role: members.role }).from(members).where(eq(members.householdId, hid)).orderBy(members.createdAt),
    db.select().from(cards).where(eq(cards.householdId, hid)).orderBy(cards.createdAt),
    db.select({ id: bills.id, biller: bills.biller, memberId: bills.memberId }).from(bills).where(eq(bills.householdId, hid)).orderBy(bills.due),
  ]);
  return { household, people, cards: cardRows, bills: billRows };
}

export async function updateSettings(db: Db, householdId: string, input: z.infer<typeof settingsInput>) {
  const hid = requireHousehold(householdId);
  const data = settingsInput.parse(input);
  await db.transaction(async tx => {
    const [household] = await tx.select({ currency: households.homeCurrency }).from(households).where(eq(households.id, hid)).for("update");
    if (!household) throw new SettingsError("Household no longer exists");
    await beginMoneyChange(tx, hid);
    if ("memberId" in data && data.memberId) {
      const [person] = await tx.select({ id: members.id }).from(members).where(and(eq(members.householdId, hid), eq(members.id, data.memberId)));
      if (!person) throw new SettingsError("Choose a member of this household");
    }
    let changed = true;
    if (data.kind === "household") {
      await tx.update(households).set({ name: data.name, bankBalanceMinor: parseMinor(data.bank, household.currency) }).where(eq(households.id, hid));
    } else if (data.kind === "member") {
      changed = (await tx.update(members).set({ displayName: data.name }).where(and(eq(members.householdId, hid), eq(members.id, data.id))).returning({ id: members.id })).length === 1;
    } else if (data.kind === "card") {
      const limitMinor = data.limit ? parseMinor(data.limit, household.currency) : null;
      if (limitMinor !== null && limitMinor < 0) throw new SettingsError("Credit limit cannot be negative");
      const values = { label: data.label, memberId: data.memberId || null, closingDay: data.closingDay, dueDay: data.dueDay, limitMinor };
      if (data.id) {
        const [card] = await tx.select({ currency: cards.currency }).from(cards).where(and(eq(cards.householdId, hid), eq(cards.id, data.id)));
        if (!card) throw new SettingsError("Card no longer exists");
        if (card.currency !== household.currency) throw new SettingsError("This card needs an amount in its billing currency");
        changed = (await tx.update(cards).set(values).where(and(eq(cards.householdId, hid), eq(cards.id, data.id))).returning({ id: cards.id })).length === 1;
      } else await tx.insert(cards).values({ householdId: hid, currency: household.currency, ...values });
    } else {
      changed = (await tx.update(bills).set({ memberId: data.memberId || null }).where(and(eq(bills.householdId, hid), eq(bills.id, data.id))).returning({ id: bills.id })).length === 1;
    }
    if (!changed) throw new SettingsError("That row no longer exists in this household");
    await recordEvent(tx, hid, { kind: "settings_updated", title: "Household settings updated" });
    await observeRunway(tx, hid);
  });
}
