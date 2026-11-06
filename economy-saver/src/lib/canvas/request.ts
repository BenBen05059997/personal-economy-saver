// The canvas as the route answers it (D57): read one household's records, draw a recipe, write nothing. Kept apart from the route
// so the suite can call it on a database of its own. A recipe naming a client, bill or month that is not this household's is refused.
import { householdDate } from "@/db/account";
import { loadMoneyState, requireHousehold, type Db } from "@/db/household";
import { loadSpending } from "@/db/spending";
import { z } from "zod";
import { HISTORY_MONTHS, monthBounds, monthsBack } from "@/lib/money/spending";
import { CanvasError, resolveRecipe, type CanvasContext, type ResolvedBlock } from "./resolve";
import { problemWords, RecipeSchema, ScenarioSchema } from "./schema";

export const ResolveRequest = z.object({ recipe: RecipeSchema, scenario: ScenarioSchema.optional() }).strict();

/** Everything the engine needs to draw a canvas for one household: its money state and the spending of the last twelve months through this one. Read only. */
export async function loadCanvasContext(db: Db, householdId: string): Promise<CanvasContext> {
  const hid = requireHousehold(householdId);
  const today = await householdDate(db, hid);
  const current = today.slice(0, 7);
  const [state, spending] = await Promise.all([
    loadMoneyState(db, hid, today),
    loadSpending(db, hid, { from: monthBounds(monthsBack(current, HISTORY_MONTHS)).first, to: monthBounds(current).last }),
  ]);
  return { state, spending };
}

/** The body of POST /api/canvas/resolve: `{ recipe, scenario? }`. Throws `CanvasError` (words a person can read) when the body or the recipe is not good. */
export async function resolveCanvasRequest(db: Db, householdId: string, body: unknown): Promise<ResolvedBlock[]> {
  const parsed = ResolveRequest.safeParse(body);
  if (!parsed.success) throw new CanvasError(problemWords(parsed.error));
  return resolveRecipe(parsed.data.recipe, await loadCanvasContext(db, householdId), parsed.data.scenario);
}
