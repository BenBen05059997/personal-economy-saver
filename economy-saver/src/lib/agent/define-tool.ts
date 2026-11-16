// How a tool is written, once: the catalogue's tools take their input type from their schema. Types only from tools.ts (it spreads every tool file).
import type { z } from "zod";
import type { Tool, ToolContext } from "./tools";

export function defineTool<S extends z.ZodObject<z.ZodRawShape>>(tool: Omit<Tool, "input" | "run"> & {
  input: S;
  run: (ctx: ToolContext, input: z.infer<S>) => Promise<string>;
}): Tool {
  return tool as unknown as Tool;
}

/** Who made a row a tool writes: Ask or MCP, and the question it came from. */
export const by = (ctx: ToolContext) => ({ madeBy: ctx.madeBy, ...(ctx.askId && { askId: ctx.askId }) });
