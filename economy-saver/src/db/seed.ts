import { seedGeneralSpace } from "./spaces";
import { seedRules } from "./rules";
import { refreshSuggestions } from "./suggestions";
// Seeds a household with Ben's data: the demo household and every "Try it" copy (D34). Each call makes a fresh one.
// Fictional people and companies only.

import { benMoney, benOwnCategories, benStoredBills } from "@/lib/sample/ben";
import { nameKey } from "@/lib/money/name-key";
import { addDays } from "@/lib/money/runway";
import type { Db } from "./household";
import { DEMO_DATE } from "./clock";
import { newPayToken } from "@/lib/paypal/pay-link";
import { toMinor, toRateMicro } from "./money";
import * as s from "./schema";

type SeedOptions = {
  isDemo?: boolean; // true for demo households, including every Try-it copy
  name?: string;
};

// Past paid invoices give each client their days-to-pay history: paid_on - sent_on reproduces benMoney's arrays.
// Fictional work, spread over June to early November (every payment more than a week before the demo date, so none is a recent invoice) so the months of income have something to show.
const HISTORY_START = "2026-06-05";
const HISTORY_STEP_DAYS = 30;
const HISTORY_AMOUNT_USD: Record<string, number> = { "c-beacon": 350, "c-northwind": 700, "c-acme": 1_000 };

export async function seedBen(db: Db, opts: SeedOptions = {}): Promise<string> {
  const hid = await db.transaction(tx => seedBenRows(tx, opts));
  if (opts.isDemo) await refreshSuggestions(db, hid, "seedBen");
  return hid;
}

// The caller supplies the transaction so Reset can replace the old demo atomically.
export async function seedBenRows(tx: Db, opts: SeedOptions): Promise<string> {
  const m = benMoney;
  const home = m.homeCurrency;

  const [household] = await tx
    .insert(s.households)
    .values({
      name: opts.name ?? "Ben",
      timeZone: "Asia/Tokyo",
      homeCurrency: home,
      bankBalanceMinor: toMinor(m.bank, home),
      isDemo: opts.isDemo ?? false,
      fixedToday: opts.isDemo ? DEMO_DATE : null, // D51: the Try it date; a seeded owner household lives on the real one
    })
    .returning({ id: s.households.id });
  const hid = household.id;
  await seedGeneralSpace(tx, hid);
  // Queue independent inserts together on the transaction's single connection.
  // Each wave finishes before rows that reference it are inserted.
  const member = { id: crypto.randomUUID() };
  const clientIds = new Map(m.clients.map(c => [c.id, crypto.randomUUID()]));
  const cardIds = new Map(m.cards.map(c => [c.id, crypto.randomUUID()]));
  const ownIds = new Map(benOwnCategories.map(o => [o.id, crypto.randomUUID()]));
  const [, , , billRows] = await Promise.all([
    tx.insert(s.fxRates).values({
      householdId: hid, date: m.today, base: "USD", quote: home, rateMicro: toRateMicro(m.fxPerUsd),
    }),
    tx.insert(s.members).values({ id: member.id, householdId: hid, displayName: "Ben", role: "owner", shareBp: 10_000 }),
    tx.insert(s.clients).values(m.clients.map(c => ({
      id: clientIds.get(c.id)!, householdId: hid, name: c.name, email: c.email, termsDays: c.termsDays,
    }))),
    tx
      .insert(s.bills)
      .values(
        benStoredBills.map((b) => ({
          householdId: hid, madeBy: "form" as const,
          biller: b.biller,
          amountMinor: toMinor(b.amount, home),
          currency: home,
          due: b.due,
          category: b.category,
          businessBp: b.businessBp,
          status: b.status,
          previousAmountMinor: b.previousAmount === undefined ? null : toMinor(b.previousAmount, home),
          repeatDay: b.repeatDay ?? null,
          repeatUnit: b.repeatUnit ?? null,
        })),
      )
      .returning({ id: s.bills.id, biller: s.bills.biller, status: s.bills.status, amountMinor: s.bills.amountMinor }),
  ]);

  const history: (typeof s.invoices.$inferInsert)[] = [];
  for (const c of m.clients) {
    c.daysToPay.forEach((days, i) => {
      const sentOn = addDays(HISTORY_START, i * HISTORY_STEP_DAYS);
      history.push({
        householdId: hid, madeBy: "form" as const,
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

  // A little Activity so the page is not empty: the pending bill is what the To check row points at.
  const pending = billRows.find((b) => b.status === "pending");
  const at = (iso: string) => new Date(`${iso}+09:00`);
  const eventInsert = tx.insert(s.events).values([
    {
      householdId: hid, madeBy: "form" as const,
      kind: "invoice_sent",
      title: "Payment link made for Northwind",
      amountMinor: toMinor(800, "USD"),
      currency: "USD",
      occurredAt: at("2026-11-13T10:00:00"),
    },
    ...(pending
      ? [
          {
            householdId: hid, madeBy: "form" as const,
            kind: "to_check",
            title: "Hikari Denki bill is higher than last month",
            amountMinor: pending.amountMinor,
            currency: home,
            refType: "bill",
            refId: pending.id,
            notify: true,
            occurredAt: at("2026-11-14T00:00:00"), // the day's first moment: an event made at any time of the demo day sorts above it
          },
        ]
      : []),
  ]);

  await Promise.all([
    tx.insert(s.paypalConnections).values({
      householdId: hid,
      memberId: member.id,
      environment: "SANDBOX",
      balanceMinor: toMinor(m.paypal, home),
      balanceCurrency: home,
      fetchedAt: new Date(`${m.today}T00:00:00+09:00`),
    }),
    tx.insert(s.cards).values(m.cards.map(c => ({
      id: cardIds.get(c.id)!,
      householdId: hid,
      memberId: member.id,
      label: c.label,
      closingDay: c.closingDay,
      dueDay: c.dueDay,
      limitMinor: c.limit === undefined ? null : toMinor(c.limit, home),
      currency: home,
      revolving: c.revolving,
      foreignFeeBp: c.foreignFeeBp ?? null,
    }))),
    tx.insert(s.invoices).values([
      ...history,
      ...m.invoices.map((i) => ({
        householdId: hid, madeBy: "form" as const,
        clientId: clientIds.get(i.clientId)!,
        status: i.status,
        number: i.number ?? null,
        item: i.item,
        note: i.note ?? null,
        amountMinor: toMinor(i.amountUsd, "USD"),
        currency: "USD",
        sentOn: i.sentOn ?? null,
        dueOn: i.dueOn ?? null,
        payToken: i.status === "sent" ? newPayToken() : null, // a sent invoice has its payment link; the PayPal order is made when Pay is tapped
      })),
    ]),
    eventInsert,
  ]);

  await tx.insert(s.ownCategories).values(benOwnCategories.map(o => ({ id: ownIds.get(o.id)!, householdId: hid, kind: o.kind, name: o.name, nameKey: nameKey(o.name) })));
  await Promise.all([
    tx.insert(s.cardStatements).values(
      m.statements.map((st) => ({
        householdId: hid,
        cardId: cardIds.get(st.cardId)!,
        amountMinor: toMinor(st.amount, home),
        currency: home,
        closedOn: st.closedOn,
        dueOn: st.dueOn,
      })),
    ),
    tx.insert(s.charges).values(
      m.charges.map((c) => ({
        householdId: hid, madeBy: "form" as const,
        cardId: cardIds.get(c.cardId)!,
        merchant: c.merchant,
        amountMinor: toMinor(c.amount, home),
        currency: home,
        originalAmountMinor: c.original ? toMinor(c.original.amount, c.original.currency) : null,
        originalCurrency: c.original?.currency ?? null,
        date: c.date,
        category: c.category,
        businessBp: c.businessBp,
        source: c.source,
        status: c.status,
        place: c.place ?? null,
        ownCategoryId: c.own ? ownIds.get(c.own.id)! : null,
      })),
    ),
  ]);

  await seedRules(tx, hid);
  return hid;
}
