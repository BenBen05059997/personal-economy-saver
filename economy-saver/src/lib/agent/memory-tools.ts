// The memory tools (D58): remember and forget are draft tools (they write the person's own words, never a number),
// recall is a read tool for MCP clients, which have no system text. All three call the same src/db/memory functions as the Memory page.
import { z } from "zod";
import { deleteMemory, listMemory, addMemory } from "@/db/memory";
import { InputError } from "@/db/input-error";
import { DEVICE_MEMORY_WORDS, readPlaces } from "@/db/place";
import { addMemoryItem, forgetMemoryItem, MAX_MEMORY_CHANGES } from "@/lib/store/memory-ops";
import { MEMORY_KIND_KEYS, MEMORY_KINDS, MemoryKind, MemoryText } from "@/lib/schema/memory";
import type { Tool, ToolContext } from "./tools";

const by = (ctx: ToolContext) => ({ madeBy: ctx.madeBy, ...(ctx.askId && { askId: ctx.askId }) });

const remember = z.object({
  kind: MemoryKind.describe(`One of: ${MEMORY_KIND_KEYS.map(k => `${k} (${MEMORY_KINDS[k].help.toLowerCase()})`).join("; ")}`),
  text: MemoryText.describe("The person's own words, short, in plain language. Never a number a tool gave, a key, a password, or a card or account number."),
});
/** True when the household keeps its memory on one device and this call has no list from it (MCP, or a stale page): the tools do not touch the cloud then. */
const onAnotherDevice = async (ctx: ToolContext) => !ctx.deviceMemory && (await readPlaces(ctx.db, ctx.householdId)).memory === "device";

/** The device list takes at most MAX_MEMORY_CHANGES changes from one question, so the tools stop there instead of the browser refusing them all. */
const room = (ctx: ToolContext) => {
  if (ctx.deviceMemory && ctx.deviceMemory.changes.length >= MAX_MEMORY_CHANGES) throw new InputError(`I can make at most ${MAX_MEMORY_CHANGES} memory changes in one question.`);
};

const forget = z.object({ id: z.string().uuid().describe("The id of the remembered item, from the memory text or from recall.") });

export const memoryTools: Tool[] = [
  {
    name: "remember",
    description: "Remember something the person asked you to remember, or a lasting fact, preference, goal or standing instruction about their money life they told you. Say in your answer what you remembered. It is shown on their Memory page, where they can change or delete it.",
    input: remember, scope: "draft",
    run: async (ctx: ToolContext, input: z.infer<typeof remember>) => {
      room(ctx);
      if (ctx.deviceMemory) {
        // The list came with the question and goes back with the reply; nothing is stored here.
        const result = addMemoryItem(ctx.deviceMemory.items, input, by(ctx), ctx.deviceMemory.moment, crypto.randomUUID());
        ctx.deviceMemory.items = result.items;
        if (result.added) ctx.deviceMemory.changes.push({ op: "add", item: result.item });
        return `Remembered (${MEMORY_KINDS[result.item.kind].label}): ${result.item.text}`;
      }
      if (await onAnotherDevice(ctx)) throw new InputError(DEVICE_MEMORY_WORDS);
      const item = await addMemory(ctx.db, ctx.householdId, input, by(ctx));
      return `Remembered (${MEMORY_KINDS[item.kind].label}): ${item.text}`;
    },
  },
  {
    name: "forget",
    description: "Forget one remembered item when the person asks you to, by its id.",
    input: forget, scope: "draft",
    run: async (ctx: ToolContext, input: z.infer<typeof forget>) => {
      room(ctx);
      if (ctx.deviceMemory) {
        const result = forgetMemoryItem(ctx.deviceMemory.items, input.id);
        ctx.deviceMemory.items = result.items;
        if (result.removed) ctx.deviceMemory.changes.push({ op: "forget", id: input.id });
        return result.removed ? "Forgotten." : "Nothing is remembered under that id.";
      }
      if (await onAnotherDevice(ctx)) throw new InputError(DEVICE_MEMORY_WORDS);
      return await deleteMemory(ctx.db, ctx.householdId, input.id, by(ctx)) ? "Forgotten." : "Nothing is remembered under that id.";
    },
  },
  {
    name: "recall",
    description: "Everything remembered about the person, as JSON: id, kind, text, createdAt.",
    input: z.object({}), scope: "read",
    run: async (ctx: ToolContext) => {
      const items = ctx.deviceMemory ? ctx.deviceMemory.items : await onAnotherDevice(ctx) ? null : await listMemory(ctx.db, ctx.householdId);
      return items ? JSON.stringify(items.map(({ id, kind, text, createdAt }) => ({ id, kind, text, createdAt }))) : DEVICE_MEMORY_WORDS;
    },
  },
] as unknown as Tool[];
