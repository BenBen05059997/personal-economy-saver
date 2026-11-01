import { z } from "zod";

// Shared contract for the wealth-moves catalogue. The JSON files in src/data/catalogue/
// hold the words and sources; src/lib/catalogue/formulas/<region>.ts holds the maths,
// keyed by the same move id.

export const Region = z.enum(["JP", "US"]);
export type Region = z.infer<typeof Region>;

export const Currency = z.enum(["JPY", "USD"]);
export type Currency = z.infer<typeof Currency>;

// The moment that makes a move worth saying now.
export const Moment = z.enum([
  "bill_arrived", // a bill was confirmed
  "charge_arrived", // a card charge arrived (card-use email or receipt), at home or travelling
  "statement_arrived", // a card statement arrived
  "client_paid", // a client payment landed in PayPal
  "deadline_near", // a move's deadline is inside its reminder window
  "surplus_month", // worst case stays above the buffer with room to spare
  "life_event", // job change, quitting to freelance, moving, marriage, baby
  "windfall", // an unusually large payment
  "setup", // baseline checklist, shown once during setup
]);
export type Moment = z.infer<typeof Moment>;

export const Group = z.enum([
  "quick_money",
  "tax",
  "invest_cash",
  "insurance_benefits",
  "get_paid_better",
  "stop_the_leak",
  "unclaimed_money",
]);
export type Group = z.infer<typeof Group>;

// baseline: a sensible 30-year-old with a normal job already knows it.
// insider: it lives in some other world (tax accountants, affiliate marketers, point hunters...).
export const Tier = z.enum(["baseline", "insider"]);
export type Tier = z.infer<typeof Tier>;

export const Risk = z.enum(["none", "low", "market", "behavioural"]);
export const Effort = z.enum(["minutes", "evening", "weekend", "ongoing"]);
export type Effort = z.infer<typeof Effort>;
export const Confidence = z.enum(["verified_primary", "secondary", "anecdotal"]);

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");

export const Source = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  asOf: IsoDate,
});

export const Deadline = z
  .object({
    label: z.string().min(1), // e.g. "Election form due"
    date: IsoDate.optional(), // a one-off date
    monthDay: z.string().regex(/^\d{2}-\d{2}$/).optional(), // a yearly date, "12-31"
    remindDaysBefore: z.number().int().positive(),
  })
  .refine((d) => Boolean(d.date) !== Boolean(d.monthDay), "set exactly one of date or monthDay");
export type Deadline = z.infer<typeof Deadline>;

export const Move = z.object({
  id: z.string().regex(/^(jp|us)-[a-z0-9-]+$/, "prefix with jp- or us-, then kebab-case"),
  region: Region,
  title: z.string().min(1).max(60), // "Get the 10% back on your expenses"
  localName: z.string().optional(), // "消費税課税事業者選択届出書"
  group: Group,
  tier: Tier,
  knownBy: z.string().min(1), // "tax accountants"
  moments: z.array(Moment).min(1),
  question: z.string().min(1), // the user's question, in their words
  fact: z.string().min(1), // the one thing they didn't know to ask
  valueText: z.string().min(1), // the value formula in words, shown under "Why"
  timeToMoney: z.string().min(1),
  risk: Risk,
  effort: Effort,
  deadline: Deadline.optional(),
  minFreeCash: z.number().nonnegative(), // free cash above the worst case needed first, in region currency
  freezeWhenLoanPending: z.boolean(), // true for anything touching credit files
  steps: z.array(z.string().min(1)).min(1).max(6),
  traps: z.array(z.string().min(1)),
  exitNote: z.string().optional(), // insider moves: cancel-by, hold-until, what to watch
  taxNote: z.string().optional(),
  maySay: z.string().min(1),
  mustNotSay: z.string().min(1),
  sources: z.array(Source).min(1),
  confidence: Confidence,
  illustrative: z.boolean(), // true when the value uses example figures rather than verified ones
  // gain: new money. timing: cash kept now, owed later. protected: money already yours that this stops
  // you losing. Only gains count toward the "found for you" total.
  valueKind: z.enum(["gain", "timing", "protected"]).default("gain"),
  // Shown first at these moments whatever its score (e.g. the tax pot when a client pays).
  pinAt: z.array(Moment).default([]),
});
export type Move = z.infer<typeof Move>;

export const Catalogue = z.array(Move);

// Who the user is. Setup answers plus what PayPal tells us. Amounts in the region's currency.
export type Profile = {
  region: Region;
  currency: Currency; // home currency
  name: string;
  age: number;
  city: string;
  work: "freelancer" | "employee" | "both";
  incomeCurrency: Currency; // what clients pay in
  annualRevenue: number;
  annualExpenses: number; // business expenses
  monthlyEssentials: number;
  bufferMonths: number;
  yearsFreelancing: number;
  // setup answers
  filing: "jp_blue_65" | "jp_blue_10" | "jp_white" | "us_schedule_c" | "none";
  retirementAccount: boolean; // iDeCo / Solo 401(k) or SEP
  retirementMonthly: number;
  taxFreeInvesting: boolean; // NISA / Roth IRA
  healthInsurance: "jp_kokuho" | "jp_union" | "jp_employer" | "us_marketplace" | "us_employer" | "none";
  revolvingBalance: number;
  doneSignupBonuses: boolean; // self-back in Japan, bank/card bonuses in the US
  loanPending: boolean;
  consumptionTaxElected?: boolean; // JP only
};

// What is happening right now.
export type Context = {
  today: string; // YYYY-MM-DD
  moment: Moment;
  cashToday: number;
  worstLow: number; // lowest worst-case balance in the runway window
  bufferTarget: number; // bufferMonths × monthlyEssentials
  event?: { kind: string; label: string; amount?: number; currency?: Currency };
};

export type Valued = {
  amount: number;
  currency: Currency;
  per: "once" | "month" | "year";
  basis: string; // one line: how this number came from the user's numbers
};

export type Formula = {
  // true, or a short reason the move does not apply to this user
  eligible: (p: Profile, c: Context) => true | string;
  value: (p: Profile, c: Context) => Valued;
};

export type Suggestion = {
  move: Move;
  value: Valued;
  score: number;
  dueInDays?: number;
};
