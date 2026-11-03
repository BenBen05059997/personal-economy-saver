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
};
