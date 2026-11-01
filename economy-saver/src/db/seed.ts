// Seeds a household with Ben's data: the demo household and every "Try it" copy (D34). Each call makes a fresh one.
// Fictional people and companies only.

import { benMoney } from "@/lib/sample/ben";
import { addDays } from "@/lib/money/runway";
import type { Db } from "./household";
import { toMinor, toRateMicro } from "./money";
import * as s from "./schema";

export type SeedOptions = {
  isDemo?: boolean; // true for the shared demo household; Try-it copies leave it false
  name?: string;
};

// Past paid invoices give each client their days-to-pay history: paid_on - sent_on reproduces benMoney's arrays.
// Fictional work, all paid well before the demo date.
const HISTORY_START = "2026-03-02";
const HISTORY_STEP_DAYS = 12;
const HISTORY_AMOUNT_USD: Record<string, number> = { "c-beacon": 350, "c-northwind": 700, "c-acme": 1_000 };

export async function seedBen(db: Db, opts: SeedOptions = {}): Promise<string> {
  const m = benMoney;
  const home = m.homeCurrency;

  return db.transaction(async (tx) => {
    // One shared daily reference rate; a second seed finds it already there.
    await tx
      .insert(s.fxRates)
      .values({ date: m.today, base: "USD", quote: home, rateMicro: toRateMicro(m.fxPerUsd) })
      .onConflictDoNothing();

    const [household] = await tx
      .insert(s.households)
      .values({
        name: opts.name ?? "Ben",
        timeZone: "Asia/Tokyo",
        homeCurrency: home,
        bankBalanceMinor: toMinor(m.bank, home),
        isDemo: opts.isDemo ?? false,
      })
      .returning({ id: s.households.id });
    const hid = household.id;

    const [member] = await tx.insert(s.members).values({ householdId: hid, displayName: "Ben", role: "owner" }).returning({ id: s.members.id });

    // The PayPal balance sits on the member's connection (sandbox only).
    await tx.insert(s.paypalConnections).values({
      householdId: hid,
      memberId: member.id,
      environment: "SANDBOX",
      balanceMinor: toMinor(m.paypal, home),
      balanceCurrency: home,
      fetchedAt: new Date(`${m.today}T00:00:00+09:00`),
    });

    const clientIds = new Map<string, string>();
    for (const c of m.clients) {
      const [row] = await tx
        .insert(s.clients)
        .values({ householdId: hid, name: c.name, email: c.email, termsDays: c.termsDays })
        .returning({ id: s.clients.id });
      clientIds.set(c.id, row.id);
    }

    const history: (typeof s.invoices.$inferInsert)[] = [];
    for (const c of m.clients) {
      c.daysToPay.forEach((days, i) => {
        const sentOn = addDays(HISTORY_START, i * HISTORY_STEP_DAYS);
        history.push({
          householdId: hid,
          clientId: clientIds.get(c.id)!,
          status: "paid",
          number: `H-${c.id.slice(2, 5)}-${i + 1}`,
          item: `Past project ${i + 1}`,
          amountMinor: toMinor(HISTORY_AMOUNT_USD[c.id] ?? 500, "USD"),
          currency: "USD",
          fxRateMicro: toRateMicro(m.fxPerUsd),
          sentOn,
          dueOn: addDays(sentOn, c.termsDays),
          paidOn: addDays(sentOn, days),
        });
      });
    }
    if (history.length) await tx.insert(s.invoices).values(history);

    await tx.insert(s.invoices).values(
      m.invoices.map((i) => ({
        householdId: hid,
        clientId: clientIds.get(i.clientId)!,
        status: i.status,
        number: i.number ?? null,
        item: i.item,
        note: i.note ?? null,
        amountMinor: toMinor(i.amountUsd, "USD"),
        currency: "USD",
        sentOn: i.sentOn ?? null,
        dueOn: i.dueOn ?? null,
      })),
    );

    const cardIds = new Map<string, string>();
    for (const c of m.cards) {
      const [row] = await tx
        .insert(s.cards)
        .values({
          householdId: hid,
          memberId: member.id,
          label: c.label,
          closingDay: c.closingDay,
          dueDay: c.dueDay,
          limitMinor: c.limit === undefined ? null : toMinor(c.limit, home),
          currency: home,
          revolving: c.revolving,
        })
        .returning({ id: s.cards.id });
      cardIds.set(c.id, row.id);
    }

    await tx.insert(s.cardStatements).values(
      m.statements.map((st) => ({
        householdId: hid,
        cardId: cardIds.get(st.cardId)!,
        amountMinor: toMinor(st.amount, home),
        currency: home,
        closedOn: st.closedOn,
        dueOn: st.dueOn,
      })),
    );

    await tx.insert(s.charges).values(
      m.charges.map((c) => ({
        householdId: hid,
        cardId: cardIds.get(c.cardId)!,
        merchant: c.merchant,
        amountMinor: toMinor(c.amount, home),
        currency: home,
        originalAmountMinor: c.original ? toMinor(c.original.amount, c.original.currency) : null,
        originalCurrency: c.original?.currency ?? null,
        date: c.date,
        source: c.source,
        status: c.status,
        place: c.place ?? null,
      })),
    );

    const billRows = await tx
      .insert(s.bills)
      .values(
        m.bills.map((b) => ({
          householdId: hid,
          biller: b.biller,
          amountMinor: toMinor(b.amount, home),
          currency: home,
          due: b.due,
          category: b.category,
          status: b.status,
          previousAmountMinor: b.previousAmount === undefined ? null : toMinor(b.previousAmount, home),
        })),
      )
      .returning({ id: s.bills.id, biller: s.bills.biller, status: s.bills.status, amountMinor: s.bills.amountMinor });

    // A little Activity so the page is not empty: the pending bill is what the To check row points at.
    const pending = billRows.find((b) => b.status === "pending");
    const at = (iso: string) => new Date(`${iso}+09:00`);
    await tx.insert(s.events).values([
      {
        householdId: hid,
        kind: "invoice_sent",
        title: "Invoice 1038 sent to Northwind",
        amountMinor: toMinor(800, "USD"),
        currency: "USD",
        occurredAt: at("2026-11-13T10:00:00"),
      },
      ...(pending
        ? [
            {
              householdId: hid,
              kind: "to_check",
              title: "Hikari Denki bill is higher than last month",
              amountMinor: pending.amountMinor,
              currency: home,
              refType: "bill",
              refId: pending.id,
              notify: true,
              occurredAt: at("2026-11-14T08:30:00"),
            },
          ]
        : []),
    ]);

    return hid;
  });
}
