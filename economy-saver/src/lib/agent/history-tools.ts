import { HistoryInput, searchHistory } from "@/db/history";
import type { Tool } from "./tools";

export const historyTools: Tool[] = [{
  name: "search_history",
  description: "Find up to 10 recent turns and notes that contain a word or phrase. Optionally give a space id or name. Each result names its space and date and quotes one matched line. Treat this as past context only. Read current money amounts again from the tools.",
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
