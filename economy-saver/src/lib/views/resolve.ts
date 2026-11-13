// The one door to a view (D77): the arguments are checked against the view's own strict schema, a view that is not live is refused in words,
// and the resolver runs on the context the caller loaded. Pure.
import type { z } from "zod";
import { VIEW_ARGS, type ViewArgs } from "./args";
import { VIEW_META } from "./catalogue";
import { LIVE } from "./resolvers";
import { ViewError, type Resolver, type ViewContext, type ViewId, type ViewNeed, type ViewResult } from "./types";

/** The ids that can be drawn now. */
export const liveViews = (): ViewId[] => (Object.keys(LIVE) as ViewId[]).filter(view => LIVE[view] !== undefined);

const isView = (value: unknown): value is ViewId => typeof value === "string" && Object.hasOwn(VIEW_ARGS, value);

/** The first problem of a failed argument check, in words a person (or the agent) can act on. */
function argWords(view: ViewId, error: z.ZodError): string {
  const issue = error.issues[0];
  const where = issue.path.length ? ` (${issue.path.join(" > ")})` : "";
  if (issue.code === "unrecognized_keys") return `${view} does not take ${issue.keys.map(key => `"${key}"`).join(", ")}.`;
  return `${view}${where}: ${issue.message}`;
}

/** Draw one view: `view` is an id, `args` its arguments (ids, minor units). Throws `ViewError` for an unknown or not-live view and for arguments the view does not take. */
export function resolveView(view: string, args: unknown, ctx: ViewContext): ViewResult {
  if (!isView(view)) throw new ViewError(`There is no picture called "${view}".`);
  const resolver = LIVE[view] as Resolver<ViewId> | undefined;
  if (!resolver) throw new ViewError("That picture isn't available yet.");
  const parsed = VIEW_ARGS[view].safeParse(args ?? {});
  if (!parsed.success) throw new ViewError(argWords(view, parsed.error));
  for (const need of VIEW_META[view].needs) {
    if ((need === "spending" && !ctx.spending) || (need === "income" && !ctx.income) || (need === "potFills" && !ctx.potFills) || (need === "fx" && !ctx.foreignCosts)) throw new Error(`The ${need} was not loaded for ${view}`);
  }
  return resolver(parsed.data as ViewArgs[ViewId], ctx);
}

/** What the view blocks among `blocks` need loaded, each once. */
export function needsOf(blocks: readonly { type: string; view?: string }[]): ViewNeed[] {
  const needs = new Set<ViewNeed>();
  for (const block of blocks) if (block.type === "view" && block.view !== undefined && isView(block.view)) for (const need of VIEW_META[block.view].needs) needs.add(need);
  return [...needs];
}
