import { observeRunway } from "./runway-events";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { MoneyState } from "@/lib/money/types";
import { addDays, closingOnOrAfter, cycle, daysBetween, dueItems, medianLow } from "@/lib/money/runway";
import { dayLabel, money } from "@/lib/money/format";
import { AMOUNT_NOT_KNOWN } from "@/lib/money/gaps";
import { householdClock } from "./account";
import { loadMoneyState, recordEvent, requireHousehold, type Db } from "./household";
import { cardStatements, events, households, invoices } from "./schema";
import { expectedPayDate } from "@/lib/money/pace";
import { toMinor } from "./money";
import { removeExpiredFiles } from "./document-cleanup";
import { pruneIpBuckets } from "./rate-limit";
import { pruneAskReceipts } from "./ask-receipts";
import { aiGlobalUsage } from "./schema";
import { fetchReferenceRate, storeReferenceRate } from "./reference-rate";

/**
 * D50, the one standing rule: once a sent, unreminded invoice is `afterDays` past its due date (its expected date when it
 * has none), record one `nudge_suggested` event with the bell. Never twice for the same invoice. It only suggests; the
 * reminder leaves from the approve route after the user's tap.
 */
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

async function suggestNudges(tx: Db, hid: string, state: MoneyState, today: string, afterDays: number) {
  const [rows, already] = await Promise.all([
    tx.select({ id: invoices.id, clientId: invoices.clientId, sentOn: invoices.sentOn, dueOn: invoices.dueOn }).from(invoices)
      .where(and(eq(invoices.householdId, hid), eq(invoices.status, "sent"), isNull(invoices.remindedAt), isNull(invoices.reminderAttemptedAt)))
      .orderBy(invoices.sentOn, invoices.id),
    tx.select({ refId: events.refId }).from(events)
      .where(and(eq(events.householdId, hid), eq(events.kind, "nudge_suggested"), eq(events.refType, "invoice"))),
  ]);
  const done = new Set(already.map(row => row.refId));
  for (const row of rows) {
    const client = state.clients.find(c => c.id === row.clientId);
    if (!client || done.has(row.id)) continue;
    const due = row.dueOn ?? (row.sentOn ? expectedPayDate(client, row.sentOn) : null);
    if (!due || addDays(due, afterDays) > today) continue;
    await recordEvent(tx, hid, { madeBy: "cron", kind: "nudge_suggested", title: `Nudge ${client.name}: ${plural(daysBetween(due, today), "day")} past due`,
      ref: { type: "invoice", id: row.id }, notify: true });
  }
}

export async function runDaily(db: Db, id: string, now = new Date()) {
  const hid = requireHousehold(id);
  const [household] = await db.select({ currency: households.homeCurrency, demo: households.isDemo, nudgeAfterDays: households.nudgeAfterDays })
    .from(households).where(eq(households.id, hid));
  if (!household) throw new Error("Scheduled household not found");
  const { today } = await householdClock(db, hid, now);
  const rate = !household.demo && household.currency === "JPY" ? await fetchReferenceRate() : null;
  // 27E: housekeeping that needs no household lock. Old per-address windows and AI usage days go; 
  await pruneIpBuckets(db);
  await db.delete(aiGlobalUsage).where(sql`${aiGlobalUsage.day} < (now() at time zone 'utc')::date - 7`);
  await pruneAskReceipts(db, hid);
  const result = await db.transaction(async tx => {
    // Serialize overlapping Cron Trigger deliveries for this household.
    await tx.select({ id: households.id }).from(households).where(eq(households.id, hid)).for("update");
    if (rate) await storeReferenceRate(tx, hid, rate);
    const state = await loadMoneyState(tx, hid, today);
    await observeRunway(tx, hid, state);
    const notes: string[] = [];
    for (const card of state.cards) {
      if (closingOnOrAfter(card, today) !== today) continue;
      const statement = cycle(state, card.id);
      if (statement.openTotal <= 0) continue;
      const inserted = await tx.insert(cardStatements).values({
        householdId: hid, cardId: card.id, closedOn: today, dueOn: statement.dueOn,
        currency: state.homeCurrency, amountMinor: toMinor(statement.openTotal, state.homeCurrency),
      }).onConflictDoNothing().returning({ id: cardStatements.id });
      if (inserted.length) notes.push(`${card.label} closes at ${money(statement.openTotal, state.homeCurrency)}, due ${dayLabel(statement.dueOn)}.`);
    }
    for (const bill of dueItems(state, 4).filter(b => !b.pending && b.date === addDays(today, 3))) {
      notes.push(`${bill.label} is due ${dayLabel(bill.date)}: ${bill.uncounted ? AMOUNT_NOT_KNOWN : bill.estimated ? "about " + money(bill.amount, state.homeCurrency) : money(bill.amount, state.homeCurrency)}, ${bill.covered ? "covered" : "short if clients pay late"}.`);
    }
    for (const invoice of state.invoices.filter(i => i.status === "sent" && i.sentOn)) {
      const client = state.clients.find(c => c.id === invoice.clientId);
      if (!client?.daysToPay.length) continue;
      if (addDays(invoice.sentOn!, medianLow(client.daysToPay) + 1) === today) notes.push(`${client.name} is past their usual payment date.`);
    }
    const title = `Money reminders · ${today}`;
    const [existing] = await tx.select({ id: events.id }).from(events)
      .where(and(eq(events.householdId, hid), eq(events.kind, "daily_reminder"), eq(events.title, title))).limit(1);
    if (notes.length && !existing) {
      await recordEvent(tx, hid, { madeBy: "cron", kind: "daily_reminder", title, body: notes.join(" "), notify: true });
    }
    if (household.nudgeAfterDays !== null) await suggestNudges(tx, hid, state, today, household.nudgeAfterDays);
    await observeRunway(tx, hid);
    return { ok: true };
  });
  // Last, so a Storage outage cannot stop the reminders above.
  await removeExpiredFiles(db, hid, now);
  return result;
}
