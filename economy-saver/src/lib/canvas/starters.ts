// The starter recipes (D57): the app's own screens as canvases, written in code, each built from this household's own clients and months.
// They are ordinary recipes: the same schema, the same resolver. Nothing here holds an amount of its own.
import { monthName, monthsBack } from "@/lib/money/spending";
import { toCheck } from "@/lib/money/to-check";
import type { MoneyState } from "@/lib/money/types";
import { RECIPE_VERSION, type Block, type Recipe } from "./schema";

type Starter = { id: string; title: string; summary: string; recipe: Recipe };

export const STARTER_IDS = ["this-month", "what-if-late", "month-vs-last", "regular", "where-you-stand"] as const;
const SLIDER_DAYS = 30;

const first = (name: string) => name.split(" ")[0];

/** The one PayPal or review step to offer, where one exists: invoice finished work, send a late client the link again, or open To check. */
function nextAction(state: MoneyState, nudgeIds: readonly string[]): Block | null {
  const nudged = nudgeIds.map(id => state.invoices.find(i => i.id === id && i.status === "sent")).find(i => i !== undefined);
  const unbilled = state.invoices.find(i => i.status === "unbilled");
  for (const [invoice, verb] of [[nudged, "Send"], [unbilled, "Invoice"]] as const) {
    const client = invoice && state.clients.find(c => c.id === invoice.clientId);
    if (invoice && client) return { type: "action", label: (verb === "Send" ? `Send ${first(client.name)} the link again` : `${verb} ${first(client.name)}`).slice(0, 60), href: `/invoices/${invoice.id}` };
  }
  return toCheck(state).length > 0 ? { type: "action", label: "Open To check", href: "/to-check" } : null;
}

export function starterRecipes(state: MoneyState, nudgeIds: readonly string[] = []): Starter[] {
  const current = state.today.slice(0, 7);
  const last = monthsBack(current, 2);
  const action = nextAction(state, nudgeIds);
  const openClients = [...new Set(state.invoices.filter(i => i.status === "sent").map(i => i.clientId))].filter(id => state.clients.some(c => c.id === id)).slice(0, 4);

  const thisMonth: Recipe = {
    version: RECIPE_VERSION, title: "This month",
    blocks: [
      { type: "sentence", query: { q: "sentence" } },
      { type: "number", label: "Safe to spend", query: { q: "safe_to_spend" }, note: "The lowest your balance gets in the next 30 days, if clients pay late." },
      { type: "number", label: "Cash today", query: { q: "cash" }, note: "Bank and PayPal, less your pots." },
      { type: "number", label: "Lowest point", query: { q: "low_point" } },
      { type: "flow_chart", query: { q: "flow" } },
      { type: "timeline", query: { q: "events" } },
      ...(action ? [action] : []),
    ],
  };

  const whatIfLate: Recipe = {
    version: RECIPE_VERSION, title: "What if clients pay late",
    scenario: { case: "usual", changes: [] },
    blocks: [
      ...(openClients.length > 0 ? [{ type: "sliders" as const, controls: openClients.map(clientId => ({ clientId, maxDays: SLIDER_DAYS })) }] : []),
      { type: "sentence", query: { q: "sentence", scenario: "canvas" } },
      { type: "number", label: "Lowest point", query: { q: "low_point", scenario: "canvas" } },
      { type: "flow_chart", query: { q: "flow", scenario: "canvas" } },
    ],
  };

  const monthVsLast: Recipe = {
    version: RECIPE_VERSION, title: "This month against last month",
    blocks: [
      { type: "number", label: `${monthName(last)}`, query: { q: "month_total", month: last } },
      { type: "number", label: `${monthName(current)}`, query: { q: "month_total", month: current }, note: "Bills due this month and card charges so far." },
      { type: "compare", query: { q: "compare_months", a: last, b: current } },
      { type: "table", title: "Biggest changes", query: { q: "compare_months", a: last, b: current } },
    ],
  };

  const regular: Recipe = {
    version: RECIPE_VERSION, title: "Regular costs",
    blocks: [
      { type: "table", title: "What comes back every month", query: { q: "regular_costs" } },
      { type: "action", label: "Open Spending", href: "/spending" },
    ],
  };

  const whereYouStand: Recipe = { version: RECIPE_VERSION, title: "Where you stand", blocks: [{ type: "view", view: "position", args: {} }] };

  return [
    { id: "this-month", title: thisMonth.title, summary: "Your sentence, safe to spend, the 30 days and what is coming up.", recipe: thisMonth },
    { id: "what-if-late", title: whatIfLate.title, summary: openClients.length > 0 ? "Slide a client later and watch the 30 days move. Nothing is saved." : "No client has an open invoice, so there is nothing to slide.", recipe: whatIfLate },
    { id: "month-vs-last", title: monthVsLast.title, summary: `${monthName(last)} and ${monthName(current)}, category by category.`, recipe: monthVsLast },
    { id: "regular", title: regular.title, summary: "The bills and charges that come back, and what changed.", recipe: regular },
    { id: "where-you-stand", title: whereYouStand.title, summary: "What you hold, what the cards will take and what clients owe you.", recipe: whereYouStand },
  ];
}
