// The one content-free log line per Ask and per MCP call (D50): ids, tool names, counts, outcome, timings and token counts.
// Ask also says the kind of reply and whether it had a canvas; thumbs write one line of their own (askId and the thumb, nothing else).
// Never the question, the answer, a tool argument or result, the key or a provider's error message. Every line goes
// through here so tests can capture it.
export type ToolLog = { name: string; ok: boolean; ms: number };

export type BriefDropReason = "no_answer" | "invalid_source" | "unconfirmed_amount";

type CallLog = {
  at: "ask" | "mcp";
  householdId: string;
  askId?: string;
  source?: "voice" | "manual";
  stop: string;
  turns: number;
  tools: ToolLog[];
  outcome: string;
  /** Ask only: answer, clarify, declined or error; and whether the reply carried a canvas. */
  kind?: string;
  canvas?: boolean;
  briefDropped?: BriefDropReason;
  ms: number;
  inputTokens?: number;
  outputTokens?: number;
  protocol?: string;
  own?: boolean;
};

type ThumbLog = { at: "thumb"; householdId: string; askId: string; thumb: "up" | "down" | null };

/** Voice fill (28B): one line per call, counts and outcome only; never the words, the labels or the values. */
type VoiceLog = { at: "voice"; householdId: string; fields: number; ok: boolean; ms: number };

export function logVoice(entry: VoiceLog): void {
  console.info(JSON.stringify(entry));
}

export function logThumb(entry: ThumbLog): void {
  console.info(JSON.stringify(entry));
}

export function logCall(entry: CallLog): void {
  console.info(JSON.stringify(entry));
}
