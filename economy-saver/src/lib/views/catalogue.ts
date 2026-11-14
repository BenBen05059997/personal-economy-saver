// What each view is, for the shell and the tool: its form, question, hint, page and data needs. Resolvers are not here.
import type { ChartForm, ViewHome, ViewId, ViewNeed } from "./types";

export type ViewMeta = { form: ChartForm; question: string; hint: string; home: ViewHome; needs: ViewNeed[]; askOnly?: true };

export const VIEW_META: Record<ViewId, ViewMeta> = {
  forecast: { form: "step_line", question: "Am I fine for 30 days?", hint: "Your money day by day, if clients pay as usual and if clients pay late.", home: { path: "/", label: "Home" }, needs: [] },
  what_if: { form: "step_line", question: "What if I spend this, or a client pays later than usual?", hint: "The same days, with the change drawn beside what they are now.", home: null, needs: [] },
  position: { form: "waterfall", question: "What do I actually have?", hint: "Cash, minus what is set aside and what the cards will take, plus what is owed to you.", home: null, needs: [] },
  month_by_category: { form: "ranked_bars", question: "Where does the month go?", hint: "Each group of spending in a month, biggest first.", home: { path: "/spending", label: "Spending" }, needs: ["spending"] },
  month_trend: { form: "stacked_columns", question: "How has spending changed?", hint: "The months side by side, split into spent and still to come.", home: { path: "/spending/over-time", label: "Spending, Over time" }, needs: ["spending"] },
  month_pace: { form: "pace_lines", question: "Am I spending faster than last month?", hint: "This month's running total against last month's, by day.", home: { path: "/spending/over-time", label: "Spending, Over time" }, needs: ["spending"] },
  fixed_costs: { form: "stacked_columns", question: "Which costs could I cut?", hint: "The regular costs month by month.", home: { path: "/spending/over-time", label: "Spending, Over time" }, needs: ["spending"] },
  search_months: { form: "stacked_columns", question: "How much on this each month?", hint: "What a search matches, month by month.", home: { path: "/spending", label: "Spending" }, needs: ["spending"] },
  money_flow: { form: "sankey", question: "Where did each payment go?", hint: "Money in, what was set aside and what was spent.", home: { path: "/saving", label: "Saving" }, needs: ["spending", "income", "potFills"] },
  savings_rate: { form: "stacked_columns", question: "How much did I keep each month?", hint: "Money in each month, split into spent and kept.", home: { path: "/saving", label: "Saving" }, needs: ["spending", "income"] },
  buffer_months: { form: "runway_bar", question: "How many months could I last?", hint: "The cash you have against a month of spending.", home: { path: "/saving", label: "Saving" }, needs: ["spending"] },
  income_months: { form: "stacked_columns", question: "How much do I really earn a month?", hint: "Payments received, month by month.", home: { path: "/clients", label: "Clients" }, needs: ["income"] },
  client_pace: { form: "strip", question: "Which client pays slowest?", hint: "Days each client took to pay, invoice by invoice.", home: { path: "/clients", label: "Clients" }, needs: [] },
  fx_cost: { form: "stacked_columns", question: "What did foreign money cost me?", hint: "Fees and rate gaps on foreign payments and card charges, by month.", home: { path: "/clients", label: "Clients" }, needs: ["fx"], askOnly: true },
  goal_pace: { form: "goal_line", question: "Am I on track for this goal?", hint: "What is saved against where the goal expects you to be.", home: { path: "/saving", label: "Saving" }, needs: [] },
  bills_calendar: { form: "calendar", question: "What's due, and when?", hint: "Bills and money coming, day by day.", home: { path: "/bills", label: "Bills" }, needs: [] },
  card_cycle: { form: "tracks", question: "If I put it on this card, when do I pay, and from what?", hint: "The card's cycle, its due date and what covers it.", home: { path: "/cards", label: "Cards" }, needs: [] },
  who_owes_whom: { form: "ranked_bars", question: "Who owes whom?", hint: "Each person's share of what the household shared.", home: { path: "/household", label: "Household" }, needs: [] },
  what_changed: { form: "before_after", question: "What would confirming this change, or what did it change?", hint: "The picture without it and with it.", home: { path: "/to-check", label: "To check" }, needs: ["spending"] },
  tax_ahead: { form: "step_line", question: "Will I have the tax money?", hint: "What the pot gathers from payments coming, against the tax bills due.", home: { path: "/saving", label: "Saving" }, needs: [] },
};
