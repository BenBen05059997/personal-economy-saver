import { observeRunway } from "./runway-events";
import { and, eq } from "drizzle-orm";
import { addDays, closingOnOrAfter, cycle, dueItems, medianLow } from "@/lib/money/runway";
import { dayLabel, money } from "@/lib/money/format";
import { householdClock } from "./account";
import { loadMoneyState, recordEvent, requireHousehold, type Db } from "./household";
import { cardStatements, events, households } from "./schema";
import { toMinor } from "./money";
import { fetchReferenceRate, storeReferenceRate } from "./reference-rate";

export async function runDaily(db: Db, id: string, now = new Date()) {
  const hid = requireHousehold(id);
  const [household] = await db.select({ currency: households.homeCurrency, demo: households.isDemo })
    .from(households).where(eq(households.id, hid));
  if (!household) throw new Error("Scheduled household not found");
  const { today } = await householdClock(db, hid, now);
  const rate = !household.demo && household.currency === "JPY" ? await fetchReferenceRate() : null;
  return db.transaction(async tx => {
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
      notes.push(`${bill.label} is due ${dayLabel(bill.date)}: ${money(bill.amount, state.homeCurrency)}, ${bill.covered ? "covered" : "short if clients pay late"}.`);
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
      await recordEvent(tx, hid, { kind: "daily_reminder", title, body: notes.join(" "), notify: true, occurredAt: now });
    }
    await observeRunway(tx, hid);
    return { ok: true };
  });
}
