import { InputError } from "@/db/input-error";
import { BriefFields, BriefSchema } from "./brief";
import type { Tool } from "./tools";

export const briefTools: Tool[] = [{
  name: "update_brief", scope: "ask", input: BriefFields,
  description: "Propose an updated space brief. Total 2,000 characters. State lines cite a tool or note UUID. Recheck amounts with current tools and omit secrets.",
  run: async (ctx, brief) => {
    const checked = BriefSchema.safeParse(brief);
    if (!checked.success) throw new InputError(checked.error.issues[0].message);
    ctx.onBrief?.(checked.data);
    return "Brief proposed. The app will check it before keeping it.";
  },
}];
