import { InputError } from "@/db/input-error";
import { BRIEF_MAX, BriefFields, BriefSchema } from "./brief";
import { group } from "@/lib/money/format";
import type { Tool } from "./tools";

/** The name of the tool that proposes a brief; it is offered only when the question has a space to hold one. */
export const UPDATE_BRIEF_TOOL = "update_brief";

export const briefTools: Tool[] = [{
  name: UPDATE_BRIEF_TOOL, words: "Updating the space brief", echoes: true, scope: "ask", input: BriefFields,
  description: `Propose an updated space brief, ${group(BRIEF_MAX)} characters in all. State lines cite a tool or note UUID.`,
  run: async (ctx, brief) => {
    const checked = BriefSchema.safeParse(brief);
    if (!checked.success) throw new InputError(checked.error.issues[0].message);
    ctx.onBrief?.(checked.data);
    return "Brief proposed. The app will check it before keeping it.";
  },
}];
