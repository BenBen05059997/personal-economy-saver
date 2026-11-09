// The memory tools (D58): remember and forget are draft tools (they write the person's own words, never a number),
// recall is a read tool for MCP clients, which have no system text. All three call the same src/db/memory functions as the Memory page.
import { z } from "zod";
import { deleteMemory, listMemory, addMemory } from "@/db/memory";
import { resolveMemorySpace } from "@/db/history";
import { InputError } from "@/db/input-error";
import { DEVICE_MEMORY_WORDS, readPlaces } from "@/db/place";
import { addMemoryItem, forgetMemoryItem, inMemoryScope, MAX_MEMORY_CHANGES } from "@/lib/store/memory-ops";
import { MEMORY_KINDS, MemoryKind, MemoryText } from "@/lib/schema/memory";
import type { Tool, ToolContext } from "./tools";

const by = (ctx: ToolContext) => ({ madeBy: ctx.madeBy, ...(ctx.askId && { askId: ctx.askId }) });

const remember = z.object({
  kind: MemoryKind,
  text: MemoryText.describe("The person’s own words, without secrets."),
});
/** True when the household keeps its memory on one device and this call has no list from it (MCP, or a stale page): the tools do not touch the cloud then. */
const onAnotherDevice = async (ctx: ToolContext) => !ctx.deviceMemory && (await readPlaces(ctx.db, ctx.householdId)).memory === "device";

/** The device list takes at most MAX_MEMORY_CHANGES changes from one question, so the tools stop there instead of the browser refusing them all. */
const room = (ctx: ToolContext) => {
  if (ctx.deviceMemory && ctx.deviceMemory.changes.length >= MAX_MEMORY_CHANGES) throw new InputError(`I can make at most ${MAX_MEMORY_CHANGES} memory changes in one question.`);
};

const recall = z.object({ space: z.string().trim().min(1).max(60).nullish() });
const forget = z.object({ id: z.string().uuid().describe("The id of the remembered item, from the memory text or from recall.") });

export const memoryTools: Tool[] = [
  {
    name: "remember",
    description: "Keep what the person explicitly asks you to remember. Say what you kept.",
    input: remember, scope: "draft",
    run: async (ctx: ToolContext, input: z.infer<typeof remember>) => {
      if (ctx.canRemember === false) throw new InputError("Use Keep this? unless the person asks to remember it.");
      room(ctx);
      const scoped = { ...input, spaceId: ctx.memorySpaceId };
      if (ctx.deviceMemory) {
        // The list came with the question and goes back with the reply; nothing is stored here.
        const result = addMemoryItem(ctx.deviceMemory.items, scoped, by(ctx), ctx.deviceMemory.moment, crypto.randomUUID());
        ctx.deviceMemory.items = result.items;
        if (result.added) ctx.deviceMemory.changes.push({ op: "add", item: result.item });
        return `Remembered (${MEMORY_KINDS[result.item.kind].label}): ${result.item.text}`;
      }
      if (await onAnotherDevice(ctx)) throw new InputError(DEVICE_MEMORY_WORDS);
      const item = await addMemory(ctx.db, ctx.householdId, scoped, by(ctx));
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
    description: "Read Profile and current Ask notes. An explicit space selects only its notes.",
    input: recall, scope: "read",
    run: async (ctx: ToolContext, { space }: z.infer<typeof recall>) => {
      if (await onAnotherDevice(ctx)) return DEVICE_MEMORY_WORDS;
      const scopeId = space ? (await resolveMemorySpace(ctx.db, ctx.householdId, space)).id : ctx.spaceId;
      const visible = (ctx.deviceMemory?.items ?? await listMemory(ctx.db, ctx.householdId))
        .filter(item => inMemoryScope(item, scopeId ?? null) || (!space && inMemoryScope(item, null)));
      return JSON.stringify(visible.map(({ id, kind, text, createdAt }) => {
        ctx.onMemoryRead?.(id);
        return { id, kind, text, createdAt };
      }));
    },
  },
] as unknown as Tool[];
