import { InputError } from "@/db/input-error";
import { BriefFields, BriefSchema } from "./brief";
import type { Tool } from "./tools";

export const briefTools: Tool[] = [{
  name: "update_brief", scope: "ask", input: BriefFields,
  description: "Propose the space's complete updated brief after an answer changes what the space knows. Keep it to 2,000 characters including the field names. about is the task, goal is the desired result, state is short lines of text with source (a tool name or a memory note UUID), decisions, open_questions and check_next are short lines, and refs lists bill, client, pot and document UUIDs. Do not include secrets. Recheck every amount with the current question's tools.",
  run: async (ctx, brief) => {
    const checked = BriefSchema.safeParse(brief);
    if (!checked.success) throw new InputError(checked.error.issues[0].message);
    ctx.onBrief?.(checked.data);
    return "Brief proposed. The app will check it before keeping it.";
  },
}];
