// The canvas as the route answers it (D57): read one household's records, draw a recipe, write nothing. Kept apart from the route
// so the suite can call it on a database of its own. A recipe naming a client, bill or month that is not this household's is refused.
import { householdDate } from "@/db/account";
import { foreignCostInputs } from "@/db/fx-cost";
import { loadMoneyState, requireHousehold, type Db } from "@/db/household";
import { loadPeriodBills, loadSpending } from "@/db/spending";
import { z } from "zod";
import { foreignCosts } from "@/lib/money/fx-cost";
import { HISTORY_MONTHS, monthBounds, monthsBack } from "@/lib/money/spending";
import { asksForeignCosts, asksPeriodBills, CanvasError, resolveRecipe, type CanvasContext, type ResolvedBlock } from "./resolve";
import { problemWords, RecipeSchema, ScenarioSchema, type Block } from "./schema";

const ResolveRequest = z.object({ recipe: RecipeSchema, scenario: ScenarioSchema.optional() }).strict();

/**
 * Everything the engine needs to draw this recipe for one household: its money state and the spending of the last twelve months through
 * this one, and the foreign costs and the bills that carry a period only when a block of the recipe asks for them (D62, D63). Read only.
 */
export async function loadCanvasContext(db: Db, householdId: string, recipe: { blocks: readonly Block[] }): Promise<CanvasContext> {
  const hid = requireHousehold(householdId);
  const today = await householdDate(db, hid);
  const current = today.slice(0, 7);
  const [state, spending, fx, periodBills] = await Promise.all([
    loadMoneyState(db, hid, today),
    loadSpending(db, hid, { from: monthBounds(monthsBack(current, HISTORY_MONTHS)).first, to: monthBounds(current).last }),
    asksForeignCosts(recipe) ? foreignCostInputs(db, hid, today).then(foreignCosts) : Promise.resolve(undefined),
    asksPeriodBills(recipe) ? loadPeriodBills(db, hid) : Promise.resolve(undefined),
  ]);
  return { state, spending, ...(fx && { foreignCosts: fx }), ...(periodBills && { periodBills }) };
}

/** The body of POST /api/canvas/resolve: `{ recipe, scenario? }`. Throws `CanvasError` (words a person can read) when the body or the recipe is not good. */
export async function resolveCanvasRequest(db: Db, householdId: string, body: unknown): Promise<ResolvedBlock[]> {
  const parsed = ResolveRequest.safeParse(body);
  if (!parsed.success) throw new CanvasError(problemWords(parsed.error));
  return resolveRecipe(parsed.data.recipe, await loadCanvasContext(db, householdId, parsed.data.recipe), parsed.data.scenario);
}
