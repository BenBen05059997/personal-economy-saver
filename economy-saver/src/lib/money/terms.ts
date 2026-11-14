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
  term("tax_ahead", "tax ahead", "money", "none", "How much the tax pot falls short of the tax bills coming; tax_short_on is the day."),
  term("tax_short_on", "tax short on", "date", "none", "The day the tax pot would fall short of the tax bills coming."),
  term("goal_pace", "goal pace", "money", "none", "The amount a pot is ahead of (positive) or behind (negative) where it should be today for its date."),
  term("goal_reaches_on", "goal reaches target on", "date", "none", "The date a pot reaches its target at this pace."),
  term("income_a_month", "income a month", "money", "none", "The average of what came in per completed month, from the first payment."),
  term("kept", "kept", "money", "none", "Money in less money spent over the months shown; negative if you spent more than came in."),
  term("buffer_months", "buffer months", "count", "none", "How many months your cash to spend lasts at the average monthly spending, to one decimal.", 1),
  // Words the pictures and read tools add (D79, D80).
  term("cost_before_low", "cost before the low point", "money", "named", "A bill or card statement paid on or before the low point day, one of the costs that make the low point what it is."),
  term("late_client", "client paying after the low point", "text", "late", "A client whose late payment lands after the low point day, so the low point is short until they pay. The value is their first name."),
  term("amount_tested", "amount tested", "money", "none", "The amount you asked about. It is yours, not a result, so it confirms nothing."),
  term("closes_on", "closes on", "date", "none", "The day a card's current cycle closes."),
  term("closed_statement_due", "closed statement due", "date", "none", "The day a closed card statement is taken from the account."),
  term("covering_payment", "payment that covers the statement", "money", "late", "A client payment, on the day they would pay if they pay late, that is needed to cover a card statement when cash alone does not."),
  term("goes_out", "goes out", "money", "as_usual", "Every bill and card statement that goes out during the days shown, as usual."),
  term("comes_in", "comes in", "money", "as_usual", "Client payments that come in during the days shown, as clients pay as usual."),
  term("heaviest_day_goes_out", "goes out on the heaviest day", "money", "as_usual", "The most that goes out on one day in the days shown."),
  term("heaviest_day", "heaviest day", "date", "as_usual", "The day the most goes out in the days shown."),
  term("first_short_day", "first short day", "date", "late", "The first day in the days shown when the balance is below zero if clients pay late."),
  term("last_short_day", "last short day", "date", "late", "The last day in the days shown when the balance is below zero if clients pay late."),
  term("short_days", "short days", "count", "late", "How many days in the days shown the balance is below zero if clients pay late."),
  term("days_shown", "days shown", "days", "none", "How many days from today the picture covers."),
  term("cards_owe", "what the cards owe", "money", "none", "What every card owes together, closed statements and the open cycle."),
  term("month_spent_so_far", "spent so far", "money", "none", "What a month's bills and card charges come to, up to today."),
  term("month_still_to_come", "still to come", "money", "none", "Bills already known that fall later in the month, not yet paid."),
  term("month_total", "month total", "money", "none", "What a month comes to: spent so far plus the bills still to come in it. Its period says which month."),
  term("highest_month", "highest month", "money", "none", "The total of the past month that cost the most of the months shown. Its period says which month."),
  term("biggest_one_off", "biggest one-off", "money", "none", "The largest bill or card charge in a month that does not repeat; about names it."),
  term("regular_share", "regular share", "percent", "none", "The part of a month's total that is regular costs, as a whole percent."),
  term("regular_cost_started", "regular cost started", "money", "none", "What a regular cost that began this month costs this month; about names it."),
  term("regular_cost_stopped", "regular cost stopped", "money", "none", "What a regular cost that stopped this month cost last month; about names it."),
  term("biggest_regular_cost", "biggest regular cost", "money", "none", "The regular cost that is the most in a month; about names it."),
  term("search_month_total", "search matches in a month", "money", "none", "What a search's matches come to in one month. Its period says which month."),
  term("search_total", "search total", "money", "none", "What every match of a search adds up to over the months searched."),
  term("paid_in", "paid in", "money", "none", "What clients paid in a period, in yen at the rate on each invoice; the current month counts what has come in so far."),
  term("lowest_paid_in", "lowest month paid in", "money", "none", "The completed month with the least paid in, over the months shown; its period is that month."),
  term("money_spent", "money spent", "money", "none", "What went out on bills and card charges in a period, with nothing set aside counted."),
  term("money_set_aside", "money set aside", "money", "none", "What went into pots out of the payments that came in, in a period."),
  term("left_over_in_month", "left over in the month", "money", "none", "A month's money in less what was spent and set aside, when something is left."),
  term("from_earlier_money", "from earlier money", "money", "none", "How much more went out in a month than came in, so that much came from money held before."),
  term("spent_and_set_aside", "spent and set aside", "money", "none", "A month's spending and what was put into pots, together."),
  term("days_open", "days open", "days", "none", "Days from the day an invoice's payment link was made to today, while it is still unpaid."),
  term("goal_expected_by_today", "expected by today", "money", "none", "What a pot should hold today for its target on its date, building evenly from the day it was created."),
  term("goal_target", "goal target", "money", "none", "The amount a pot is meant to reach."),
  term("goal_target_date", "goal target date", "date", "none", "The date a pot is meant to reach its target."),
  term("goal_monthly_needed", "needed a month", "money", "none", "What has to go into a pot each month from now to reach its target by its date."),
  term("goal_still_to_set_aside", "still to set aside", "money", "none", "The target less what the pot holds, never below 0."),
  term("tax_covered_through", "tax covered through", "date", "none", "The last tax bill day the tax pot covers, or the end of the window when no bill is due."),
  term("shared_paid", "paid of the shared costs", "money", "none", "What one person paid of the household's shared bills and charges since the last settlement."),
  term("fair_share", "fair share", "money", "none", "What one person's share of the shared bills and charges comes to since the last settlement."),
  term("foreign_cost_receiving", "foreign cost of receiving", "money", "none", "What receiving and converting payments in another currency cost in fees and rate, over the months shown."),
  term("foreign_cost_card", "foreign cost on cards", "money", "none", "What card purchases in another currency cost in fees and rate, over the months shown."),
  term("foreign_cost_highest_month", "foreign cost, highest month", "money", "none", "The foreign cost of the month that cost the most; its period is that month."),
  term("foreign_cost_unknown_count", "purchases with no cost yet", "count", "none", "Card purchases in another currency whose cost is not known yet; they count as nothing."),
  term("low_point_before_change", "low point before the change", "money", "named", "The lowest end-of-day balance in the next 30 days without the change being tested, in the case named."),
  term("low_point_day_before_change", "low point day before the change", "date", "named", "The day that low point happens."),
  term("low_point_after_change", "low point after the change", "money", "named", "The lowest end-of-day balance in the next 30 days with the change being tested, in the case named."),
  term("low_point_day_after_change", "low point day after the change", "date", "named", "The day that low point happens."),
  term("safe_to_spend_before_change", "safe to spend before the change", "money", "late", "Safe to spend without the change being tested."),
  term("safe_to_spend_after_change", "safe to spend after the change", "money", "late", "Safe to spend with the change being tested."),
  term("sentence_day", "the sentence's day", "date", "none", "The day your sentence names: the day of the lowest point it states."),
  term("bill_amount", "bill amount", "money", "none", "What a bill is for: its amount, or its estimate when it is marked about."),
  term("charge_amount", "charge amount", "money", "none", "What a card charge is for."),
  term("bill_counted", "bill counted", "money", "named", "What a bill counts for on its day in the case named: its estimate as usual, the high end of its estimate if late."),
  term("client_pays", "client pays", "money", "named", "What a client's invoice brings in on the day the case named expects it: after the client's usual days as usual, after their slowest days if late."),
  term("option_cost", "option cost", "money", "none", "What closing a shortfall one way costs you in fees or interest, before any repayment."),
  term("category_total", "category total", "money", "none", "One category's part of a month's spending."),
  term("bills_for_month_total", "bills for the month total", "money", "none", "The known amounts of the bills whose service period overlaps the month, in one currency."),
  term("owes_to", "owes to", "text", "none", "The person that the person in `about` pays so everyone has paid their fair share."),
  term("difference_between_months", "difference between the months", "money", "none", "The second month's total less the first's, for the two months compared."),
  term("cancel_by", "cancel by", "date", "none", "The last day to cancel a regular cost before it renews."),
  term("low_point_change", "change in the low point", "money", "named", "How much the change moves the low point: after less before."),
] as const satisfies readonly Term[];

export type TermName = (typeof TERMS)[number]["name"];

const BY_NAME = new Map<string, Term>(TERMS.map(item => [item.name, item]));

/** The term for a name; stops with an error for a name that is not in the list. */
export function termOf(name: TermName): Term {
  const found = BY_NAME.get(name);
  if (!found) throw new Error(`Unknown money term: ${name}`);
  return found;
}

/** A term's label with a capital first letter, for the start of a line. */
export function labelOf(name: TermName): string {
  const label = termOf(name).label;
  return label.charAt(0).toUpperCase() + label.slice(1);
}
