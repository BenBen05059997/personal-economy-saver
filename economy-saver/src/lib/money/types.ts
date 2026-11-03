// The money picture the runway is drawn from.
//
// Every amount is in the home currency (`homeCurrency`) unless the field says USD. Clients pay in
// USD, so an invoice keeps its USD amount and is converted with `fxPerUsd` (home currency per
// 1 USD; exactly 1 when the home currency is USD) wherever it meets a balance or a bill.

import type { Currency } from "@/lib/catalogue/types";

export type Bill = {
  id: string;
  biller: string;
  amount: number;
  due: string; // YYYY-MM-DD
  category: string;
  status: "confirmed" | "pending"; // pending = read by AI, waiting for the user to confirm
  previousAmount?: number;
  repeatDay?: number; // monthly bill (D41): the day of the month it falls due; the engine sees one Bill per occurrence
  paidBy?: string; // shared bill (D45): the member who pays it; the engine ignores it
};

export type Client = {
  id: string;
  name: string;
  email: string;
  termsDays: number; // 0 = due on receipt
  daysToPay: number[]; // history: days from sending to paid, one per paid invoice
};

export type Invoice = {
  id: string;
  clientId: string;
  number?: string;
  item: string;
  amountUsd: number;
  status: "unbilled" | "draft" | "sent" | "paid" | "closed";
  paypalStatus?: string;
  sentOn?: string;
  dueOn?: string;
  note?: string;
};

// A credit card the user typed in at setup. No card login: spend arrives as card-use emails and receipts.
export type Card = {
  id: string;
  label: string; // "Card A"; fictional issuers only
  closingDay: number; // day of month the statement closes (31 = month end)
  dueDay: number; // day of the following month the statement is paid from the bank
  limit?: number;
  revolving: boolean; // true if リボ / revolving is switched on for this card
  ownerId?: string; // the member the card belongs to (D45); absent for a household card
};

// One purchase on a card, read from a card-use email or a receipt.
export type Charge = {
  id: string;
  cardId: string;
  merchant: string;
  amount: number; // home currency, as the issuer will bill it
  original?: { amount: number; currency: string }; // when paid in another currency
  date: string; // YYYY-MM-DD
  source: "card_email" | "receipt" | "voice" | "manual";
  status: "confirmed" | "pending"; // pending = read by AI, waiting for the user to confirm
  place?: string; // city, when travelling
  shared?: true; // D45: split between the members; the card's owner paid it. The engine ignores it
};

// A statement that has closed and waits to be paid. Open-cycle spend is computed from charges.
export type ClosedStatement = {
  cardId: string;
  amount: number;
  closedOn: string;
  dueOn: string;
};

// Money set aside with a reason (D43). `saved` is not spendable. `fillPct` is the share of each client payment added to it.
export type Pot = {
  id: string;
  name: string;
  saved: number; // home currency
  target?: number; // home currency
  targetDate?: string; // YYYY-MM-DD
  fillPct?: number; // 25 = a quarter of each client payment
};

// Who owes whom (D45). Pure input for lib/money/split.ts: whole minor units of the home currency (yen, or cents for USD),
// the rows as stored (a monthly shared bill is one row; split.ts counts its past occurrences). The engine ignores all of it.
export type SplitMember = { id: string; name: string; shareBp: number }; // the owner first; shares total 10,000
// createdAt is an ISO instant: an item dated on the settlement day counts again only when it was created after the settlement.
export type SplitBill = { id: string; biller: string; amountMinor: number; due: string; repeatDay: number | null; paidBy: string; createdAt: string };
export type SplitCharge = { id: string; merchant: string; amountMinor: number; date: string; paidBy: string; createdAt: string };
export type SplitState = {
  members: SplitMember[];
  since: string | null; // the day the household got its second member; null while it has one
  settledThrough: string | null; // the latest settlement's through date
  settledAt: string | null; // that settlement's instant (ISO); null exactly when settledThrough is
  bills: SplitBill[]; // confirmed shared bills that name who pays
  charges: SplitCharge[]; // confirmed shared charges from the first day that can count (the settlement day itself included); paidBy is the card's owner
};

export type MoneyState = {
  today: string;
  homeCurrency: Currency;
  fxPerUsd: number; // home currency per 1 USD; 1 when homeCurrency is "USD"
  paypal: number; // home currency; live from the sandbox in M2
  bank: number; // home currency; typed in by the user
  bills: Bill[]; // non-card bills (rent, utilities, phone, subscriptions)
  cards: Card[];
  charges: Charge[];
  statements: ClosedStatement[];
  clients: Client[];
  invoices: Invoice[];
  pots: Pot[]; // confirmed pots: their saved money is taken off the cash the runway starts from
  pendingPots: Pot[]; // pots waiting in To check; they count for nothing until confirmed
  balanceUpdates: { id: string; amount: number }[]; // new bank balances waiting in To check (D42), home currency
  split: SplitState; // D45: members, shares and the shared items since the last settlement
};
