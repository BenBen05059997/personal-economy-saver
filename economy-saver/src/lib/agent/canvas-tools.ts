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
const RECIPE_HELP = `Recipe JSON: {version:1,title,scenario?,blocks:[1..12]}. Scenario is {case,changes} from what_if.
Blocks by type and fields:
sentence: query sentence
number: label, query safe_to_spend/cash/low_point/month_total/foreign_costs, note?
flow_chart: query flow, mark?
timeline: query events, mark?
table: title?, query events/month_by_category/compare_months/spending_search/regular_costs/foreign_costs/bills_for_month
compare: query compare_months
progress: label and targetMinor for safe_to_spend/cash/month_total, or query goals alone
note: text, by:"assistant"
letter: text
sliders: controls:[{clientId,maxDays}]
action: label, href (app path)
Each block has type. A query is {q,...}. sentence/safe_to_spend/low_point/flow/events can take scenario ({case,changes} or "canvas"). flow/events can take days (7–60). month_total/month_by_category use month (YYYY-MM); compare_months uses a (earlier) and b; spending_search uses text and months (1–12); regular_costs takes months? (2–24); bills_for_month takes month and text?; cash/foreign_costs/goals take no parameters. mark is a bill ID. Only targetMinor and what_if changes hold amounts, in minor units.`;

export const canvasTools: Tool[] = [
  defineTool({
    name: "what_if", scope: "read",
    input: z.object({ case: z.enum(["usual", "late"]), changes: z.array(ChangeSchema).min(1).max(MAX_CHANGES) }),
    description: "Compare before and after hypothetical changes. usual uses usual pay days and late uses slowest. Amounts are home-currency minor units. Get IDs from read tools. A bill ID with @date changes one occurrence.",
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
    description: `Draw a canvas from checked JSON text. The last valid canvas is shown.\n${RECIPE_HELP}`,
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
    description: "End with a clarifying question and 2\u20134 choices. Run it alone.",
    run: async (ctx, input) => { ctx.onClarify?.({ question: input.question, choices: input.choices }); return "The question was shown to the person."; },
  }),
  defineTool({
    name: "out_of_scope", scope: "ask",
    input: z.object({ reason: z.enum(["off_topic", "not_offered"]) }),
    description: "End for off-topic requests or investment picks, tax filing or legal advice. The app supplies the reply.",
    run: async (ctx, input) => { ctx.onOutOfScope?.(input.reason); return "The app showed its fixed sentence."; },
  }),
];
