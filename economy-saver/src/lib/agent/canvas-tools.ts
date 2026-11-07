// The canvas tools (D57, D60). `what_if` and `make_canvas` read the engine and are also offered over MCP; `clarify` and `out_of_scope`
// have scope "ask": only the in-app agent offers them, and each ends the question (the reply kind is chosen by code, reply.ts).
// This file does not import tools.ts as a value (tools.ts spreads `canvasTools`): types only.
import { z } from "zod";
import { loadCanvasContext } from "@/lib/canvas/request";
import { CanvasError, resolveRecipe } from "@/lib/canvas/resolve";
import { ChangeSchema, MAX_CHANGES, problemWords, RecipeSchema, type Recipe } from "@/lib/canvas/schema";
import { canvasSummary } from "@/lib/canvas/summary";
import { InputError } from "@/db/input-error";
import { homeSentence } from "@/lib/money/sentence";
import { low, safeToSpend, series } from "@/lib/money/runway";
import { minorPerUnit } from "@/lib/money/format";
import { whatIf, WhatIfError } from "@/lib/money/whatif";
import type { MoneyState } from "@/lib/money/types";
import type { Tool } from "./tools";

function defineTool<S extends z.ZodObject<z.ZodRawShape>>(tool: {
  name: string; description: string; input: S; scope: Tool["scope"];
  run: (ctx: Parameters<Tool["run"]>[0], input: z.infer<S>) => Promise<string>;
}): Tool {
  return tool as unknown as Tool;
}

const KINDS = { usual: "expected", late: "worst" } as const;

function figures(state: MoneyState, kind: "expected" | "worst") {
  const unit = minorPerUnit(state.homeCurrency);
  const point = low(series(state, kind), state.today);
  return { lowPoint: { amountMinor: Math.round(point.amount * unit), date: point.date }, safeToSpendMinor: Math.round(safeToSpend(state, 0).amount * unit) };
}

/** The block and query list the model builds a recipe from (the full JSON Schema is ~20 KB; this is the short form). */
const RECIPE_HELP = `A canvas is a JSON object (as text): { "version": 1, "title": "up to 80 characters", "scenario"?: { "case": "usual" | "late", "changes": [what-if changes] }, "blocks": [1 to 12 blocks] }.
Blocks: { "type": "sentence", "query": { "q": "sentence", "scenario"?: ... } } | { "type": "number", "label", "query": safe_to_spend | cash | low_point | month_total | foreign_costs (the total cost), "note"? } | { "type": "flow_chart", "query": { "q": "flow", "days"?: 7-60 } } | { "type": "timeline", "query": { "q": "events", "days"? } } | { "type": "table", "title"?, "query": events | month_by_category | compare_months | spending_search | regular_costs | foreign_costs | bills_for_month } | { "type": "compare", "query": { "q": "compare_months", "a": "YYYY-MM", "b": "YYYY-MM" } } | { "type": "progress", "label", "query": safe_to_spend | cash | month_total, "targetMinor": the person's own target } | { "type": "note", "text", "by": "assistant" } | { "type": "letter", "text" } | { "type": "sliders", "controls": [{ "clientId", "maxDays" }] } | { "type": "action", "label", "href": "/a-page-in-the-app" }.
Queries: sentence, safe_to_spend, low_point, flow and events take an optional "scenario" (an object { case, changes } of their own, or "canvas" for the canvas's live one); cash needs none; month_total and month_by_category take "month" (YYYY-MM, within the last twelve months); compare_months takes "a" (earlier) and "b"; spending_search takes "text" and "months" (1-12); regular_costs takes optional "months" (2-24); bills_for_month takes "month" (YYYY-MM, the month the bills are for, up to two years ahead) and optional "text" (a name); foreign_costs needs none (the last 12 months: PayPal payouts per client, card purchases in another currency per card).
Changes: { "kind": "client_late", "clientId", "days" } | { "kind": "remove_bill", "billId" } | { "kind": "change_bill", "billId", "amountMinor" } | { "kind": "add_cost", "name", "amountMinor", "date" } | { "kind": "add_income", "name", "amountMinor", "date" }. Client ids come from list_clients_and_cards; bill ids from whats_due or timeline.
Amounts never go in a block: a block holds a question and the app draws the answer from the person's records each time (the only amounts you write are a progress block's target and the amounts in a change, in integer minor units). Every key not listed is refused.`;

export const canvasTools: Tool[] = [
  defineTool({
    name: "what_if", scope: "read",
    input: z.object({ case: z.enum(["usual", "late"]), changes: z.array(ChangeSchema).min(1).max(MAX_CHANGES) }),
    description: `Run the engine on a copy of the household with changes, and compare with now. case: usual = clients pay on their usual day, late = on their slowest. changes: client_late (clientId, days), remove_bill (billId), change_bill (billId, amountMinor), add_cost (name, amountMinor, date) or add_income (name, amountMinor, date); amounts are integer minor units of the home currency (whole yen, cents for USD). Client ids come from list_clients_and_cards; bill ids from whats_due or timeline (a stored id is every occurrence of a bill, <id>@<date> is one). Returns the sentence, the low point, safe to spend, and the same two numbers now. Nothing is saved.`,
    run: async (ctx, input) => {
      const state = await ctx.state();
      let changed: MoneyState;
      try { changed = whatIf(state, input.changes); }
      catch (error) { if (error instanceof WhatIfError) throw new InputError(error.message); throw error; }
      const kind = KINDS[input.case];
      const after = figures(changed, kind), before = figures(state, kind);
      const note = homeSentence(changed).note;
      return JSON.stringify({
        case: input.case, sentence: homeSentence(changed).text + (note ? ` ${note}` : ""),
        lowPoint: after.lowPoint, safeToSpendMinor: after.safeToSpendMinor,
        now: { lowPoint: before.lowPoint, safeToSpendMinor: before.safeToSpendMinor },
        lowPointChangeMinor: after.lowPoint.amountMinor - before.lowPoint.amountMinor,
      });
    },
  }),
  defineTool({
    name: "make_canvas", scope: "read",
    input: z.object({ recipe: z.string().min(2).max(40_000).describe("The canvas recipe as JSON text.") }),
    description: `Lay an answer out as a canvas the person sees beside the conversation. Pass the recipe as JSON text. The app checks it, fills in every value from the person's records and returns what it drew (block type, label, values); the last valid canvas of the question is the one shown. A problem comes back in words: fix the recipe and call again. Use it to show, compare or plan something, and to put a letter or note the person asked for on the canvas.\n${RECIPE_HELP}`,
    run: async (ctx, input) => {
      let json: unknown;
      try { json = JSON.parse(input.recipe); } catch { throw new InputError("The recipe is not valid JSON."); }
      const parsed = RecipeSchema.safeParse(json);
      if (!parsed.success) throw new InputError(problemWords(parsed.error));
      // What the person reads under a note is marked as the assistant's.
      const recipe: Recipe = { ...parsed.data, blocks: parsed.data.blocks.map(block => (block.type === "note" ? { ...block, by: "assistant" as const } : block)) };
      let blocks;
      try { blocks = resolveRecipe(recipe, await loadCanvasContext(ctx.db, ctx.householdId, recipe)); }
      catch (error) { if (error instanceof CanvasError) throw new InputError(error.message); throw error; }
      ctx.onCanvas?.(recipe);
      return canvasSummary(blocks);
    },
  }),
  defineTool({
    name: "clarify", scope: "ask",
    input: z.object({ question: z.string().min(1).max(200), choices: z.array(z.string().min(1).max(60)).min(2).max(4) }),
    description: "Ask the person one short question when a name or a request could mean two or more things, with 2 to 4 short choices they can tap. This ends your turn: write nothing else and call no other tool with it.",
    run: async (ctx, input) => { ctx.onClarify?.({ question: input.question, choices: input.choices }); return "The question was shown to the person."; },
  }),
  defineTool({
    name: "out_of_scope", scope: "ask",
    input: z.object({ reason: z.enum(["off_topic", "not_offered"]) }),
    description: "End the question when it is not about the person's money (off_topic), or asks which investment to buy, how to file taxes or a legal question (not_offered). The app shows its own fixed sentence; write nothing else.",
    run: async (ctx, input) => { ctx.onOutOfScope?.(input.reason); return "The app showed its fixed sentence."; },
  }),
];
