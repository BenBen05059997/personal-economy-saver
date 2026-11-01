import { cycle, dueItems, ladder, low, roomOnCard, series } from "@/lib/money/runway";
import type { Bill, Card, Charge, Invoice, MoneyState } from "@/lib/money/types";
import { PERSONAS, type Persona, type PersonaId } from "@/lib/sample/personas";
import { findInvoice, freshMoney, nextTime, seedLog, type Actor, type LogEntry } from "./demo";
import { dayLabel, homeFormat, usd } from "./format";

/** The moments the demo triggers can open on demand. */
export type DemoMoment = "statement";

export type AppState = {
  personaId: PersonaId;
  money: MoneyState;
  log: LogEntry[];
  editing: boolean; // the approval payload is open for edits
  playing: boolean; // the scripted demo is running
  opened: DemoMoment[]; // moments the person has asked to see (statement arrives)
  trip: string[]; // ids of the charges the travel demo has sent so far, in arrival order
  runId: number; // bumps on reset and on a persona switch, so cards drop their local field state
};

export type Action =
  | { type: "bank"; value: number }
  | { type: "editBill"; patch: Partial<Pick<Bill, "biller" | "amount" | "due">> }
  | { type: "category"; category: string }
  | { type: "confirm"; id?: string } // a pending bill; the demo bill when no id is given
  | { type: "editInvoice"; patch: Partial<Pick<Invoice, "item" | "note">> }
  | { type: "editing"; value: boolean }
  | { type: "decline" }
  | { type: "approve" }
  | { type: "sent" }
  | { type: "paid" }
  | { type: "tripStart" }
  | { type: "chargeArrives"; index: number }
  | { type: "chargeConfirm"; id: string }
  | { type: "chargeConfirmAll" }
  | { type: "chargeReject"; id: string }
  | { type: "editCard"; cardId: string; patch: Partial<Pick<Card, "closingDay" | "dueDay">> }
  | { type: "playing"; value: boolean }
  | { type: "toggleMoment"; moment: DemoMoment }
  | { type: "persona"; id: PersonaId }
  | { type: "reset" };

function opening(personaId: PersonaId, runId: number, playing = false): AppState {
  const persona = PERSONAS[personaId];
  const money = freshMoney(persona);
  return { personaId, money, log: seedLog(persona, money), editing: false, playing, opened: [], trip: [], runId };
}

export function initialState(): AppState {
  return opening("ben", 0);
}

function say(s: AppState, who: Actor, text: string, tool?: string): AppState {
  const entry: LogEntry = { id: (s.log[s.log.length - 1]?.id ?? 0) + 1, who, text, tool, tm: nextTime(s.log), fresh: true };
  return { ...s, log: [...s.log, entry] };
}

function mapBill(m: MoneyState, id: string, fn: (b: Bill) => Bill): MoneyState {
  return { ...m, bills: m.bills.map((b) => (b.id === id ? fn(b) : b)) };
}

function mapInvoice(m: MoneyState, id: string, fn: (i: Invoice) => Invoice): MoneyState {
  return { ...m, invoices: m.invoices.map((i) => (i.id === id ? fn(i) : i)) };
}

const tripId = (index: number) => `trip-${index}`;

/** The one line that follows a confirmation: the card's running total, the statement it lands in and the room left on it. */
function cardLine(m: MoneyState, cardId: string): string {
  const fmt = homeFormat(m);
  const card = m.cards.find((c) => c.id === cardId);
  const cy = cycle(m, cardId);
  return `${card?.label ?? "The card"} is now ${fmt(cy.openTotal)} for the statement due ${dayLabel(cy.dueOn)}. Room on ${card?.label ?? "the card"}: ${fmt(roomOnCard(m, cardId).room)}.`;
}

function mapCharge(m: MoneyState, id: string, fn: (c: Charge) => Charge): MoneyState {
  return { ...m, charges: m.charges.map((c) => (c.id === id ? fn(c) : c)) };
}

export function reducer(s: AppState, a: Action): AppState {
  const m = s.money;
  const persona: Persona = PERSONAS[s.personaId];
  const { billId: BILL_ID, invoiceId: INVOICE_ID, invoiceNumber: INVOICE_NUMBER } = persona.demo;
  const fmt = homeFormat(m);
  const bill = m.bills.find((b) => b.id === BILL_ID);
  const inv = findInvoice(m, persona);

  switch (a.type) {
    case "bank":
      return { ...s, money: { ...m, bank: a.value } };

    case "editBill":
      return { ...s, money: mapBill(m, BILL_ID, (b) => ({ ...b, ...a.patch })) };

    case "category":
      if (!bill) return s;
      return say({ ...s, money: mapBill(m, BILL_ID, (b) => ({ ...b, category: a.category })) }, "You", `Changed category to ${a.category}. Saved as a rule for next time.`);

    case "confirm": {
      const target = a.id ? m.bills.find((b) => b.id === a.id) : bill;
      if (!target || target.status !== "pending") return s;
      let next: AppState = { ...s, money: mapBill(m, target.id, (b) => ({ ...b, status: "confirmed" as const })) };
      next = say(next, "You", `Confirmed ${target.biller} ${fmt(target.amount)}, due ${dayLabel(target.due)}.`);
      const lw = low(series(next.money, "worst"));
      const ways = ladder(next.money).length;
      next = say(
        next,
        "AI",
        lw.amount < 0
          ? `Worst case is now ${fmt(-lw.amount)} short on ${dayLabel(lw.date)}. Compared ${ways} ways to cover it.`
          : `Worst case stays above ${fmt(0)}. Lowest point is ${fmt(lw.amount)} on ${dayLabel(lw.date)}.`,
      );
      const draft = findInvoice(next.money, persona);
      if (target.id === BILL_ID && draft && draft.status === "unbilled") {
        const client = next.money.clients.find((c) => c.id === draft.clientId);
        next = say(next, "AI", `Drafted invoice ${INVOICE_NUMBER} to ${client?.name ?? "the client"}, ${usd(draft.amountUsd)}. Draft only.`, "create_invoice");
      }
      return next;
    }

    case "editInvoice":
      return { ...s, money: mapInvoice(m, INVOICE_ID, (i) => ({ ...i, ...a.patch })) };

    case "editing":
      return { ...s, editing: a.value };

    case "decline":
      return say(s, "You", "Declined. The invoice stays a draft in PayPal.");

    case "approve": {
      if (!inv || inv.status !== "unbilled") return s;
      const next = { ...s, editing: false, money: mapInvoice(m, INVOICE_ID, (i) => ({ ...i, status: "draft" as const, number: INVOICE_NUMBER, dueOn: m.today })) };
      return say(next, "You", `Approved sending ${INVOICE_NUMBER}.`);
    }

    case "sent": {
      if (!inv || inv.status !== "draft") return s;
      const client = m.clients.find((c) => c.id === inv.clientId);
      const next = { ...s, money: mapInvoice(m, INVOICE_ID, (i) => ({ ...i, status: "sent" as const, sentOn: m.today })) };
      return say(next, "PayPal", `Invoice ${INVOICE_NUMBER} sent to ${client?.name ?? "the client"}. Status SENT.`, "send_invoice");
    }

    case "paid": {
      if (!inv || inv.status !== "sent") return s;
      const credited: MoneyState = {
        ...mapInvoice(m, INVOICE_ID, (i) => ({ ...i, status: "paid" as const })),
        paypal: m.paypal + Math.round(inv.amountUsd * m.fxPerUsd),
      };
      let next: AppState = say({ ...s, money: credited }, "Webhook", `INVOICING.INVOICE.PAID for ${INVOICE_NUMBER}. Signature verified with PayPal.`);
      const lw = low(series(credited, "worst"));
      next = say(
        next,
        "AI",
        lw.amount >= 0
          ? "Runway updated. Covered for the next 30 days, even if clients pay late."
          : `Runway updated. Still ${fmt(-lw.amount)} short on ${dayLabel(lw.date)} in the worst case.`,
      );
      return next;
    }

    case "tripStart": {
      // Starting again drops the charges of an earlier run, so the demo can be replayed.
      const gone = new Set(s.trip);
      return { ...s, trip: [], money: { ...m, charges: m.charges.filter((c) => !gone.has(c.id)) } };
    }

    case "chargeArrives": {
      const trip = persona.demo.trip;
      const t = trip.charges[a.index];
      const card = m.cards.find((c) => c.id === trip.cardId);
      if (!t || !card || m.charges.some((c) => c.id === tripId(a.index))) return s;
      const charge: Charge = { id: tripId(a.index), cardId: card.id, merchant: t.merchant, amount: t.amount, date: t.date, source: "card_email", status: "pending", place: trip.place };
      const next = { ...s, trip: [...s.trip, charge.id], money: { ...m, charges: [...m.charges, charge] } };
      return say(next, "Email", `Card email: ${card.label} ${fmt(t.amount)} at ${t.merchant}, ${trip.place} (${dayLabel(t.date)}). Waiting for you to confirm.`);
    }

    case "chargeConfirm": {
      const c = m.charges.find((x) => x.id === a.id);
      if (!c || c.status !== "pending") return s;
      const money = mapCharge(m, a.id, (x) => ({ ...x, status: "confirmed" as const }));
      return say({ ...s, money }, "AI", `Confirmed ${fmt(c.amount)} at ${c.merchant}. ${cardLine(money, c.cardId)}`);
    }

    case "chargeConfirmAll": {
      const waiting = m.charges.filter((c) => c.status === "pending");
      if (waiting.length === 0) return s;
      const money: MoneyState = { ...m, charges: m.charges.map((c) => (c.status === "pending" ? { ...c, status: "confirmed" as const } : c)) };
      const total = waiting.reduce((sum, c) => sum + c.amount, 0);
      const cardId = waiting[waiting.length - 1].cardId;
      return say({ ...s, money }, "AI", `Confirmed ${waiting.length} charge${waiting.length === 1 ? "" : "s"}, ${fmt(total)} in all. ${cardLine(money, cardId)}`);
    }

    case "chargeReject": {
      const c = m.charges.find((x) => x.id === a.id);
      if (!c || c.status !== "pending") return s;
      const card = m.cards.find((x) => x.id === c.cardId);
      const money = { ...m, charges: m.charges.filter((x) => x.id !== a.id) };
      return say({ ...s, money }, "You", `Marked ${fmt(c.amount)} at ${c.merchant} as not yours. Nothing added to ${card?.label ?? "the card"}.`);
    }

    case "editCard": {
      const card = m.cards.find((c) => c.id === a.cardId);
      if (!card) return s;
      const money = { ...m, cards: m.cards.map((c) => (c.id === a.cardId ? { ...c, ...a.patch } : c)) };
      const cy = cycle(money, a.cardId);
      const st = dueItems(money, 30).find((d) => d.cardId === a.cardId && d.date === cy.dueOn);
      return say(
        { ...s, money },
        "You",
        `${card.label}: closes on day ${a.patch.closingDay ?? card.closingDay}, paid on day ${a.patch.dueDay ?? card.dueDay}. Next statement closes ${dayLabel(cy.closesOn)}, due ${dayLabel(cy.dueOn)}${st ? "" : " (after the next 30 days)"}.`,
      );
    }

    case "playing":
      return { ...s, playing: a.value };

    case "toggleMoment":
      return { ...s, opened: s.opened.includes(a.moment) ? s.opened.filter((x) => x !== a.moment) : [...s.opened, a.moment] };

    case "persona":
      return opening(a.id, s.runId + 1);

    case "reset":
      return opening(s.personaId, s.runId + 1, s.playing);
  }
}

export type Stage = "bill" | "approve" | "sending" | "sent" | "paid" | "none";

/** Which card the needs-you slot shows. Read from the data, not stored. */
export function stageOf(m: MoneyState, p: Persona): Stage {
  if (m.bills.some((b) => b.status === "pending")) return "bill";
  const inv = findInvoice(m, p);
  if (!inv) return "none";
  switch (inv.status) {
    case "unbilled":
      return "approve";
    case "draft":
      return "sending";
    case "sent":
      return "sent";
    case "paid":
      return "paid";
  }
}
