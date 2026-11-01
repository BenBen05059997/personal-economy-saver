// The runway maths. Pure functions over a MoneyState: no React, no clock, no I/O.
//
// Rules:
// - Every amount is in the state's home currency; USD invoices convert with fxPerUsd (1 for a USD home).
// - An invoice that is `sent` arrives on sentOn + median(daysToPay) (expected) or
//   sentOn + max(daysToPay) (worst), never before tomorrow. The median of an even list is the lower middle value.
// - Paid invoices are not arrivals: paying moves the money into the PayPal balance.
// - Pending bills and pending charges (read by the AI, not yet confirmed) are left out of the series.
// - A closed card statement is an out-flow on its due date. The open cycle of each card (confirmed
//   charges after the last close, up to the next closing day) is an out-flow on the due date of the
//   statement it will become: dueDay of the month after the one it closes in.
// - Dates are YYYY-MM-DD strings and are handled in UTC, so the maths does not depend on the time zone.

import type { Context, Currency, Moment, Profile } from "@/lib/catalogue/types";
import { dayLabel as label, formatter, money, usd } from "./format";
import type { Bill, Card, Charge, Client, Invoice, MoneyState } from "./types";

// ---------------------------------------------------------------- dates

const DAY_MS = 86_400_000;

function toUtc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(iso: string, n: number): string {
  return new Date(toUtc(iso) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from a to b (b minus a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

// ---------------------------------------------------------------- cards

const pad = (n: number) => String(n).padStart(2, "0");

/** The date `day` falls on in the given month (month 1-12, may overflow), clamped to the month's length (31 = month end). */
function dateIn(year: number, month: number, day: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const y = first.getUTCFullYear();
  const m = first.getUTCMonth() + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${pad(m)}-${pad(Math.min(Math.max(1, day), last))}`;
}

/** Closing date of the cycle a date falls in: the first closing day on or after `iso`. */
export function closingOnOrAfter(card: Card, iso: string): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const here = dateIn(y, m, card.closingDay);
  return here >= iso ? here : dateIn(y, m + 1, card.closingDay);
}

/** The last closing date strictly before `iso`. */
function closingBefore(card: Card, iso: string): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const here = dateIn(y, m, card.closingDay);
  return here < iso ? here : dateIn(y, m - 1, card.closingDay);
}

/** The day a statement that closes on `closesOn` is paid: dueDay of the following month. */
export function dueDateFor(card: Card, closesOn: string): string {
  return dateIn(Number(closesOn.slice(0, 4)), Number(closesOn.slice(5, 7)) + 1, card.dueDay);
}

/** A statement to pay: one that has closed, or the one an open cycle is still building. */
export type StatementItem = {
  cardId: string;
  label: string; // "Card B statement"
  amount: number;
  closedOn?: string; // closed statements only
  closesOn: string;
  dueOn: string;
  open: boolean; // true while the cycle can still take charges
};

export type Cycle = {
  openTotal: number; // confirmed charges in the cycle that closes next
  closesOn: string;
  dueOn: string;
  charges: Charge[]; // those charges, oldest first
};

const byDate = (a: Charge, b: Charge) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/** Confirmed charges after the last close and up to the next closing day: the statement still being built. */
export function cycle(state: MoneyState, cardId: string): Cycle {
  const card = state.cards.find((c) => c.id === cardId);
  if (!card) return { openTotal: 0, closesOn: state.today, dueOn: state.today, charges: [] };
  const lastClose = closingBefore(card, state.today);
  const closesOn = closingOnOrAfter(card, state.today);
  const charges = state.charges.filter((c) => c.cardId === cardId && c.status === "confirmed" && c.date > lastClose && c.date <= closesOn).sort(byDate);
  return { openTotal: charges.reduce((sum, c) => sum + c.amount, 0), closesOn, dueOn: dueDateFor(card, closesOn), charges };
}

/** Charges read from an email or receipt that wait for the user to confirm them. They are left out of every total. */
export function pendingCharges(state: MoneyState, cardId?: string): Charge[] {
  return state.charges.filter((c) => c.status === "pending" && (!cardId || c.cardId === cardId)).sort(byDate);
}

/** Every statement still to be paid, soonest first: the closed ones, then one per cycle that holds confirmed charges. */
export function statementItems(state: MoneyState): StatementItem[] {
  const out: StatementItem[] = [];
  for (const card of state.cards) {
    for (const st of state.statements) {
      if (st.cardId === card.id && st.dueOn >= state.today) {
        out.push({ cardId: card.id, label: `${card.label} statement`, amount: st.amount, closedOn: st.closedOn, closesOn: st.closedOn, dueOn: st.dueOn, open: false });
      }
    }
    const lastClose = closingBefore(card, state.today);
    const byClose = new Map<string, number>();
    for (const c of state.charges) {
      if (c.cardId !== card.id || c.status !== "confirmed" || c.date <= lastClose) continue;
      const close = closingOnOrAfter(card, c.date);
      byClose.set(close, (byClose.get(close) ?? 0) + c.amount);
    }
    for (const [closesOn, amount] of byClose) {
      out.push({ cardId: card.id, label: `${card.label} statement`, amount, closesOn, dueOn: dueDateFor(card, closesOn), open: true });
    }
  }
  return out.sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : a.cardId < b.cardId ? -1 : 1));
}

// ---------------------------------------------------------------- series

/** End-of-day balances in the home currency, one per day from `today`. Carries its start date so `low` can name the day. */
export type Series = number[] & { startDate?: string };

export type SeriesKind = "expected" | "worst";

export type Arrival = {
  invoiceId: string;
  clientId: string;
  clientName: string;
  number?: string;
  amountUsd: number;
  amountHome: number; // the invoice in the home currency
  sentOn: string;
  expectedOn: string;
  worstOn: string;
};

function medianLow(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

/**
 * Where an invoice sent on `sentOn` is expected to land. Used for sent invoices and,
 * with sentOn = today, for what an unbilled invoice would do if it were sent now.
 */
export function project(state: MoneyState, invoice: Invoice, sentOn: string = invoice.sentOn ?? state.today): Arrival {
  const client: Client | undefined = state.clients.find((c) => c.id === invoice.clientId);
  const history = client?.daysToPay ?? [];
  const tomorrow = addDays(state.today, 1);
  const later = (iso: string) => (iso < tomorrow ? tomorrow : iso);
  const fallback = invoice.dueOn ?? addDays(sentOn, client?.termsDays ?? 0);
  const expectedOn = later(history.length ? addDays(sentOn, medianLow(history)) : fallback);
  const worstOn = later(history.length ? addDays(sentOn, Math.max(...history)) : fallback);
  return {
    invoiceId: invoice.id,
    clientId: invoice.clientId,
    clientName: client?.name ?? "Client",
    number: invoice.number,
    amountUsd: invoice.amountUsd,
    amountHome: Math.round(invoice.amountUsd * state.fxPerUsd),
    sentOn,
    expectedOn,
    worstOn,
  };
}

/** Expected and worst dates plus the home-currency amount for every sent invoice. */
export function arrivals(state: MoneyState): Arrival[] {
  return state.invoices.filter((i) => i.status === "sent").map((i) => project(state, i));
}

export function series(state: MoneyState, kind: SeriesKind, days = 30): Series {
  const delta = new Array<number>(days).fill(0);
  for (const b of state.bills) {
    if (b.status !== "confirmed") continue;
    const i = daysBetween(state.today, b.due);
    if (i >= 0 && i < days) delta[i] -= b.amount;
  }
  for (const st of statementItems(state)) {
    const i = daysBetween(state.today, st.dueOn);
    if (i >= 0 && i < days) delta[i] -= st.amount;
  }
  for (const a of arrivals(state)) {
    const i = daysBetween(state.today, kind === "expected" ? a.expectedOn : a.worstOn);
    if (i >= 0 && i < days) delta[i] += a.amountHome;
  }
  const out: Series = [];
  let bal = state.paypal + state.bank;
  for (let i = 0; i < days; i++) {
    bal += delta[i];
    out.push(bal);
  }
  out.startDate = state.today;
  return out;
}

export type LowPoint = { amount: number; dayIndex: number; date: string };

/** The lowest balance in the series (the first day, if it is reached more than once). */
export function low(s: readonly number[], startDate?: string): LowPoint {
  let amount = Infinity;
  let dayIndex = 0;
  s.forEach((v, i) => {
    if (v < amount) {
      amount = v;
      dayIndex = i;
    }
  });
  const start = startDate ?? (s as Series).startDate;
  return { amount: s.length ? amount : 0, dayIndex, date: start ? addDays(start, dayIndex) : "" };
}

export type Run = { from: number; to: number }; // inclusive day indexes

/** Contiguous days below zero. `tolerance` ignores balances within that many units of zero. */
export function shortRuns(s: readonly number[], tolerance = 0): Run[] {
  const runs: Run[] = [];
  s.forEach((v, i) => {
    if (v >= -tolerance) return;
    const last = runs[runs.length - 1];
    if (last && last.to === i - 1) last.to = i;
    else runs.push({ from: i, to: i });
  });
  return runs;
}

/** What happens on one day: confirmed bills and card statements due, and invoices expected or worst-case arriving. */
export function dayEvents(state: MoneyState, dayIndex: number): { bills: Bill[]; statements: StatementItem[]; expected: Arrival[]; worst: Arrival[] } {
  const date = addDays(state.today, dayIndex);
  const arr = arrivals(state);
  return {
    bills: state.bills.filter((b) => b.status === "confirmed" && b.due === date),
    statements: statementItems(state).filter((st) => st.dueOn === date),
    expected: arr.filter((a) => a.expectedOn === date),
    worst: arr.filter((a) => a.worstOn === date),
  };
}

// ---------------------------------------------------------------- due soon

export type DueItem = {
  id: string;
  kind: "bill" | "statement";
  label: string; // "Rent", "Card B statement"
  amount: number;
  date: string;
  covered: boolean; // worst-case balance on the due date is at least zero
  worstBalance: number; // worst-case balance at the end of the due date
  expectedBalance: number; // expected-case balance at the end of the due date
  expectedCovered: boolean;
  pending?: boolean; // a bill read by the AI and not confirmed yet; judged as if it were confirmed
  open?: boolean; // a statement whose cycle can still take charges
  cardId?: string;
};

/**
 * Bills and card statements (closed and open) due in the next `days` days, soonest first. Each says whether the
 * money is there on its due date, even if clients pay late (covered) and when they pay as usual (expectedCovered).
 */
export function dueItems(state: MoneyState, days = 30): DueItem[] {
  const worst = series(state, "worst", days);
  const expected = series(state, "expected", days);
  const hasPending = state.bills.some((b) => b.status === "pending");
  const ifAll = hasPending ? { ...state, bills: state.bills.map((b) => ({ ...b, status: "confirmed" as const })) } : state;
  const worstAll = hasPending ? series(ifAll, "worst", days) : worst;
  const expectedAll = hasPending ? series(ifAll, "expected", days) : expected;
  const items: DueItem[] = [];
  const add = (item: Omit<DueItem, "covered" | "worstBalance" | "expectedBalance" | "expectedCovered">, w: Series, e: Series) => {
    const i = daysBetween(state.today, item.date);
    if (i < 0 || i >= days) return;
    items.push({ ...item, covered: w[i] >= 0, worstBalance: w[i], expectedBalance: e[i], expectedCovered: e[i] >= 0 });
  };
  for (const b of state.bills) {
    const pending = b.status === "pending";
    add({ id: b.id, kind: "bill", label: b.biller, amount: b.amount, date: b.due, ...(pending ? { pending } : {}) }, pending ? worstAll : worst, pending ? expectedAll : expected);
  }
  for (const st of statementItems(state)) {
    add({ id: `st-${st.cardId}-${st.closesOn}`, kind: "statement", label: st.label, amount: st.amount, date: st.dueOn, open: st.open, cardId: st.cardId }, worst, expected);
  }
  return items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind === b.kind ? 0 : a.kind === "statement" ? -1 : 1));
}

/** Days from today that cover the 30-day runway and every known statement, Card A's later cycle included. */
export function planWindow(state: MoneyState): number {
  let last = 0;
  for (const st of statementItems(state)) last = Math.max(last, daysBetween(state.today, st.dueOn));
  for (const c of state.cards) last = Math.max(last, daysBetween(state.today, cycle(state, c.id).dueOn));
  return Math.max(30, last + 1);
}

export type CardRoom = {
  room: number; // what could still go on the card and be paid in full, even if clients pay late
  dueOn: string; // the statement a charge made today joins
  through: string; // the last day the room is checked against
  limitLeft?: number; // the card's limit less what it already carries, when it has a limit
  capped: boolean; // true when the limit, not the balance, sets the room
};

/**
 * How much more could go on one card today. A charge made today is paid on the card's next due date, so it can only
 * hurt the balance from that date on: room is the lowest worst-case balance from then to the end of the window, never
 * below zero, and never more than what is left of the card's limit.
 */
export function roomOnCard(state: MoneyState, cardId: string): CardRoom {
  const card = state.cards.find((c) => c.id === cardId);
  const cy = cycle(state, cardId);
  const days = planWindow(state);
  // A bill waiting for the user's yes is counted as if confirmed, so the room never looks bigger than it will be.
  const ifConfirmed = state.bills.some((b) => b.status === "pending") ? { ...state, bills: state.bills.map((b) => ({ ...b, status: "confirmed" as const })) } : state;
  const worst = series(ifConfirmed, "worst", days);
  const from = Math.min(days - 1, Math.max(0, daysBetween(state.today, cy.dueOn)));
  const byBalance = Math.max(0, Math.min(...worst.slice(from)));
  const through = addDays(state.today, days - 1);
  if (!card || card.limit === undefined) return { room: byBalance, dueOn: cy.dueOn, through, capped: false };
  const closedUnpaid = state.statements.filter((st) => st.cardId === cardId && st.dueOn >= state.today).reduce((sum, st) => sum + st.amount, 0);
  const pending = pendingCharges(state, cardId).reduce((sum, c) => sum + c.amount, 0);
  const limitLeft = card.limit - (cy.openTotal + closedUnpaid + pending);
  const cap = Math.max(0, limitLeft);
  return { room: Math.min(byBalance, cap), dueOn: cy.dueOn, through, limitLeft, capped: cap < byBalance };
}

// ---------------------------------------------------------------- ladder

export type Rung = {
  id: "invoice" | "remind" | "advance" | "discount";
  title: string;
  detail: string;
  cost: number; // home currency
  costLabel: string;
  verdict: string;
  pick: boolean;
};

export const EARLY_DISCOUNT = 0.02;

/** What a card cash advance costs, per home currency. The fee is flatFee + feePct of the amount, never below minFee. */
export type AdvanceTerms = { apr: number; flatFee: number; feePct: number; minFee: number };
export const ADVANCE_TERMS: Record<Currency, AdvanceTerms> = {
  JPY: { apr: 0.18, flatFee: 220, feePct: 0, minFee: 0 }, // 18% a year plus a ¥220 ATM fee
  USD: { apr: 0.28, flatFee: 0, feePct: 0.05, minFee: 10 }, // 28% a year plus 5% of the advance, $10 minimum
};

const short = (name: string) => name.split(" ")[0];
const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Cost of a card cash advance for `gap` home-currency units over `days` days. */
export function advanceCost(gap: number, days: number, currency: Currency = "JPY"): number {
  const t = ADVANCE_TERMS[currency];
  return Math.round((gap * t.apr * days) / 365) + Math.round(Math.max(t.minFee, t.flatFee + gap * t.feePct));
}

function advanceFeeText(c: Currency): string {
  const t = ADVANCE_TERMS[c];
  return t.feePct > 0
    ? `a ${Math.round(t.feePct * 100)}% cash-advance fee (${money(t.minFee, c)} minimum)`
    : `a ${money(t.flatFee, c)} ATM fee`;
}

/**
 * The ways to cover the worst-case gap, cheapest first. Empty when there is no gap.
 * The gap is the lowest worst-case balance, and it is judged on the day that low is reached.
 */
export function ladder(state: MoneyState): Rung[] {
  const cur = state.homeCurrency;
  const home = formatter(cur);
  const worst = series(state, "worst");
  const lw = low(worst);
  const gap = Math.max(0, -lw.amount);
  if (gap <= 0) return [];
  const gapDay = label(lw.date);
  const sent = arrivals(state);
  const rows: Rung[] = [];
  const works = new Set<Rung["id"]>(); // rungs that close the gap

  // 1. Invoice the unbilled work.
  const unbilled = state.invoices.find((i) => i.status === "unbilled");
  if (unbilled) {
    const p = project(state, unbilled, state.today);
    const hist = state.clients.find((c) => c.id === unbilled.clientId)?.daysToPay ?? [];
    const med = hist.length ? medianLow(hist) : 0;
    const covers = p.amountHome >= gap && p.worstOn < lw.date;
    rows.push({
      id: "invoice",
      title: `Invoice ${p.clientName} for ${lowerFirst(unbilled.item)}`,
      detail: `${usd(p.amountUsd)}${cur === "USD" ? "" : ` (about ${home(p.amountHome)})`}. ${short(p.clientName)} usually pays in ${plural(med, "day")}.`,
      cost: 0,
      costLabel: `${home(0)} extra`,
      verdict: covers ? "Cheapest. Covers it." : p.worstOn >= lw.date ? "May land too late" : `Covers ${home(p.amountHome)} of it`,
      pick: false,
    });
    if (covers) works.add("invoice");
  }

  // 2. Remind the clients with sent invoices.
  if (sent.length) {
    const late = sent.some((a) => a.worstOn > lw.date);
    const names = sent.map((a) => short(a.clientName));
    const slowest = sent.map((a) => {
      const hist = state.clients.find((c) => c.id === a.clientId)?.daysToPay ?? [];
      return hist.length ? Math.max(...hist) : 0;
    });
    rows.push({
      id: "remind",
      title: `Remind ${names.join(" and ")}`,
      detail: late
        ? `Their slowest payments took ${slowest.join(" and ")} days. A reminder may not land by ${gapDay}.`
        : `They usually pay before ${gapDay}. A reminder should land in time.`,
      cost: 0,
      costLabel: home(0),
      verdict: late ? "May be too late" : "Should land in time",
      pick: false,
    });
    if (!late && sent.every((a) => a.expectedOn <= lw.date)) works.add("remind");
  }

  // 3. Card cash advance until the first worst-case arrival after the gap date.
  const next = sent.map((a) => a.worstOn).filter((d) => d > lw.date).sort()[0];
  const days = Math.max(1, next ? daysBetween(lw.date, next) : worst.length - lw.dayIndex);
  const adv = advanceCost(gap, days, cur);
  rows.push({
    id: "advance",
    title: `Card cash advance for ${plural(days, "day")}`,
    detail: `${Math.round(ADVANCE_TERMS[cur].apr * 100)}% a year on ${home(gap)}, plus ${advanceFeeText(cur)}.`,
    cost: adv,
    costLabel: "≈" + home(adv),
    verdict: "Works",
    pick: false,
  });
  works.add("advance");

  // 4. Offer the largest sent invoice an early-payment discount.
  const biggest = [...sent].sort((a, b) => b.amountHome - a.amountHome)[0];
  if (biggest) {
    const cost = Math.round(biggest.amountHome * EARLY_DISCOUNT);
    const ratio = Math.round(cost / adv);
    const dearer = ratio >= 2 ? `About ${ratio}× the cash advance` : "Costs more than the cash advance";
    rows.push({
      id: "discount",
      title: `Offer ${short(biggest.clientName)} ${Math.round(EARLY_DISCOUNT * 100)}% off to pay now`,
      detail: `${Math.round(EARLY_DISCOUNT * 100)}% of invoice${biggest.number ? " #" + biggest.number : ""} (${usd(biggest.amountUsd)}).`,
      cost,
      costLabel: home(cost),
      verdict: dearer,
      pick: false,
    });
    if (biggest.amountHome >= gap) works.add("discount");
  }

  rows.sort((a, b) => a.cost - b.cost);
  const pick = rows.find((r) => works.has(r.id))?.id;
  return rows.map((r) => ({ ...r, pick: r.id === pick }));
}

// ---------------------------------------------------------------- timeline

export type TimelineEvent = {
  id: string;
  date: string;
  kind: "bill" | "statement" | "arrival";
  label: string; // "Rent", "Card B statement", "Acme Corp"
  amount: number; // signed, home currency: negative goes out, positive comes in
  balance: number; // running balance after this event; a pending bill is not counted
  covered: boolean; // the balance at the end of that day is at least zero
  pending?: boolean; // a bill read by the AI and not confirmed yet; judged as if it were confirmed
  open?: boolean; // a statement whose cycle can still take charges
  cardId?: string;
  clientId?: string;
  number?: string; // invoice number, arrivals only
};

/**
 * Every dated event in the window with the running balance after it. `kind` picks when clients pay: on their
 * usual day (expected) or on their slowest (worst). On one day money in comes first, so the last event of a day
 * ends on the same balance `series` gives for that day. The balance of a pending bill is not counted.
 */
export function timeline(state: MoneyState, kind: SeriesKind, days = 30): TimelineEvent[] {
  const day = series(state, kind, days);
  const hasPending = state.bills.some((b) => b.status === "pending");
  const dayAll = hasPending ? series({ ...state, bills: state.bills.map((b) => ({ ...b, status: "confirmed" as const })) }, kind, days) : day;
  const inWindow = (iso: string) => {
    const i = daysBetween(state.today, iso);
    return i >= 0 && i < days;
  };
  type Draft = Omit<TimelineEvent, "balance" | "covered">;
  const drafts: Draft[] = [];
  for (const b of state.bills) {
    if (!inWindow(b.due)) continue;
    drafts.push({ id: b.id, date: b.due, kind: "bill", label: b.biller, amount: -b.amount, ...(b.status === "pending" ? { pending: true } : {}) });
  }
  for (const st of statementItems(state)) {
    if (!inWindow(st.dueOn)) continue;
    drafts.push({ id: `st-${st.cardId}-${st.closesOn}`, date: st.dueOn, kind: "statement", label: st.label, amount: -st.amount, open: st.open, cardId: st.cardId });
  }
  for (const a of arrivals(state)) {
    const date = kind === "expected" ? a.expectedOn : a.worstOn;
    if (!inWindow(date)) continue;
    drafts.push({ id: `${a.invoiceId}-${kind}`, date, kind: "arrival", label: a.clientName, amount: a.amountHome, clientId: a.clientId, ...(a.number ? { number: a.number } : {}) });
  }
  const rank = { arrival: 0, statement: 1, bill: 2 } as const;
  drafts.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : rank[x.kind] - rank[y.kind]));
  let bal = state.paypal + state.bank;
  return drafts.map((d) => {
    if (!d.pending) bal += d.amount;
    const i = daysBetween(state.today, d.date);
    return { ...d, balance: bal, covered: (d.pending ? dayAll[i] : day[i]) >= 0 };
  });
}

// ---------------------------------------------------------------- safe to spend

export type SafeToSpend = {
  amount: number; // the lowest worst-case balance in the window, never below zero
  low: LowPoint; // where that lowest balance is reached
  verdict: "hold" | "easy" | "go"; // hold off: below zero. go easy: under a month of essentials. go: otherwise
  cash: number; // PayPal + bank today
  shortBy: number; // how far below zero the worst case goes (0 when it does not)
  lateClients: string[]; // first names of the clients whose worst-case payment lands after the low
};

export function safeToSpend(state: MoneyState, monthlyEssentials: number, days = 30): SafeToSpend {
  const lw = low(series(state, "worst", days));
  const amount = Math.max(0, lw.amount);
  const verdict = lw.amount < 0 ? "hold" : amount < monthlyEssentials ? "easy" : "go";
  const lateClients = [...new Set(arrivals(state).filter((a) => a.worstOn > lw.date).map((a) => short(a.clientName)))];
  return { amount, low: lw, verdict, cash: state.paypal + state.bank, shortBy: Math.max(0, -lw.amount), lateClients };
}

// ---------------------------------------------------------------- what pays a card back

export type Payback = {
  cardId: string;
  amount: number;
  dueOn: string;
  open: boolean;
  source: "bank" | "clients" | "short";
  /** "clients": the arrivals that make it covered, soonest first. "short": every sent invoice, soonest first. */
  arrivals: Arrival[];
  cashBalance: number; // balance on the due date with no client money at all
  worstBalance: number; // worst-case balance on the due date
};

/**
 * Where the soonest statement of a card is paid from. From the bank when the cash already covers it and every
 * other bill due by then; from clients when it is covered only after an invoice lands (the fewest, in worst-case order).
 */
export function paybackFor(state: MoneyState, cardId: string): Payback | undefined {
  const st = statementItems(state).find((s) => s.cardId === cardId);
  if (!st) return undefined;
  const idx = daysBetween(state.today, st.dueOn);
  const days = Math.max(planWindow(state), idx + 1);
  const cashBalance = series({ ...state, invoices: state.invoices.filter((i) => i.status !== "sent") }, "worst", days)[idx];
  const worstBalance = series(state, "worst", days)[idx];
  const base = { cardId, amount: st.amount, dueOn: st.dueOn, open: st.open, cashBalance, worstBalance };
  const all = arrivals(state).sort((a, b) => (a.worstOn < b.worstOn ? -1 : a.worstOn > b.worstOn ? 1 : 0));
  if (cashBalance >= 0) return { ...base, source: "bank", arrivals: [] };
  const need: Arrival[] = [];
  let bal = cashBalance;
  for (const a of all.filter((x) => x.worstOn <= st.dueOn)) {
    if (bal >= 0) break;
    need.push(a);
    bal += a.amountHome;
  }
  return bal >= 0 ? { ...base, source: "clients", arrivals: need } : { ...base, source: "short", arrivals: all };
}

// ---------------------------------------------------------------- context for the catalogue

export function context(state: MoneyState, profile: Profile, moment: Moment, event?: Context["event"]): Context {
  return {
    today: state.today,
    moment,
    cashToday: state.paypal + state.bank,
    worstLow: low(series(state, "worst")).amount,
    bufferTarget: profile.bufferMonths * profile.monthlyEssentials,
    ...(event ? { event } : {}),
  };
}
