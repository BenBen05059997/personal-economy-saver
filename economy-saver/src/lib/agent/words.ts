// The words a person reads while Ask works (27B): one fixed line per tool, words only, never an amount, an argument or a result.
// A test fails when a tool in the catalogue has no line here.
export const THINKING_WORDS = "Thinking about your question";
const WORKING_WORDS = "Working on it";

export const TOOL_WORDS: Record<string, string> = {
  where_am_i: "Looking at where you stand",
  whats_due: "Reading what's due",
  open_gaps: "Checking what's still unknown",
  can_i_spend: "Checking what you can spend",
  list_clients_and_cards: "Checking your clients and cards",
  timeline: "Lining up the dates",
  options_when_short: "Looking at your options",
  list_invoices: "Reading your invoices",
  household_snapshot: "Reading your household",
  goals: "Checking your goal progress",
  plan_for: "Working out the plan",
  who_owes_whom: "Checking who owes whom",
  month_by_category: "Adding up the month",
  own_categories: "Reading your own categories",
  search_spending: "Searching your spending",
  bills_for_month: "Finding the bills for that month",
  suggestions: "Checking what needs your attention",
  regular_costs: "Reading your regular costs",
  foreign_costs: "Checking what foreign money costs",
  draft_invoice: "Drafting the invoice",
  add_bill: "Adding the bill",
  add_bills: "Adding the bills",
  log_charge: "Logging the charge",
  log_charges: "Logging the charges",
  add_pot: "Setting up the pot",
  update_bank_balance: "Updating the bank balance",
  what_if: "Trying the what-if",
  make_canvas: "Drawing the canvas",
  clarify: "Working out what to ask you",
  out_of_scope: "Checking if I can help with that",
  remember: "Noting that down",
  forget: "Forgetting that",
  list_spaces: "Looking at your spaces",
  open_space: "Thinking about a new space",
  search_history: "Searching your Ask history",
  recall: "Looking at what I remember",
  update_brief: "Updating the space brief",
  offer_keep: "Thinking about what to keep",
  to_check: "Reading what needs checking",
  set_whose: "Marking whose it is",
};

/** The line for a tool name. A name outside the catalogue (the model made it up) gets the plain line. */
export function toolWords(name: string): string {
  return TOOL_WORDS[name] ?? WORKING_WORDS;
}
