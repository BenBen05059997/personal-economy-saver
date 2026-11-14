// The list of money terms (D78): one meaning per word, kept here for every face to read. Pure: no I/O, no clock.
// A term has a stable `name` (what a fact carries), a `label` (the words a person reads), a `meaning` and the case it belongs to.
// Case: "late" and "as_usual" are fixed to that case, "named" carries whichever case it was tested on, "none" has no case.

export type TermCase = "late" | "as_usual" | "named" | "none";
export type TermUnit = "money" | "days" | "count" | "date" | "percent" | "text" | "flag" | "period";

export type Term = {
  name: string;
  label: string;
  meaning: string;
  case: TermCase;
  unit: TermUnit;
  /** Decimal places a value may carry; 0 when omitted. Only percent and buffer months carry one. */
  decimals?: 0 | 1;
};

/** The two cases a forecast is tested on, in D78's words. */
export const CASES = {
  as_usual: { label: "as usual", meaning: "Each client pays after their usual days (the middle of their paid history) and a bill counts at its estimate." },
  late: { label: "late", meaning: "Every client pays as slowly as they ever have, all at once, and a bill counts at the high end of its estimate. It means only this case." },
} as const;

function term(name: string, label: string, unit: TermUnit, caseRule: TermCase, meaning: string, decimals?: 0 | 1): Term {
  return { name, label, meaning, case: caseRule, unit, ...(decimals ? { decimals } : {}) };
}

export const TERMS = [
  term("overdue", "overdue", "flag", "none", "An invoice past the day the forecast expects it to be paid."),
  term("days_later_than_usual", "days later than usual", "days", "named", "A what-if that moves one client's payment N days past their usual day."),
  term("safe_to_spend", "safe to spend", "money", "late", "The lowest your balance gets in the next 30 days, after every bill and card statement, if clients pay late; never below 0."),
  term("short", "short", "money", "named", "How far below zero the balance goes on its lowest day. It always says which case it is tested on."),
  term("low_point", "low point", "money", "named", "The lowest end-of-day balance in the next 30 days, and the day it happens. It can be negative."),
  term("low_point_day", "low point day", "date", "named", "The day the lowest end-of-day balance in the next 30 days happens."),
  term("usual_days_to_pay", "usual days to pay", "days", "none", "The middle of how many days a client has taken from payment link to paid."),
  term("slowest_days_to_pay", "slowest days to pay", "days", "none", "The most days a client has ever taken from payment link to paid."),
  term("card_room", "card room", "money", "late", "How much more can go on a card with every bill still covered, before a purchase."),
  term("card_room_after", "card room after this purchase", "money", "late", "The card room that is left once the purchase being tested is on the card."),
  term("limit_left", "limit left", "money", "none", "The card's limit less what is on it, with no cash in it."),
  term("statement_closed", "closed statement", "money", "none", "A statement whose cycle has ended and that is waiting to be paid."),
  term("statement_open", "open statement", "money", "none", "The current cycle, still collecting charges."),
  term("due", "due", "date", "none", "The day a bill or card statement has to be paid."),
  term("paid_from", "paid from", "text", "none", "The account a card statement is taken from."),
  term("next_30_days", "next 30 days", "period", "none", "Today and the 29 days after it. The window every forecast figure covers."),
  term("cash", "cash", "money", "none", "The money in your bank and PayPal."),
  term("cash_to_spend", "cash to spend", "money", "none", "Cash less what is set aside in pots."),
  term("what_you_have", "what you have", "money", "none", "The total of the waterfall: cash to spend, less what cards owe, plus about what clients owe you."),
  term("card_owes", "what a card owes", "money", "none", "What is on a card now, closed statements and the open cycle together."),
  term("clients_owe", "clients owe you", "money", "none", "The total of your sent, unpaid invoices, counted as about."),
  term("who_owes_whom", "who owes whom", "money", "none", "Inside the household, what one person owes another so everyone has paid their fair share."),
  term("work_to_invoice", "work to invoice", "money", "none", "Finished work you have not billed yet."),
  term("card_charges_not_on_statement", "card charges not yet on a statement", "money", "none", "Card spending in the open cycle that no statement has picked up yet."),
  term("about_estimate", "about (estimate)", "flag", "none", "The figure is an estimate, not a bill amount."),
  term("about_todays_rate", "about (today's rate)", "flag", "none", "A foreign amount turned into yen at today's rate."),
  term("about_foreign_estimate", "about (estimated foreign cost)", "flag", "none", "A card purchase abroad whose fee or rate is estimated, not charged yet."),
  term("not_counted", "not counted", "flag", "none", "Something with no known amount or no rate to yen counts as nothing, and says so."),
  term("to_check", "To check", "count", "none", "Something read from a document, drafted by Ask or typed in that waits for your yes; it counts for nothing until you confirm it."),
  term("left_over_each_month", "left over each month", "money", "as_usual", "What the next 30 days leave over as usual."),
  term("average_monthly_spending", "average monthly spending", "money", "none", "What you spent in a month, averaged over up to your last 3 completed months."),
  term("change_from_last_month", "change from last month", "money", "none", "This month's amount less last month's, as money."),
  term("change_from_last_month_percent", "change from last month (percent)", "percent", "none", "This month's amount less last month's, as a percent of last month's.", 1),
  term("share_of_total", "share of the total", "percent", "none", "One part as a percent of the whole it belongs to, to one decimal.", 1),
  term("days_until_short", "days until short", "days", "named", "How many days from today until the balance first goes below zero, in the case named."),
  term("days_overdue", "days overdue", "days", "none", "Days from the day the forecast expected an invoice to be paid to today; never below 0."),
  term("safe_to_spend_for_period", "safe to spend for a period", "money", "late", "Safe to spend, tested over the number of days you ask about instead of 30."),
  term("safe_to_spend_as_usual", "safe to spend as usual", "money", "as_usual", "The lowest balance in the next 30 days if clients pay as usual, never below 0. It always carries its case; it is not \"safe to spend\"."),
  term("business_share", "business share", "money", "none", "The part of the month's spending marked as business."),
  term("business_share_percent", "business share (percent)", "percent", "none", "The part of the month's spending marked as business, as a percent.", 1),
  term("pot", "pot", "money", "none", "Money set aside for one purpose, taken out of cash to spend."),
  term("regular_costs", "regular costs", "money", "none", "Costs that come back month after month, with how each changed."),
  term("foreign_cost", "foreign cost", "money", "none", "What receiving payments and card purchases in another currency cost you in fees and rate."),
  term("tax_ahead", "tax ahead", "money", "none", "Whether the tax pot covers the tax bills coming, and the day it would fall short."),
  term("tax_short_on", "tax short on", "date", "none", "The day the tax pot would fall short of the tax bills coming."),
  term("goal_pace", "goal pace", "money", "none", "Whether a pot is on track for its date: the amount ahead or behind, and the date it reaches the target at this pace."),
  term("goal_reaches_on", "goal reaches target on", "date", "none", "The date a pot reaches its target at this pace."),
  term("income_a_month", "income a month", "money", "none", "The average of what came in per completed month, from the first payment."),
  term("kept", "kept", "money", "none", "Money in less money spent over the months shown; negative if you spent more than came in."),
  term("buffer_months", "buffer months", "count", "none", "How many months your cash to spend lasts at the average monthly spending, to one decimal.", 1),
] as const satisfies readonly Term[];

export type TermName = (typeof TERMS)[number]["name"];

const BY_NAME = new Map<string, Term>(TERMS.map(item => [item.name, item]));

/** The term for a name; stops with an error for a name that is not in the list. */
export function termOf(name: TermName): Term {
  const found = BY_NAME.get(name);
  if (!found) throw new Error(`Unknown money term: ${name}`);
  return found;
}
