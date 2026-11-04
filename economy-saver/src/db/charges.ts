import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { InputError } from "./input-error";
import { recordEvent, requireHousehold, type Db, type Maker } from "./household";
import { fromMinor, parseAmountMinor } from "./money";
import { observeRunway } from "./runway-events";
import { clockForHousehold } from "./clock";
import { HORIZON_MESSAGE, latestDate } from "@/lib/money/horizon";
import { memberCount } from "./people";
import { BusinessBp, CategoryKeySchema } from "@/lib/money/categories";
import { cards, charges, households, members } from "./schema";
import { syncClosedStatementCharge, unsyncClosedStatementCharge } from "./statement-charge";
import { Currency } from "@/lib/catalogue/types";
import { minorMoney } from "@/lib/money/format";

export const chargeInput = z.object({
  id: z.string().uuid(),
  cardId: z.string().uuid(),
  merchant: z.string().trim().min(1).max(160),
  amount: z.string().trim(),
  date: z.string().date(),
  category: CategoryKeySchema, // D46: a key from lib/money/categories.ts
  businessBp: BusinessBp.default(0), // D46: business share in basis points
  shared: z.boolean().default(false), // D45: split between the members; the card's owner paid it
});

async function ownerName(tx: Db, hid: string, memberId: string | null): Promise<string> {
  const [owner] = memberId ? await tx.select({ name: members.displayName }).from(members).where(and(eq(members.householdId, hid), eq(members.id, memberId))) : [];
  if (!owner) throw new InputError("A shared charge needs a card that belongs to a person; set the card's owner in Settings");
  return owner.name;
}

/**
 * Adds a card charge billed in the household's home currency. "confirmed" counts at once and updates a closed
 * statement (forms); "pending" waits in To check until `confirmPending` (the agent). Idempotent on `id`: the same
 * id with the same fields returns it again without a second event, different fields throw. A shared charge (D45) counts in
 * who owes whom: it needs two or more members and a card that belongs to one of them, who is the payer.
 */
export async function insertCharge(
  db: Db, householdId: string, input: z.infer<typeof chargeInput>, status: "confirmed" | "pending", source: "manual" | "voice", by: Maker,
): Promise<string> {
  const hid = requireHousehold(householdId);
  const data = chargeInput.parse(input);
  return db.transaction(async tx => {
    const [household] = await tx.select({ id: households.id, currency: households.homeCurrency, previous: households.runwayShort, isDemo: households.isDemo, fixedToday: households.fixedToday, timeZone: households.timeZone })
      .from(households).where(eq(households.id, hid)).for("update");
    if (!household) throw new InputError("Household not found");
    const [card] = await tx.select({ currency: cards.currency, memberId: cards.memberId, label: cards.label }).from(cards).where(and(eq(cards.householdId, hid), eq(cards.id, data.cardId)));
    if (!card) throw new InputError("Choose a card of this household");
    if (card.currency !== household.currency) throw new InputError("Card billing currency does not match this amount");
    if (data.shared) {
      if (await memberCount(tx, hid) < 2) throw new InputError("Sharing a charge needs a second person; add one in Settings, People");
      if (!card.memberId) throw new InputError("A shared charge needs a card that belongs to a person; set the card's owner in Settings");
    }
    const amountMinor = parseAmountMinor(data.amount, card.currency);
    const [existing] = await tx.select().from(charges).where(and(eq(charges.householdId, hid), eq(charges.id, data.id)));
    if (existing) {
      if (existing.cardId !== data.cardId || existing.merchant !== data.merchant || existing.amountMinor !== amountMinor || existing.date !== data.date || existing.shared !== data.shared
        || existing.category !== data.category || existing.businessBp !== data.businessBp) {
        throw new InputError("This charge identifier is already in use");
      }
      return data.id;
    }
    if (data.date > latestDate(clockForHousehold(household).today)) throw new InputError(HORIZON_MESSAGE);
    if (status === "confirmed" && household.previous === null) await observeRunway(tx, hid);
    await tx.insert(charges).values({
      id: data.id, householdId: hid, cardId: data.cardId, merchant: data.merchant, amountMinor, currency: card.currency,
      date: data.date, shared: data.shared, category: data.category, businessBp: data.businessBp, source, status, madeBy: by.madeBy, askId: by.askId ?? null,
    });
    if (status === "pending") {
      await recordEvent(tx, hid, { kind: "to_check", ...by, title: `${data.merchant} charge to check`, ref: { type: "charge", id: data.id }, notify: true });
    } else {
      await syncClosedStatementCharge(tx, hid, data.id);
      await recordEvent(tx, hid, {
        kind: "charge_added", ...by, title: `${data.merchant} added`, ...(data.shared && { body: `Shared, paid by ${await ownerName(tx, hid, card.memberId)} (${card.label})` }),
        amount: { value: fromMinor(amountMinor, card.currency), currency: card.currency }, ref: { type: "charge", id: data.id },
      });
      await observeRunway(tx, hid);
    }
    return data.id;
  });
}

/**
 * Removes a card charge of this household, a confirmed one or one still waiting in To check, and records a `charge_removed`
 * event ("Removed charge Minato Fresh Market ¥2,000"). A confirmed charge in a cycle that already has a stored statement is
 * taken back out of that statement, so what is owed follows. Settlements already recorded stay as they are; the split
 * simply recounts from the rows left. False when this household has no such charge.
 */
export async function removeCharge(db: Db, householdId: string, id: string): Promise<boolean> {
  const hid = requireHousehold(householdId);
  const chargeId = z.string().uuid().parse(id);
  return db.transaction(async tx => {
    const [household] = await tx.select({ id: households.id, previous: households.runwayShort }).from(households).where(eq(households.id, hid)).for("update");
    if (!household) throw new InputError("Household not found");
    const [row] = await tx.select().from(charges).where(and(eq(charges.householdId, hid), eq(charges.id, chargeId)));
    if (!row) return false;
    if (household.previous === null) await observeRunway(tx, hid);
    if (row.status === "confirmed") await unsyncClosedStatementCharge(tx, hid, chargeId);
    await tx.delete(charges).where(and(eq(charges.householdId, hid), eq(charges.id, chargeId)));
    await recordEvent(tx, hid, { madeBy: "form",
      kind: "charge_removed", title: `Removed charge ${row.merchant} ${minorMoney(row.amountMinor, Currency.parse(row.currency))}`,
      amount: { value: fromMinor(row.amountMinor, row.currency), currency: row.currency }, ref: { type: "charge", id: chargeId },
    });
    if (row.status === "confirmed") await observeRunway(tx, hid);
    return true;
  });
}
