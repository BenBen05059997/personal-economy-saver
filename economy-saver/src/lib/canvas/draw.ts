import { SESSION_ENDED } from "@/lib/session-ended";
import type { ResolvedBlock } from "./resolve";
import type { Recipe, Scenario } from "./schema";

/** The browser's read-only canvas request. Refusals return the words to show beside the canvas. */
export async function drawCanvas(
  recipe: Recipe,
  { scenario, signal }: { scenario?: Scenario; signal?: AbortSignal } = {},
  fetcher: typeof fetch = fetch,
): Promise<ResolvedBlock[] | string> {
  const response = await fetcher("/api/canvas/resolve", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipe, scenario }), signal,
  });
  if (response.status === 401) return SESSION_ENDED;
  if (!response.ok) return response.text();
  return ((await response.json()) as { blocks: ResolvedBlock[] }).blocks;
}
