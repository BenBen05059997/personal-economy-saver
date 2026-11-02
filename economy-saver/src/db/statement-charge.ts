import { and, desc, eq, lte, sql } from "drizzle-orm";
import { closingOnOrAfter, dueDateFor } from "@/lib/money/runway";
import { type Db, requireHousehold } from "./household";
import { householdDate } from "./account";
import { cards, cardStatements, charges, fxRates } from "./schema";
import { convertMinor, fromRateMicro } from "./money";
export class StatementChargeError extends Error {}

/** Caller holds the household lock and invokes once per newly confirmed charge, in the same transaction. */
export async function syncClosedStatementCharge(tx: Db, householdId: string, chargeId: string) {
  const hid = requireHousehold(householdId);
  const [charge] = await tx.select().from(charges).where(and(eq(charges.householdId, hid), eq(charges.id, chargeId), eq(charges.status, "confirmed")));
  if (!charge) throw new StatementChargeError("Confirmed household charge not found");
  const [card] = await tx.select().from(cards).where(and(eq(cards.householdId, hid), eq(cards.id, charge.cardId)));
  if (!card) throw new StatementChargeError("Household card not found");
  const close = closingOnOrAfter(card, charge.date);
  const [statement] = await tx.select().from(cardStatements)
    .where(and(eq(cardStatements.householdId, hid), eq(cardStatements.cardId, card.id), eq(cardStatements.closedOn, close)));
  if (statement?.paidOn) throw new StatementChargeError("This statement is already paid. Check the charge date before confirming.");
  if (!statement && close >= await householdDate(tx, hid)) return;
  const targetCurrency = statement?.currency ?? card.currency;
  async function inStatement(amount: number, currency: string, date: string) {
    if (currency === targetCurrency) return amount;
    const [rate] = await tx.select().from(fxRates).where(and(eq(fxRates.householdId, hid), eq(fxRates.base, "USD"), eq(fxRates.quote, "JPY"), lte(fxRates.date, date)))
      .orderBy(desc(fxRates.date)).limit(1);
    if (!rate) throw new StatementChargeError("No household USD/JPY reference rate for this charge date");
    return convertMinor(amount, currency, targetCurrency, fromRateMicro(rate.rateMicro));
  }
  if (statement) {
    const extra = await inStatement(charge.amountMinor, charge.currency, charge.date);
    await tx.update(cardStatements).set({ amountMinor: sql`${cardStatements.amountMinor} + ${extra}` })
      .where(and(eq(cardStatements.householdId, hid), eq(cardStatements.id, statement.id)));
  } else {
    // A backdated confirmation can arrive after a zero-spend close or missed cron.
    const cycleCharges = await tx.select().from(charges).where(and(eq(charges.householdId, hid), eq(charges.cardId, card.id), eq(charges.status, "confirmed"), lte(charges.date, close)));
    let amountMinor = 0;
    for (const row of cycleCharges) if (closingOnOrAfter(card, row.date) === close) amountMinor += await inStatement(row.amountMinor, row.currency, row.date);
    await tx.insert(cardStatements).values({ householdId: hid, cardId: card.id, closedOn: close, dueOn: dueDateFor(card, close), currency: targetCurrency, amountMinor });
  }
}
