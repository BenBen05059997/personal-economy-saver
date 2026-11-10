import { expandBills } from "@/lib/money/repeat";
import { addDays, planWindow } from "@/lib/money/runway";
import type { Bill, Charge, MoneyState } from "@/lib/money/types";

// Sample persona for the demo. Fictional people and companies only.
// Numbers match the concept artifact (cards included: Card A's closed statement and Card B's open cycle
// stand where the two card bills used to): worst case ¥18,780 short on Nov 27 before the
// Hikari Denki bill, ¥30,000 short after it, covered once Beacon pays $400.
// Expected arrival = sentOn + median(daysToPay); worst = sentOn + max(daysToPay):
// Acme Nov 22 / Dec 3, Northwind Nov 25 / Nov 29, Beacon (once sent today) Nov 16 / Nov 17.

// The bills as they are stored (and seeded): Ben's subscription, phone and rent repeat every month (D41);
// the electricity bill is a one-off each month: September's and October's are paid history (D54: a regular cost that changes
// month to month), November's waits in To check. Each carries a category and a business share (D46):
// rent is 30% business (a home office), the phone 50%, the subscription and the hosting are all business, the electricity 30%.
// The repeating ones started in August, so a search over past months finds them (D53); the engine reads only the occurrences
// and bills from today on, so the past electricity bills move no current number.
export const benStoredBills: Bill[] = ([
  { id: "b-cloudbox", biller: "CloudBox Plus", amount: 1_980, due: "2026-08-18", category: "subscriptions", businessBp: 10_000, repeatUnit: "month", repeatDay: 18 },
  { id: "b-mobaile", biller: "Mobaile Tsushin", amount: 4_800, due: "2026-08-20", category: "phone_internet", businessBp: 5_000, repeatUnit: "month", repeatDay: 20 },
  { id: "b-rent", biller: "Rent", amount: 82_000, due: "2026-08-27", category: "housing", businessBp: 3_000, repeatUnit: "month", repeatDay: 27 },
  { id: "b-hikari-09", biller: "Hikari Denki", amount: 8_640, due: "2026-09-25", category: "utilities", businessBp: 3_000 },
  { id: "b-hikari-10", biller: "Hikari Denki", amount: 10_020, due: "2026-10-25", category: "utilities", businessBp: 3_000 },
  {
    id: "b-hikari",
    biller: "Hikari Denki",
    amount: 11_220,
    due: "2026-11-27",
    category: "utilities",
    businessBp: 3_000,
    status: "pending",
    previousAmount: 10_020,
  },
] as (Omit<Bill, "status"> & { status?: Bill["status"] })[]).map((b): Bill => ({ status: "confirmed", ...b }));

// D75: Ben's own categories (kind and name; the seed gives them real ids). Coffee is the Kissa Midori café charges, Gear the electronics and outdoor
// shop, Books & films the bookshop and the cinema. They move no money: November still shows the same totals.
export const benOwnCategories: { id: string; kind: Charge["category"]; name: string }[] = [
  { id: "oc-coffee", kind: "food", name: "Coffee" },
  { id: "oc-gear", kind: "other", name: "Gear" },
  { id: "oc-books", kind: "other", name: "Books & films" },
];
const OWN = { coffee: { id: "oc-coffee", name: "Coffee" }, gear: { id: "oc-gear", name: "Gear" }, books: { id: "oc-books", name: "Books & films" } };

const benToday = "2026-11-14";

export const benMoney: MoneyState = {
  today: benToday,
  homeCurrency: "JPY",
  fxPerUsd: 150,
  paypal: 61_000,
  bank: 67_000,
  storedBills: benStoredBills,
  bills: [], // set below: the stored bills expanded into their occurrences
  // Card A closes at month end and is paid on the 26th of the next month: the October statement is closed
  // (due Nov 26) and November's charges so far fall into the statement due Dec 26, past the 30-day window.
  // Card B closes on the 15th and is paid on the 10th of the next month: the cycle that closes Nov 15
  // holds ¥61,000 so far, due Dec 10. Neither card is on リボ.
  // The September and October charges on Card A are history only (D53): they are on or before the stored statement's
  // close (Oct 31), so the runway never counts them again; they give the month view and the search something to find.
  cards: [
    { id: "card-a", label: "Card A", closingDay: 31, dueDay: 26, limit: 500_000, revolving: false, ownerId: "m-ben", foreignFeeBp: 220 },
    { id: "card-b", label: "Card B", closingDay: 15, dueDay: 10, limit: 300_000, revolving: false, ownerId: "m-ben" },
  ],
  statements: [{ cardId: "card-a", amount: 58_000, closedOn: "2026-10-31", dueOn: "2026-11-26" }],
  charges: ([
    { id: "ch-h1", cardId: "card-a", merchant: "Kumokaze Air flight", amount: 18_400, date: "2026-09-21", category: "travel", businessBp: 0, source: "card_email" },
    { id: "ch-h2", cardId: "card-a", merchant: "Hotel Kazemachi Hakone", amount: 28_600, date: "2026-09-22", category: "travel", businessBp: 0, source: "card_email" },
    { id: "ch-h3", cardId: "card-a", merchant: "Minato Fresh Market", amount: 5_960, date: "2026-09-27", category: "food", businessBp: 0, source: "card_email" },
    { id: "ch-h4", cardId: "card-a", merchant: "Kaze Taxi", amount: 2_340, date: "2026-10-04", category: "transport", businessBp: 0, source: "receipt" },
    { id: "ch-h5", cardId: "card-a", merchant: "Kissa Midori café", amount: 1_320, date: "2026-10-10", category: "food", businessBp: 0, own: OWN.coffee, source: "receipt" },
    { id: "ch-h6", cardId: "card-a", merchant: "Hoshizora Cinema", amount: 3_600, date: "2026-10-18", category: "other", businessBp: 0, own: OWN.books, source: "card_email" },
    { id: "ch-a1", cardId: "card-a", merchant: "Sora Cloud Hosting", amount: 3_850, date: "2026-11-04", category: "business_tools", businessBp: 10_000, source: "card_email" },
    { id: "ch-a2", cardId: "card-a", merchant: "Tsuki Electronics", amount: 18_200, date: "2026-11-09", category: "other", businessBp: 0, own: OWN.gear, source: "card_email" },
    { id: "ch-a3", cardId: "card-a", merchant: "Yamabiko Outdoor", amount: 6_400, date: "2026-11-12", category: "other", businessBp: 0, own: OWN.gear, source: "receipt" },
    { id: "ch-b1", cardId: "card-b", merchant: "Minato Fresh Market", amount: 8_640, date: "2026-10-17", category: "food", businessBp: 0, source: "card_email" },
    { id: "ch-b2", cardId: "card-b", merchant: "Metro Line commuter pass", amount: 12_000, date: "2026-10-20", category: "transport", businessBp: 0, source: "card_email" },
    { id: "ch-b3", cardId: "card-b", merchant: "Kissa Midori café", amount: 1_480, date: "2026-10-25", category: "food", businessBp: 0, own: OWN.coffee, source: "receipt" },
    { id: "ch-b4", cardId: "card-b", merchant: "Page & Lantern Books", amount: 3_880, date: "2026-10-29", category: "other", businessBp: 0, own: OWN.books, source: "card_email" },
    { id: "ch-b5", cardId: "card-b", merchant: "Kumo Goods Online", amount: 24_300, date: "2026-11-02", category: "other", businessBp: 0, source: "card_email" },
    { id: "ch-b6", cardId: "card-b", merchant: "Minato Fresh Market", amount: 7_420, date: "2026-11-08", category: "food", businessBp: 0, source: "card_email" },
    { id: "ch-b7", cardId: "card-b", merchant: "Kissa Midori café", amount: 1_880, date: "2026-11-12", category: "food", businessBp: 0, own: OWN.coffee, source: "receipt" },
    { id: "ch-b8", cardId: "card-b", merchant: "Minato Fresh Market", amount: 1_400, date: "2026-11-13", category: "food", businessBp: 0, source: "card_email" },
  ] as Omit<Charge, "status">[]).map((c): Charge => ({ status: "confirmed", ...c })),
  clients: [
    { id: "c-beacon", name: "Beacon Studio", email: "ap@beacon.example", termsDays: 0, daysToPay: [1, 2, 3, 2, 2, 1] },
    { id: "c-northwind", name: "Northwind", email: "billing@northwind.example", termsDays: 7, daysToPay: [10, 13, 12, 11, 16] },
    { id: "c-acme", name: "Acme Corp", email: "ap@acme.example", termsDays: 10, daysToPay: [12, 14, 13, 25, 16] },
  ],
  pots: [], // D43: Ben has no pots, so every demo number stays as it is
  pendingPots: [],
  cancelNotices: [],
  split: { members: [{ id: "m-ben", name: "Ben", shareBp: 10_000 }], since: null, settledThrough: null, settledAt: null, bills: [], charges: [] },
  balanceUpdates: [],
  invoices: [
    { id: "i-1042", clientId: "c-acme", number: "1042", item: "Product illustrations, batch 3", amountUsd: 1_200, status: "sent", sentOn: "2026-11-08", dueOn: "2026-11-18" },
    { id: "i-1038", clientId: "c-northwind", number: "1038", item: "Landing page visuals", amountUsd: 800, status: "sent", sentOn: "2026-11-13", dueOn: "2026-11-20" },
    { id: "i-beacon-m2", clientId: "c-beacon", item: "Brand refresh, milestone 2", amountUsd: 400, status: "unbilled", note: "Thanks! Milestone 2 files are in the shared folder." },
  ],
};

// The engine reads occurrences up to the end of the plan window, which depends on cards and charges only.
benMoney.bills = expandBills(benStoredBills, benToday, addDays(benToday, planWindow(benMoney) - 1));
