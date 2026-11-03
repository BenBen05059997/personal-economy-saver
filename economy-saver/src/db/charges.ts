import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { InputError } from "./input-error";
import { recordEvent, requireHousehold, type Db } from "./household";
import { fromMinor, parseAmountMinor } from "./money";
import { observeRunway } from "./runway-events";
import { cards, charges, households } from "./schema";
import { syncClosedStatementCharge } from "./statement-charge";

export const chargeInput = z.object({
  id: z.string().uuid(),
  cardId: z.string().uuid(),
  merchant: z.string().trim().min(1).max(160),
  amount: z.string().trim(),
  date: z.string().date(),
});

/**
 * Adds a card charge billed in the household's home currency. "confirmed" counts at once and updates a closed
 * statement (forms); "pending" waits in To check until `confirmPending` (the agent). Idempotent on `id`: the same
 * id with the same fields returns it again without a second event, different fields throw.
 */
export async function insertCharge(
  db: Db, householdId: string, input: z.infer<typeof chargeInput>, status: "confirmed" | "pending", source: "manual" | "voice",
): Promise<string> {
  const hid = requireHousehold(householdId);
  const data = chargeInput.parse(input);
  return db.transaction(async tx => {
    const [household] = await tx.select({ id: households.id, currency: households.homeCurrency, previous: households.runwayShort })
      .from(households).where(eq(households.id, hid)).for("update");
    if (!household) throw new InputError("Household not found");
    const [card] = await tx.select({ currency: cards.currency }).from(cards).where(and(eq(cards.householdId, hid), eq(cards.id, data.cardId)));
    if (!card) throw new InputError("Choose a card of this household");
    if (card.currency !== household.currency) throw new InputError("Card billing currency does not match this amount");
    const amountMinor = parseAmountMinor(data.amount, card.currency);
    const [existing] = await tx.select().from(charges).where(and(eq(charges.householdId, hid), eq(charges.id, data.id)));
    if (existing) {
      if (existing.cardId !== data.cardId || existing.merchant !== data.merchant || existing.amountMinor !== amountMinor || existing.date !== data.date) {
        throw new InputError("This charge identifier is already in use");
      }
      return data.id;
    }
    if (status === "confirmed" && household.previous === null) await observeRunway(tx, hid);
    await tx.insert(charges).values({
      id: data.id, householdId: hid, cardId: data.cardId, merchant: data.merchant, amountMinor, currency: card.currency,
      date: data.date, source, status,
    });
    if (status === "pending") {
      await recordEvent(tx, hid, { kind: "to_check", title: `${data.merchant} charge to check`, ref: { type: "charge", id: data.id }, notify: true });
    } else {
      await syncClosedStatementCharge(tx, hid, data.id);
      await recordEvent(tx, hid, {
        kind: "charge_added", title: `${data.merchant} added`,
        amount: { value: fromMinor(amountMinor, card.currency), currency: card.currency }, ref: { type: "charge", id: data.id },
      });
      await observeRunway(tx, hid);
    }
    return data.id;
  });
}
