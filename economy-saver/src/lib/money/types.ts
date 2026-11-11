// The money picture the runway is drawn from.
//
// Every amount is in the home currency (`homeCurrency`) unless the field says USD. Clients pay in
// USD, so an invoice keeps its USD amount and is converted with `fxPerUsd` (home currency per
// 1 USD; exactly 1 when the home currency is USD) wherever it meets a balance or a bill.

import type { Currency } from "@/lib/catalogue/types";
import type { CategoryKey } from "./categories";

export type RepeatUnit = "month" | "year";

/** D50: set only when the row was not made by a form; To check shows "Drafted by Ask" / "Drafted through MCP" from it. */
export type MadeBy = "form" | "ask" | "mcp" | "reader" | "cron" | "paypal" | "import";

export type Bill = {
  id: string;
  biller: string;
  amount: number;
  due: string; // YYYY-MM-DD
  category: CategoryKey; // D46: moves no money; only the month view reads it
  businessBp: number; // D46: business share in basis points (0 personal, 10000 business)
  own?: { id: string; name: string }; // D75: the person's own category under `category`; absent = none. Moves no money
  status: "confirmed" | "pending"; // pending = read by AI, waiting for the user to confirm
  previousAmount?: number;
  repeatUnit?: RepeatUnit; // D48: absent = one-off; the engine sees one Bill per occurrence
  repeatDay?: number; // monthly bill (D41): the day of the month it falls due; only with repeatUnit "month"
  repeatUntil?: string; // D41: the last day an occurrence may fall on; only with repeatUnit
  nextAmount?: number; // D48: the amount an occurrence on or after nextAmountFrom has; absent together with nextAmountFrom
  nextAmountFrom?: string; // YYYY-MM-DD
  cancelBy?: string; // D48: information only: the date to act by before the renewal; the app never cancels anything
  amountVaries?: true; // D54: a monthly bill forecast from its own past (never with nextAmount); its real bills carry seriesBillId
  periodStart?: string; // 27F: the first and last day a one-off bill covers ("11月分"); information only, the money counts by `due`; both or neither
  periodEnd?: string;
  seriesBillId?: string; // D54: on a confirmed one-off real bill: the amount-varies series it belongs to; it replaces that series' occurrence in its due month
  estimated?: true; // D54: set by expandBills on an amount-varies occurrence: `amount` is the estimate, not a real bill ("about ¥9,330")
  startsOn?: string; // set on each occurrence of a repeating bill: the stored due date, where the series starts (the month view needs the occurrences before today)
  startAmount?: number; // set with startsOn: the stored amount, before any change (an occurrence's own `amount` may already be the new one)
  ownerId?: string; // D52: the member whose bill it is; absent = shared. Only the month view reads it
  paidBy?: string; // shared bill (D45): the member who pays it; the engine ignores it
  madeBy?: MadeBy;
  // D55: set by expandBills where the stored amount or date is not known yet.
  amountUnknown?: true; // the stored amount is not known: `amount` is the estimate (with `estimated`, `amountHigh`, `basis`) or 0 with `uncounted`
  amountHigh?: number; // the highest of the amounts the estimate averaged: what the late case counts
  basis?: GapBasis; // what the estimate was made from
  uncounted?: true; // amount not known and no history to estimate from: it counts for nothing and every face says "amount not known", never ¥0
  dueUnknown?: true; // the stored date is not known: `due` is the state's today
};

/** D55: the real bills an estimate averaged, in the same units as `Bill.amount`; `from` says whether they are the bill's series or bills with its name. */
export type GapBasis = { count: number; low: number; high: number; from: "bills" | "series" };

/** A bill as stored: the amount or the date may be not known yet (D55). `expandBills` turns it into the `Bill` the engine reads. */
export type StoredBill = Omit<Bill, "amount" | "due"> & { amount: number | null; due: string | null };

export type Client = {
  id: string;
  name: string;
  email: string;
  termsDays: number; // 0 = due on receipt
  daysToPay: number[]; // history: days from sending to paid, one per paid invoice
  lateDays?: number; // D57: set only by a what-if (whatif.ts): this many days are added to when every invoice of this client lands; absent everywhere else
};

export type Invoice = {
  id: string;
  clientId: string;
  number?: string;
  item: string;
  amountUsd: number;
  status: "unbilled" | "draft" | "sent" | "paid" | "closed";
  hasLink: boolean; // the invoice has its permanent payment link (never the token)
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
  foreignFeeBp?: number | null; // D62: the issuer's foreign transaction fee in basis points (220 = 2.2%); absent = not entered
};

// One purchase on a card, read from a card-use email or a receipt.
export type Charge = {
  id: string;
  cardId: string;
  merchant: string;
  amount: number; // home currency, as the issuer will bill it
  original?: { amount: number; currency: string }; // when paid in another currency
  date: string; // YYYY-MM-DD
  category: CategoryKey; // D46
  businessBp: number; // D46
  own?: { id: string; name: string }; // D75: the person's own category under `category`; absent = none. Moves no money
  source: "card_email" | "receipt" | "voice" | "manual";
  status: "confirmed" | "pending"; // pending = read by AI, waiting for the user to confirm
  place?: string; // city, when travelling
  shared?: true; // D45: split between the members; the card's owner paid it. The engine ignores it
  madeBy?: MadeBy;
};

// A statement that has closed and waits to be paid. Open-cycle spend is computed from charges.
export type ClosedStatement = {
  cardId: string;
  amount: number;
  closedOn: string;
  dueOn: string;
  paid?: true; // already paid: it is not an out-flow, but its cycle's charges are still inside it and are not counted again
};

// Money set aside with a reason (D43). `saved` is not spendable. `fillPct` is the share of each client payment added to it.
export type Pot = {
  id: string;
  name: string;
  saved: number; // home currency
  target?: number; // home currency
  targetDate?: string; // YYYY-MM-DD
  startedOn?: string; // D66: the calendar day the dated goal pot was created
  fillPct?: number; // 25 = a quarter of each client payment
  madeBy?: MadeBy;
};

// Who owes whom (D45). Pure input for lib/money/split.ts: whole minor units of the home currency (yen, or cents for USD),
// the rows as stored (a monthly shared bill is one row; split.ts counts its past occurrences). The engine ignores all of it.
export type SplitMember = { id: string; name: string; shareBp: number }; // the owner first; shares total 10,000
// createdAt is an ISO instant: an item dated on the settlement day counts again only when it was created after the settlement.
type SplitBill = {
  id: string; biller: string; amountMinor: number | null; due: string; paidBy: string; createdAt: string; // amountMinor null: not known yet (D55): no debt until it is known; a date not known is today
  repeatUnit: RepeatUnit | null; repeatDay: number | null; // D48: repeatDay for monthly only
  repeatUntil: string | null; // D41: no occurrence after this day
  nextAmountMinor: number | null; nextAmountFrom: string | null; // an occurrence on or after nextAmountFrom splits nextAmountMinor
  variesUnpriced?: string[]; // D55: with varies: the due dates of its confirmed linked bills whose amount is not known: they take their month but split nothing
  varies?: RealBill[]; // D54: present exactly on an amount-varies monthly bill: its confirmed linked real bills (any whose), home minor units
};
/** D54: one confirmed real bill linked to an amount-varies series: its due date and amount in whole minor units. */
export type RealBill = { due: string; amountMinor: number };
type SplitCharge = { id: string; merchant: string; amountMinor: number; date: string; paidBy: string; createdAt: string };
export type SplitState = {
  members: SplitMember[];
  since: string | null; // the day the household got its second member; null while it has one
  settledThrough: string | null; // the latest settlement's through date
  settledAt: string | null; // that settlement's instant (ISO); null exactly when settledThrough is
  bills: SplitBill[]; // confirmed shared bills that name who pays
  charges: SplitCharge[]; // confirmed shared charges from the first day that can count (the settlement day itself included); paidBy is the card's owner
};

// A cancel-by date on a confirmed bill (D48): cancel by `cancelBy` or the bill is charged `amount` on `renewsOn`.
export type CancelNotice = { billId: string; biller: string; category: CategoryKey; cancelBy: string; renewsOn: string; amount: number | null; repeats: boolean }; // amount null: not known and nothing to estimate it from (D55)

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
  cancelNotices: CancelNotice[]; // D48: dated "cancel by" rows for Coming up; information only
  balanceUpdates: { id: string; amount: number; madeBy?: MadeBy }[]; // new bank balances waiting in To check (D42), home currency
  storedBills: StoredBill[]; // the bills as stored (a repeating bill once): lets the checks see a series whose next date is past the plan window, and `stateThrough` expand a later day. Set by loadMoneyState
  split: SplitState; // D45: members, shares and the shared items since the last settlement
};
