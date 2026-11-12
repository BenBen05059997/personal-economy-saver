import { HistoryInput, searchHistory } from "@/db/history";
import type { Tool } from "./tools";

export const historyTools: Tool[] = [{
  name: "search_history",
  description: "The ten newest matching history lines in a space or across spaces. Recheck past amounts with tools.",
  input: HistoryInput,
  scope: "read",
  async run(ctx, input) {
    const { hits, unavailable } = await searchHistory(ctx.db, ctx.householdId, input, {
      turns: ctx.deviceHistory, notes: ctx.deviceMemory?.items,
    });
    for (const hit of hits) if (hit.kind === "memory") ctx.onMemoryRead?.(hit.id);
    const kinds = unavailable.map(kind => kind === "journal" ? "conversation history" : "memory");
    const note = kinds.length ? `This household keeps its ${kinds.join(" and ")} on one device. Ask in the app on that device.` : undefined;
    return JSON.stringify({ hits, ...(note && { note }) });
  },
}];
