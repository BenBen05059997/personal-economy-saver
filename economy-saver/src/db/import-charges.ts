import { and, between, eq } from "drizzle-orm";
import { z } from "zod";
import { InputError } from "./input-error";
import { recordEvent, requireHousehold, type Db, type Maker } from "./household";
import { fromMinor } from "./money";
import { observeRunway } from "./runway-events";
import { clockForHousehold } from "./clock";
import { AMOUNT_LIMIT, limitMessage } from "@/lib/money/amount";
import { CategoryKeySchema } from "@/lib/money/categories";
import { minorPerUnit } from "@/lib/money/format";
import { normalise } from "@/lib/money/spending";
import { IMPORT_BATCH, MERCHANT_MAX } from "@/lib/import/csv";
import { cards, charges, households } from "./schema";

export const importRow = z.object({
  date: z.string().date(),
  merchant: z.string().trim().min(1).max(MERCHANT_MAX),
  amountMinor: z.number().int().positive(),
  category: CategoryKeySchema,
});
export const importInput = z.object({ cardId: z.string().uuid(), rows: z.array(importRow).min(1).max(IMPORT_BATCH) });

/**
 * The key two charges on one card share when they are the same line of a statement: date, amount and the name through the one
 * normaliser (`normalise`, D54). Not `nameKey`: that drops month words, and two months' lines must never be taken for one.
 */
const keyOf = (date: string, amountMinor: number, merchant: string) => `${date}|${amountMinor}|${normalise(merchant)}`;

/**
 * Adds the charges read from a card or bank statement (D53) to one card of the household, confirmed, in the household's
 * currency, personal and not shared; the user fixes categories and shares afterwards. A row that is already on that card
 * (same date, amount and name, counted one for one, so two identical coffees on one day stay two) is skipped, so importing
 * the same file again adds nothing. Stored card statements are left as they are, unlike `syncClosedStatementCharge` for a
 * single typed charge: a stored statement is what the issuer billed for its cycle, and these rows come from that same issuer,
 * so they are already in it. Rows after the card's latest stored statement count in the runway as any confirmed charge does
 * (the open cycle, or a closed cycle still to be paid); older ones are history for Plan. One `charges_imported` event, and
 * the runway is observed.
 * One select for the existing keys, one multi-row insert: the Workers CPU budget (D32).
 */
export async function importCharges(
  db: Db, householdId: string, cardId: string, rows: z.infer<typeof importRow>[], by: Maker,
): Promise<{ added: number; skipped: number }> {
  const hid = requireHousehold(householdId);
  const data = importInput.parse({ cardId, rows });
  return db.transaction(async tx => {
    const [household] = await tx.select({ id: households.id, currency: households.homeCurrency, runwayShort: households.runwayShort, isDemo: households.isDemo, fixedToday: households.fixedToday, timeZone: households.timeZone })
      .from(households).where(eq(households.id, hid)).for("update");
    if (!household) throw new InputError("Household not found");
    const [card] = await tx.select().from(cards).where(and(eq(cards.householdId, hid), eq(cards.id, data.cardId)));
    if (!card) throw new InputError("Choose a card of this household");
    if (card.currency !== household.currency) throw new InputError("This card is billed in another currency than the household's");
    const currency = card.currency as "JPY" | "USD";
    if (data.rows.some(r => r.amountMinor > AMOUNT_LIMIT[currency] * minorPerUnit(currency))) throw new InputError(limitMessage(currency));
    const today = clockForHousehold(household).today;
    const late = data.rows.filter(r => r.date > today).length;
    if (late) throw new InputError(`${late === 1 ? "One row is" : `${late} rows are`} dated after today (${today}). A statement lists charges already made; check the date column.`);

    const dates = data.rows.map(r => r.date).sort();
    const existing = await tx.select({ date: charges.date, amountMinor: charges.amountMinor, merchant: charges.merchant }).from(charges)
      .where(and(eq(charges.householdId, hid), eq(charges.cardId, card.id), between(charges.date, dates[0], dates[dates.length - 1])));
    const there = new Map<string, number>();
    for (const c of existing) { const k = keyOf(c.date, c.amountMinor, c.merchant); there.set(k, (there.get(k) ?? 0) + 1); }
    const fresh = data.rows.filter(r => {
      const k = keyOf(r.date, r.amountMinor, r.merchant), n = there.get(k) ?? 0;
      if (n > 0) { there.set(k, n - 1); return false; }
      return true;
    });
    const skipped = data.rows.length - fresh.length;
    if (!fresh.length) return { added: 0, skipped };

    if (household.runwayShort === null) await observeRunway(tx, hid, undefined, household);
    const ids = fresh.map(() => crypto.randomUUID());
    await tx.insert(charges).values(fresh.map((r, i) => ({
      id: ids[i], householdId: hid, cardId: card.id, merchant: r.merchant, amountMinor: r.amountMinor, currency, date: r.date,
      shared: false, category: r.category, businessBp: 0, source: "manual" as const, status: "confirmed" as const, madeBy: by.madeBy, askId: by.askId ?? null,
    })));

    const totalMinor = fresh.reduce((sum, r) => sum + r.amountMinor, 0);
    await recordEvent(tx, hid, {
      ...by, kind: "charges_imported",
      title: `Imported ${fresh.length} ${fresh.length === 1 ? "charge" : "charges"} to ${card.label} from a statement${skipped ? ` (${skipped} already there)` : ""}`,
      amount: { value: fromMinor(totalMinor, currency), currency }, ref: { type: "card", id: card.id }, // Activity opens the card page
    });
    await observeRunway(tx, hid);
    return { added: fresh.length, skipped };
  });
}
