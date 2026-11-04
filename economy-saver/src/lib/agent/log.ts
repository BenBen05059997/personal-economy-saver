// The one content-free log line per Ask and per MCP call (D50): ids, tool names, counts, outcome, timings and token counts.
// Never the question, the answer, a tool argument or result, the key or a provider's error message. Every line goes
// through here so tests can capture it.
export type ToolLog = { name: string; ok: boolean; ms: number };

export type CallLog = {
  at: "ask" | "mcp";
  householdId: string;
  askId?: string;
  source?: "voice" | "manual";
  stop: string;
  turns: number;
  tools: ToolLog[];
  outcome: string;
  ms: number;
  inputTokens?: number;
  outputTokens?: number;
};

export function logCall(entry: CallLog): void {
  console.info(JSON.stringify(entry));
}
