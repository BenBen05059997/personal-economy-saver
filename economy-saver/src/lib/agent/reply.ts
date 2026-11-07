// The reply of one Ask, chosen by code after the model loop (D60): a clarifying question, a decline or an answer. The model never picks
// the kind; the tools it called do. The fixed sentences and the "Based on" sources live here, each in one place.
import { unconfirmedAmounts } from "@/lib/ai/number-check";
import type { Recipe } from "@/lib/canvas/schema";

export type ReplyKind = "answer" | "clarify" | "declined";
export type Source = { label: string; href: string };

export const FIXED = {
  off_topic: "I can help with your money: what you have, what's coming, what you spend and getting paid. Try “Am I OK until the end of the month?”, “What if a client pays two weeks late?” or “Where did last month go?”",
  not_offered: "I can't advise on investments, tax filing or legal questions; a licensed professional can. I can show your own numbers: try “How much is in my tax pot?” or “What did I spend on work this month?”",
  savedThenStopped: "I saved what you told me, but couldn't finish the answer. ",
  alreadySaved: "This question already saved what you told me. Open To check to see it.",
  wait: "That's several questions I can't help with. Ask me about your money again in an hour.",
} as const;

/** The line above the question box until the household has an answer. */
export const firstUse = (host: string) => `A model words the answers; every number is the app's own, from your records. This is not financial advice. Your questions go to ${host}.`;

/** Declined questions allowed an hour before the wait sentence (`out-of-scope` purpose). */
export const DECLINES_PER_HOUR = 5;

/** The page each tool's answer came from. `make_canvas`, `what_if` and `household_snapshot` add none. */
const TOOL_SOURCES: Record<string, Source> = {
  where_am_i: { label: "Your next 30 days", href: "/#next-30-days" },
  whats_due: { label: "Coming up", href: "/#coming-up" },
  timeline: { label: "Coming up", href: "/#coming-up" },
  can_i_spend: { label: "Safe to spend", href: "/" },
  options_when_short: { label: "Options", href: "/options" },
  list_invoices: { label: "Clients", href: "/clients" },
  foreign_costs: { label: "Clients", href: "/clients" },
  list_clients_and_cards: { label: "Clients", href: "/clients" },
  plan_for: { label: "Plan", href: "/plan" },
  month_by_category: { label: "Plan", href: "/plan" },
  search_spending: { label: "Plan", href: "/plan" },
  bills_for_month: { label: "Plan", href: "/plan" },
  regular_costs: { label: "Plan", href: "/plan" },
  who_owes_whom: { label: "Shared costs", href: "/#shared-costs" },
  open_gaps: { label: "To check", href: "/to-check" },
  to_check: { label: "To check", href: "/to-check" },
  remember: { label: "Memory", href: "/memory" },
  forget: { label: "Memory", href: "/memory" },
  recall: { label: "Memory", href: "/memory" },
};

/** The distinct sources of the tools an answer used, in the order first used. */
function sourcesFor(toolNames: readonly string[]): Source[] {
  const found: Source[] = [];
  for (const name of toolNames) {
    const source = Object.hasOwn(TOOL_SOURCES, name) ? TOOL_SOURCES[name] : undefined;
    if (source && !found.some(known => known.href === source.href && known.label === source.label)) found.push(source);
  }
  return found;
}

/** Every text the model wrote on a canvas and the person reads (title, labels, notes, letters, action labels): the amount check covers it too. */
export function canvasWords(recipe: Recipe | null): string[] {
  if (!recipe) return [];
  const words = [recipe.title];
  for (const block of recipe.blocks) {
    switch (block.type) {
      case "number": words.push(block.label); if (block.note) words.push(block.note); break;
      case "progress": case "action": words.push(block.label); break;
      case "table": if (block.title) words.push(block.title); break;
      case "note": case "letter": words.push(block.text); break;
      default: break;
    }
  }
  return words;
}

type Finished = {
  clarify: { question: string; choices: string[] } | null;
  outOfScope: "off_topic" | "not_offered" | null;
  text: string; // what the model ended with (empty when it ended on a terminal tool)
  tools: string[]; // the names of the tools this question ran successfully (the "Based on" sources)
  /** Whether the model called any catalogue tool, successful or not; a reply with none at all is declined. */
  called: boolean;
  recipe: Recipe | null;
  /** The question, this question's tool results and the memory block: never an earlier reply. */
  sources: string[];
};
type Chosen = { kind: ReplyKind; text: string; choices: string[] | null; recipe: Recipe | null; sources: Source[] };

/** `null` text means an answer whose amounts the app could not confirm: the caller keeps its fixed error. */
export function chooseReply(done: Finished): Chosen | null {
  if (done.clarify) {
    if (unconfirmedAmounts([done.clarify.question, ...done.clarify.choices].join("\n"), done.sources).length) return null;
    return { kind: "clarify", text: done.clarify.question, choices: done.clarify.choices, recipe: null, sources: [] };
  }
  if (done.outOfScope) return { kind: "declined", text: FIXED[done.outOfScope], choices: null, recipe: null, sources: [] };
  if (!done.called) return { kind: "declined", text: FIXED.off_topic, choices: null, recipe: null, sources: [] };
  if (unconfirmedAmounts([done.text, ...canvasWords(done.recipe)].join("\n"), done.sources).length) return null;
  return { kind: "answer", text: done.text, choices: null, recipe: done.recipe, sources: sourcesFor(done.tools) };
}
