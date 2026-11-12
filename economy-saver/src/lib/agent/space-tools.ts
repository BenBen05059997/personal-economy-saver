import { z } from "zod";
import { InputError } from "@/db/input-error";
import { hasLongNumber, SECRET_REFUSAL } from "@/lib/schema/memory";
import { listSpaces } from "@/db/spaces";
import type { Tool } from "./tools";

const proposal = z.object({ name: z.string().trim().min(1).max(60) }).strict();

export const spaceTools: Tool[] = [
  {
    name: "list_spaces",
    scope: "read",
    input: z.object({}).strict(),
    description: "The household's task spaces by id, name and status.",
    run: async ctx => JSON.stringify((await listSpaces(ctx.db, ctx.householdId)).map(({ id, name, status }) => ({ id, name, status }))),
  },
  {
    name: "open_space",
    scope: "ask",
    input: proposal,
    description: "Offer a new space for a distinct money task, with a short name.",
    run: async (ctx, { name }: z.infer<typeof proposal>) => {
      if (!ctx.onOpenSpace) throw new InputError("Space proposals are available in Ask.");
      if (hasLongNumber(name)) throw new InputError(SECRET_REFUSAL);
      if (name.toLowerCase() === "general") throw new InputError("General is already the household’s main space.");
      ctx.onOpenSpace({ name });
      return "Space proposed. The person can choose to open it.";
    },
  },
];
