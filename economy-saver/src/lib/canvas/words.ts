// "Show the recipe": each block in plain words. Pure.
import { plural } from "@/lib/plural";
import { monthName, SEARCH_QUERY_MAX } from "@/lib/money/spending";
import type { Block, Query, ScenarioRef } from "./schema";

const monthWords = (month: string) => `${monthName(month)} ${month.slice(0, 4)}`;

function scenarioWords(ref: ScenarioRef): string {
  if (ref === undefined) return "";
  if (ref === "canvas") return ", on this canvas's what-if";
  const n = ref.changes.length;
  return `, ${ref.case === "usual" ? "clients paying as usual" : "clients paying late"}${n ? `, with ${n} what-if ${plural(n, "change")}` : ""}`;
}

/** What a query asks the engine, as a phrase. */
function queryWords(query: Query): string {
  const scenario = "scenario" in query ? scenarioWords(query.scenario) : "";
  switch (query.q) {
    case "sentence": return `the one sentence about your next 30 days${scenario}`;
    case "safe_to_spend": return `the lowest your balance gets in 30 days if clients pay late${scenario}`;
    case "cash": return "your bank and PayPal today, less your pots";
    case "low_point": return `the lowest point of your balance in the next 30 days${scenario}`;
    case "flow": return `your balance day by day for ${query.days ?? 30} days${scenario}`;
    case "events": return `what is due and who pays, in date order, for ${query.days ?? 30} days${scenario}`;
    case "month_total": return `everything spent in ${monthWords(query.month)}`;
    case "month_by_category": return `${monthWords(query.month)} by category`;
    case "month_by_person": return `${monthWords(query.month)} by category, split into shared and each person, and who owes whom`;
    case "compare_months": return `${monthWords(query.a)} against ${monthWords(query.b)}`;
    case "spending_search": return `spending that matches "${query.text.slice(0, SEARCH_QUERY_MAX)}" over the last ${query.months} months`;
    case "regular_costs": return `the bills and charges that come back every month, and what changed`;
    case "bills_for_month": return `the bills for ${monthWords(query.month)}${query.text?.trim() ? ` that match "${query.text.trim().slice(0, SEARCH_QUERY_MAX)}"` : ""}, by the month each is for`;
    case "goals": return "how much you have saved towards each dated goal and how it is going";
    case "foreign_costs": return "what foreign money cost you in the last 12 months: PayPal payouts per client and card purchases in another currency";
  }
}

/** One line for a block: its kind, then what it shows or says. */
export function blockWords(block: Block): string {
  switch (block.type) {
    case "sentence": return `Sentence: ${queryWords(block.query)}`;
    case "number": return `Number "${block.label}": ${queryWords(block.query)}`;
    case "flow_chart": return `Chart: ${queryWords(block.query)}${block.mark ? ", one bill marked" : ""}`;
    case "timeline": return `Timeline: ${queryWords(block.query)}${block.mark ? ", one bill marked" : ""}`;
    case "table": return `Table${block.title ? ` "${block.title}"` : ""}: ${queryWords(block.query)}`;
    case "compare": return `Comparison: ${queryWords(block.query)}`;
    case "by_person": return `By person: ${queryWords(block.query)}`;
    case "progress": return "label" in block
      ? `Progress "${block.label}": ${queryWords(block.query)}, against the target you set`
      : `Goals: ${queryWords(block.query)}`;
    case "note": return `Note (${block.by === "you" ? "yours" : "written by the assistant"})`;
    case "letter": return "Letter written by the assistant";
    case "sliders": return `Sliders: ${block.controls.length} ${plural(block.controls.length, "client")} that can pay late`;
    case "action": return `Link: "${block.label}", to a page in the app`;
  }
}

/** The short kind name drawn over an outlined block. */
export const KIND_WORDS: Record<Block["type"], string> = {
  sentence: "Sentence", number: "Number", flow_chart: "Chart", timeline: "Timeline", table: "Table", compare: "Comparison", by_person: "By person",
  progress: "Progress", note: "Note", letter: "Letter", sliders: "Sliders", action: "Link",
};
