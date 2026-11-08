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
    description: "List this household's task spaces by id, name and status. General is the permanent space.",
    run: async ctx => JSON.stringify((await listSpaces(ctx.db, ctx.householdId)).map(({ id, name, status }) => ({ id, name, status }))),
  },
  {
    name: "open_space",
    scope: "ask",
    input: proposal,
    description: "Offer a new space when this question starts a distinct money task. Supply a short name. The person decides whether to create it.",
    run: async (ctx, { name }: z.infer<typeof proposal>) => {
      if (!ctx.onOpenSpace) throw new InputError("Space proposals are available in Ask.");
      if (hasLongNumber(name)) throw new InputError(SECRET_REFUSAL);
      if (name.toLowerCase() === "general") throw new InputError("General is already the household’s main space.");
      ctx.onOpenSpace({ name });
      return "Space proposed. The person can choose to open it.";
    },
  },
];
