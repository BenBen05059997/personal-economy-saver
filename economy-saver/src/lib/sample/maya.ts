import type { Context, Moment, Profile } from "@/lib/catalogue/types";
import type { Charge, MoneyState } from "@/lib/money/types";

// Sample US persona for the demo. Fictional people and companies only.
// Maya is a freelance illustrator in Austin, paid by clients through PayPal.
// $70,000 revenue less $10,000 expenses = $60,000 net profit, the case the US research
// works through (research/wealth-moves/united-states.md): about $8,480 of self-employment
// tax, AGI about $55,760, the 12% bracket, roughly $12,000 of federal tax.

export const mayaProfile: Profile = {
  region: "US",
  currency: "USD",
  name: "Maya",
  age: 31,
  city: "Austin, Texas",
  work: "freelancer",
  incomeCurrency: "USD",
  annualRevenue: 70_000,
  annualExpenses: 10_000,
  monthlyEssentials: 3_000,
  bufferMonths: 9,
  yearsFreelancing: 3,
  filing: "us_schedule_c",
  retirementAccount: false, // no Solo 401(k) or SEP yet
  retirementMonthly: 0,
  taxFreeInvesting: false, // no Roth IRA yet
  healthInsurance: "us_marketplace",
  revolvingBalance: 0,
  doneSignupBonuses: false,
  loanPending: false,
};

const TODAY = "2026-11-14";
const BUFFER_TARGET = mayaProfile.bufferMonths * mayaProfile.monthlyEssentials; // 27,000

// A sensible Context for each moment. The runway numbers are the demo's, not live data:
// a normal month sits a little under the 9-month buffer; a surplus month is above it.
export function mayaContext(moment: Moment): Context {
  const base = { today: TODAY, moment, bufferTarget: BUFFER_TARGET };
  switch (moment) {
    case "client_paid":
      return {
        ...base,
        cashToday: 30_600,
        worstLow: 24_000,
        event: { kind: "payout", label: "Harbor & Co", amount: 1_800, currency: "USD" },
      };
    case "bill_arrived":
      return {
        ...base,
        cashToday: 29_000,
        worstLow: 22_000,
        event: { kind: "bill", label: "Zilker Valley Power bill $142", amount: 142, currency: "USD" },
      };
    case "statement_arrived":
      return {
        ...base,
        cashToday: 30_000,
        worstLow: 24_000,
        event: { kind: "statement", label: "Card statement paid in full, $1,240", amount: 1_240, currency: "USD" },
      };
    case "charge_arrived":
      return {
        ...base,
        cashToday: 30_000,
        worstLow: 24_000,
        event: { kind: "charge", label: "Card B $186 at Gulf Coast Air", amount: 186, currency: "USD" },
      };
    case "surplus_month":
      return { ...base, cashToday: 36_000, worstLow: 31_500 };
    case "windfall":
      return {
        ...base,
        cashToday: 34_800,
        worstLow: 28_000,
        event: { kind: "windfall", label: "Brightline Books paid a $5,200 licensing fee", amount: 5_200, currency: "USD" },
      };
    case "life_event":
      return {
        ...base,
        cashToday: 30_000,
        worstLow: 24_000,
        event: { kind: "life_event", label: "Year-end planning: open enrolment is on" },
      };
    case "deadline_near":
    case "setup":
      return { ...base, cashToday: 30_000, worstLow: 24_000 };
  }
}

// Maya's money for the runway demo. Fictional clients and bills only; every amount is in dollars
// and fxPerUsd is 1, so invoices land at face value.
//
// The story mirrors Ben's. Rent clears on Dec 1 and the Zilker Valley Power bill (fictional) on
// Dec 3, before the slowest client pays: -$320 short on Dec 1 without the power bill, -$462 short
// on Dec 3 with it. Invoicing the unbilled Copperline Games milestone ($900, a client that pays
// through PayPal in 1 to 3 days) closes it.
// Expected arrival = sentOn + median(daysToPay); worst = sentOn + max(daysToPay):
//   Harbor & Co Nov 23 / Dec 5, Brightline Books Nov 24 / Nov 27, Copperline (once sent today) Nov 16 / Nov 17.

export const mayaMoney: MoneyState = {
  today: TODAY,
  homeCurrency: "USD",
  fxPerUsd: 1,
  paypal: 610,
  bank: 1_390,
  bills: [
    { id: "b-sketchpad", biller: "Sketchpad Cloud", amount: 55, due: "2026-11-17", category: "Subscriptions" },
    { id: "b-lonestar", biller: "Lone Star Mobile", amount: 65, due: "2026-11-19", category: "Phone" },
    { id: "b-health", biller: "Bluebonnet Health", amount: 410, due: "2026-11-28", category: "Health premium" },
    { id: "b-rent", biller: "Rent", amount: 1_650, due: "2026-12-01", category: "Housing" },
    {
      id: "b-power",
      biller: "Zilker Valley Power",
      amount: 142,
      due: "2026-12-03",
      category: "Utilities · Electricity",
      status: "pending" as const,
      previousAmount: 131.4,
    },
  ].map((b) => ({ status: "confirmed" as const, ...b })),
  // Card A closes at month end and is paid on the 25th of the next month: the October statement ($1,240)
  // is closed and due Nov 25; November's charges so far are due Dec 25, past the 30-day window.
  // Card B closes on the 20th and is paid on the 10th of the next month: the cycle that closes Nov 20
  // holds $380 so far, due Dec 10 (after every low point below, so those numbers do not move).
  cards: [
    { id: "card-a", label: "Card A", closingDay: 31, dueDay: 25, limit: 6_000, revolving: false },
    { id: "card-b", label: "Card B", closingDay: 20, dueDay: 10, limit: 3_000, revolving: false },
  ],
  statements: [{ cardId: "card-a", amount: 1_240, closedOn: "2026-10-31", dueOn: "2026-11-25" }],
  charges: ([
    { id: "ch-a1", cardId: "card-a", merchant: "Inkwell Art Supply", amount: 143, date: "2026-11-03", source: "card_email" },
    { id: "ch-a2", cardId: "card-a", merchant: "Barton Springs Grocer", amount: 96, date: "2026-11-10", source: "card_email" },
    { id: "ch-b1", cardId: "card-b", merchant: "Barton Springs Grocer", amount: 112, date: "2026-10-24", source: "card_email" },
    { id: "ch-b2", cardId: "card-b", merchant: "Pecan Street Coffee", amount: 16, date: "2026-10-28", source: "receipt" },
    { id: "ch-b3", cardId: "card-b", merchant: "Riverside Art Supply", amount: 168, date: "2026-11-02", source: "card_email" },
    { id: "ch-b4", cardId: "card-b", merchant: "Lamar Street Books", amount: 38, date: "2026-11-07", source: "receipt" },
    { id: "ch-b5", cardId: "card-b", merchant: "Capital Metro pass", amount: 46, date: "2026-11-11", source: "card_email" },
  ] as Omit<Charge, "status">[]).map((c): Charge => ({ status: "confirmed", ...c })),
  clients: [
    { id: "c-copperline", name: "Copperline Games", email: "ap@copperline.example", termsDays: 0, daysToPay: [1, 2, 3, 2, 2, 1] },
    { id: "c-brightline", name: "Brightline Books", email: "billing@brightline.example", termsDays: 10, daysToPay: [9, 12, 11, 13, 15] },
    { id: "c-harbor", name: "Harbor & Co", email: "ap@harborco.example", termsDays: 15, daysToPay: [14, 16, 18, 15, 28] },
  ],
  invoices: [
    { id: "i-2208", clientId: "c-harbor", number: "2208", item: "Packaging illustrations, set 3", amountUsd: 1_800, status: "sent", sentOn: "2026-11-07", dueOn: "2026-11-22" },
    { id: "i-2211", clientId: "c-brightline", number: "2211", item: "Picture-book spreads 5 to 8", amountUsd: 1_100, status: "sent", sentOn: "2026-11-12", dueOn: "2026-11-22" },
    { id: "i-copperline-m2", clientId: "c-copperline", item: "Character sheets, milestone 2", amountUsd: 900, status: "unbilled", note: "Thanks! Milestone 2 files are in the shared folder." },
  ],
};
