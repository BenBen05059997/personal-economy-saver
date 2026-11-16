import { drawCanvas } from "@/lib/canvas/draw";
import type { ResolvedBlock } from "@/lib/canvas/resolve";
import type { Recipe } from "@/lib/canvas/schema";
import { COULDNT_REACH_HOUSEHOLD } from "./words";

/** Asks the engine to draw one recipe; the route reads the household's records and keeps nothing. When the household cannot be reached the words are `COULDNT_REACH_HOUSEHOLD` and `tryAgain`. */
export async function drawRecipe(recipe: Recipe, tryAgain: string): Promise<ResolvedBlock[] | string> {
  try {
    return await drawCanvas(recipe);
  } catch { return `${COULDNT_REACH_HOUSEHOLD} ${tryAgain}`; }
}
