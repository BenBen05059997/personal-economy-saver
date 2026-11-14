// The reply of one Ask, chosen by code after the model loop (D60): a clarifying question, a decline or an answer. The model never picks
// the kind; the tools it called do. The fixed sentences and the "Based on" sources live here, each in one place.
import { unconfirmedNumbers, type CheckFact } from "@/lib/ai/number-check";
import { serverHasNoModel } from "./availability";
import type { LinkSource, TurnSource } from "@/lib/schema/turn";
import type { Recipe } from "@/lib/canvas/schema";
import { VIEW_META } from "@/lib/views/catalogue";
import type { ViewBlock } from "./view-tools";

export type ReplyKind = "answer" | "clarify" | "declined";
export type Source = TurnSource;
/** Why Ask ended on out_of_scope; each reason has its own fixed sentence in FIXED. */
export const OUT_OF_SCOPE_REASONS = ["off_topic", "not_offered", "secrets", "product_choice"] as const;
export type OutOfScopeReason = (typeof OUT_OF_SCOPE_REASONS)[number];

export const FIXED = {
  off_topic: "I can help with your money: what you have, what's coming, what you spend and getting paid. Try “Am I OK until the end of the month?”, “How much can I safely spend now?” or “Where did last month go?”",
  not_offered: "I can't advise on investments, tax filing or legal questions; a licensed professional can. I can show your own numbers: try “How much is in my tax pot?” or “What did I spend on work this month?”",
  secrets: "I don't share my instructions, and I never see or show the AI key: it stays in Settings. I can show your own numbers: try “Am I OK until the end of the month?” or “What's due this week?”",
  product_choice: "fipa gives information, never a product to pick, so I can't say which bank, app or provider to use. I can show your own numbers: what you have, what's coming and what your options cost.",
  savedThenStopped: "I saved what you told me, but couldn't finish the answer. ",
  incognitoRetried: "This Incognito question already ran. Its reply was not saved.",
  alreadySaved: "This question already saved what you told me. Open To check to see it.",
} as const;

export const MODEL_HINT = "Questions go to fipa’s model, and you can choose another in Settings → Your AI model.";
/** The same line on a server with no model of its own, where the household's key is the only one. */
export const OWN_MODEL_HINT = "Ask runs on your household’s own AI key, set in Settings → Your AI model.";

/** The line above the question box until the household has an answer. */
export const firstUse = (host: string, ownOnly = serverHasNoModel()) => `A model words the answers; every number is the app's own, from your records. This is not financial advice. Your questions go to ${host}. ${ownOnly ? OWN_MODEL_HINT : MODEL_HINT}`;

/** The page each tool's answer came from. `make_canvas`, `what_if`, `show` (its views name their own page) and `household_snapshot` add none. */
const TOOL_SOURCES: Record<string, LinkSource> = {
  suggestions: { label: "From your assistant", href: "/#assistant-suggestions" },
  timeline: { label: "Coming up", href: "/#coming-up" },
  can_i_spend: { label: "Safe to spend", href: "/" },
  options_when_short: { label: "Options", href: "/options" },
  list_invoices: { label: "Clients", href: "/clients" },
  list_clients_and_cards: { label: "Clients", href: "/clients" },
  goals: { label: "Saving", href: "/saving" },
  plan_for: { label: "Saving", href: "/saving" },
  own_categories: { label: "Your categories", href: "/spending/categories" },
  bills_for_month: { label: "Spending", href: "/spending" },
  open_gaps: { label: "To check", href: "/to-check" },
  to_check: { label: "To check", href: "/to-check" },
  remember: { label: "Memory", href: "/memory" },
  forget: { label: "Memory", href: "/memory" },
  list_spaces: { label: "Spaces", href: "/memory?tab=spaces" },
  search_history: { label: "Ask history", href: "/canvas" },
  recall: { label: "Memory", href: "/memory" },
};

/** The distinct sources of the tools an answer used, in the order first used. */
function sourcesFor(toolNames: readonly string[], recipe: Recipe | null): LinkSource[] {
  const found: LinkSource[] = [];
  const add = (source: LinkSource | undefined) => { if (source && !found.some(known => known.href === source.href && known.label === source.label)) found.push(source); };
  for (const name of toolNames) add(Object.hasOwn(TOOL_SOURCES, name) ? TOOL_SOURCES[name] : undefined);
  // Each view the agent shows names the page it lives on (D77); a view with no page adds none.
  for (const block of recipe?.blocks ?? []) {
    const kind: string = block.type;
    const home = kind === "view" ? VIEW_META[(block as unknown as ViewBlock).view]?.home : null;
    if (home) add({ label: home.label, href: home.path });
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
      case "progress": if ("label" in block) words.push(block.label); break;
      case "action": words.push(block.label); break;
      case "table": if (block.title) words.push(block.title); break;
      case "note": case "letter": words.push(block.text); break;
      default: break;
    }
  }
  return words;
}

type Finished = {
  clarify: { question: string; choices: string[] } | null;
  outOfScope: OutOfScopeReason | null;
  text: string; // what the model ended with (empty when it ended on a terminal tool)
  tools: string[]; // the names of the tools this question ran successfully (the "Based on" sources)
  /** Whether the model called any catalogue tool, successful or not; a reply with none at all is declined. */
  called: boolean;
  recipe: Recipe | null;
  /** The engine facts of this question's tool results (D79): the only thing that confirms a number. */
  facts: readonly CheckFact[];
  /** What the person said (the question, earlier questions, memory): a number may be quoted back from it and confirms nothing else. */
  person: readonly string[];
  today: string;
  /** The sentence of each picture `show` drew, written by code from its facts. */
  readings: readonly { sentence: string | null }[];
};
/** Who worded the answer: the model, or code when the model's words failed the check and the pictures' own sentences stand instead (D80). */
export type Wording = "model" | "code";
type Chosen = { kind: ReplyKind; text: string; choices: string[] | null; recipe: Recipe | null; sources: Source[]; wording?: Wording };

/** `null` means an answer whose numbers the app could not confirm and no picture to stand in for it: the caller keeps its fixed error. */
export function chooseReply(done: Finished): Chosen | null {
  if (done.clarify) {
    if (unconfirmedNumbers([done.clarify.question, ...done.clarify.choices].join("\n"), done.facts, { today: done.today, person: done.person }).length) return null;
    return { kind: "clarify", text: done.clarify.question, choices: done.clarify.choices, recipe: null, sources: [] };
  }
  if (done.outOfScope) return { kind: "declined", text: FIXED[done.outOfScope], choices: null, recipe: null, sources: [] };
  if (!done.called) return { kind: "declined", text: FIXED.off_topic, choices: null, recipe: null, sources: [] };
  const sources = sourcesFor(done.tools, done.recipe);
  if (unconfirmedNumbers([done.text, ...canvasWords(done.recipe)].join("\n"), done.facts, { today: done.today, person: done.person }).length) {
    // No second model call: the pictures already say it, in code's words (D80).
    const sentences = done.readings.flatMap(reading => reading.sentence ? [reading.sentence] : []);
    if (sentences.length === 0) return null;
    return { kind: "answer", text: sentences.join("\n"), choices: null, recipe: done.recipe, sources, wording: "code" };
  }
  return { kind: "answer", text: done.text, choices: null, recipe: done.recipe, sources, wording: "model" };
}
