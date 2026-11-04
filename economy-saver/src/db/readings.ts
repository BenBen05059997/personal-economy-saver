import { lockRunway, observeRunway } from "./runway-events";
import { and, desc, eq, lte, sql } from "drizzle-orm";
import { type Db, recordEvent, requireHousehold } from "./household";
import { bills, cards, charges, documents, fxRates, households, readings, rules } from "./schema";
import { checkSchedule, repeatDayFor } from "./bills";
import { clockForHousehold } from "./clock";
import { InputError } from "./input-error";
import { convertMinor, fromMinor, fromRateMicro } from "./money";
import { extractSchema, type Extracted } from "@/lib/reader/extract";
import { ReaderError } from "@/lib/reader/settings";
import { syncClosedStatementCharge } from "./statement-charge";

const ruleKey = (entry: Extracted) => entry.name ? entry.kind + ":" + entry.name.normalize("NFKC").trim().toLowerCase() : null;
const patchSchema = extractSchema.pick({ name: true, kind: true, category: true, businessBp: true, cardId: true }).partial();

/** Called inside the transaction which finishes a document. Nothing here changes the runway. */
export async function proposeReadings(db: Db, id: string, documentId: string, items: Extracted[]) {
  const hid = requireHousehold(id);
  for (const original of items) {
    const key = ruleKey(original);
    const [rule] = key ? await db.select({ patch: rules.patch }).from(rules)
      .where(and(eq(rules.householdId, hid), eq(rules.matchBiller, key))) : [];
    const proposed = rule ? { ...original, ...patchSchema.parse(rule.patch) } : original;
    const [row] = await db.insert(readings).values({
      householdId: hid, documentId, extracted: { original, proposed }, target: proposed.kind,
    }).returning({ id: readings.id });
    await recordEvent(db, hid, { madeBy: "reader", kind: "to_check", title: `Review ${proposed.name ?? proposed.kind}`, ref: { type: "reading", id: row.id }, notify: true });
  }
}

export async function reviewReading(db: Db, id: string, readingId: string, fields: Extracted | null) {
  const hid = requireHousehold(id);
  return db.transaction(async tx => {
    const previous = await lockRunway(tx, hid);
    const [row] = await tx.select({
      data: readings.extracted, documentId: readings.documentId, source: documents.kind, currency: households.homeCurrency, isDemo: households.isDemo, fixedToday: households.fixedToday, timeZone: households.timeZone,
    }).from(readings).innerJoin(documents, and(eq(readings.documentId, documents.id), eq(documents.householdId, hid)))
      .innerJoin(households, eq(households.id, readings.householdId))
      .where(and(eq(readings.householdId, hid), eq(readings.id, readingId), eq(readings.status, "to_check"))).for("update");
    if (!row) return false;
    if (!fields) {
      await tx.update(readings).set({ status: "rejected", confirmedAt: new Date() }).where(and(eq(readings.householdId, hid), eq(readings.id, readingId)));
      await recordEvent(tx, hid, { madeBy: "reader", kind: "reading_rejected", title: "Reading dismissed", ref: { type: "reading", id: readingId } });
      return true;
    }
    if (previous === null) await observeRunway(tx, hid);
    const value = extractSchema.parse(fields);
    const { name, date, amountMinor, currency } = value;
    if (!name || !date || !amountMinor || !currency) throw new ReaderError("Enter the name, amount, currency and date.");
    let amount = amountMinor, fx: number | null = null;
    if (currency !== row.currency) {
      const [rate] = await tx.select().from(fxRates).where(and(eq(fxRates.householdId, hid), eq(fxRates.base, "USD"), eq(fxRates.quote, "JPY"), lte(fxRates.date, date)))
        .orderBy(desc(fxRates.date)).limit(1);
      if (!rate) throw new ReaderError("No household USD/JPY reference rate on or before this date.");
      fx = rate.rateMicro;
      amount = convertMinor(amountMinor, currency, row.currency, fromRateMicro(fx));
    }
    const amounts = { madeBy: "reader" as const, householdId: hid, documentId: row.documentId, amountMinor: amount, currency: row.currency, fxRateMicro: fx };
    if (!value.category) throw new ReaderError("Choose a category.");
    const category = { category: value.category, businessBp: value.businessBp ?? 0 };
    let targetId: string;
    if (value.kind === "charge") {
      if (!value.cardId) throw new ReaderError("Select the card used for this charge.");
      const [card] = await tx.select({ id: cards.id }).from(cards).where(and(eq(cards.householdId, hid), eq(cards.id, value.cardId)));
      if (!card) throw new ReaderError("Choose a card in this household.");
      const [charge] = await tx.insert(charges).values({
        ...amounts, ...category, cardId: card.id, date, merchant: name, status: "confirmed", source: row.source === "email" ? "card_email" : "receipt",
        originalAmountMinor: fx === null ? null : amountMinor, originalCurrency: fx === null ? null : currency,
      }).returning({ id: charges.id });
      targetId = charge.id;
      await syncClosedStatementCharge(tx, hid, charge.id);
    } else {
      // D48: the schedule is checked like a typed-in bill; the new amount converts at the same rate as the amount.
      const nextAmountMinor = value.nextAmountMinor === null ? null : fx === null ? value.nextAmountMinor : convertMinor(value.nextAmountMinor, currency, row.currency, fromRateMicro(fx));
      try { checkSchedule(date, clockForHousehold(row).today, { repeat: value.repeat, nextAmountMinor, nextAmountFrom: value.nextAmountFrom, cancelBy: value.cancelBy }); }
      catch (error) { throw error instanceof InputError ? new ReaderError(error.message) : error; }
      const [bill] = await tx.insert(bills).values({
        ...amounts, ...category, due: date, biller: name, status: "confirmed", repeatUnit: value.repeat, repeatDay: repeatDayFor(date, value.repeat),
        nextAmountMinor, nextAmountFrom: value.nextAmountFrom, cancelBy: value.cancelBy,
      }).returning({ id: bills.id });
      targetId = bill.id;
    }
    const saved = row.data as { original: Extracted; proposed: Extracted };
    const original = extractSchema.parse(saved.original), proposed = extractSchema.parse(saved.proposed);
    // Only stable corrections recur. A different amount or date changes this document only.
    const was = { ...proposed, businessBp: proposed.businessBp ?? 0 }, now = { ...value, businessBp: value.businessBp ?? 0 };
    const patch = Object.fromEntries((["name", "kind", "category", "businessBp", "cardId"] as const).filter(k => was[k] !== now[k]).map(k => [k, now[k]]));
    const key = ruleKey(original);
    if (key && Object.keys(patch).length) {
      await tx.insert(rules).values({ householdId: hid, matchBiller: key, patch }).onConflictDoUpdate({
        target: [rules.householdId, rules.matchBiller], set: { patch: sql`${rules.patch} || excluded.patch` },
      });
    }
    await tx.update(readings).set({ status: "confirmed", confirmedAt: new Date(), target: value.kind, extracted: { original, proposed, confirmed: value } })
      .where(and(eq(readings.householdId, hid), eq(readings.id, readingId)));
    await recordEvent(tx, hid, { madeBy: "reader", kind: value.kind + "_confirmed", title: name + " confirmed", ref: { type: value.kind, id: targetId },
      amount: { value: fromMinor(amount, row.currency), currency: row.currency } });
    await observeRunway(tx, hid);
    return true;
  });
}
