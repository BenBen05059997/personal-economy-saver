// The memory tools (D58): remember and forget are draft tools (they write the person's own words, never a number),
// recall is a read tool for MCP clients, which have no system text. All three call the same src/db/memory functions as the Memory page.
import { z } from "zod";
import { deleteMemory, listMemory, addMemory } from "@/db/memory";
import { MEMORY_KIND_KEYS, MEMORY_KINDS, MemoryKind, MemoryText } from "@/lib/schema/memory";
import type { Tool, ToolContext } from "./tools";

const by = (ctx: ToolContext) => ({ madeBy: ctx.madeBy, ...(ctx.askId && { askId: ctx.askId }) });

const remember = z.object({
  kind: MemoryKind.describe(`One of: ${MEMORY_KIND_KEYS.map(k => `${k} (${MEMORY_KINDS[k].help.toLowerCase()})`).join("; ")}`),
  text: MemoryText.describe("The person's own words, short, in plain language. Never a number a tool gave, a key, a password, or a card or account number."),
});
const forget = z.object({ id: z.string().uuid().describe("The id of the remembered item, from the memory text or from recall.") });

export const memoryTools: Tool[] = [
  {
    name: "remember",
    description: "Remember something the person asked you to remember, or a lasting fact, preference, goal or standing instruction about their money life they told you. Say in your answer what you remembered. It is shown on their Memory page, where they can change or delete it.",
    input: remember, scope: "draft",
    run: async (ctx: ToolContext, input: z.infer<typeof remember>) => {
      const item = await addMemory(ctx.db, ctx.householdId, input, by(ctx));
      return `Remembered (${MEMORY_KINDS[item.kind].label}): ${item.text}`;
    },
  },
  {
    name: "forget",
    description: "Forget one remembered item when the person asks you to, by its id.",
    input: forget, scope: "draft",
    run: async (ctx: ToolContext, input: z.infer<typeof forget>) =>
      await deleteMemory(ctx.db, ctx.householdId, input.id, by(ctx)) ? "Forgotten." : "Nothing is remembered under that id.",
  },
  {
    name: "recall",
    description: "Everything remembered about the person, as JSON: id, kind, text, createdAt.",
    input: z.object({}), scope: "read",
    run: async (ctx: ToolContext) =>
      JSON.stringify((await listMemory(ctx.db, ctx.householdId)).map(({ id, kind, text, createdAt }) => ({ id, kind, text, createdAt }))),
  },
] as unknown as Tool[];
