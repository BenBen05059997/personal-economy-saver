// The provider-neutral shapes every model call uses (D56). Ask and the reader are written against these only.
export type Protocol = "anthropic" | "openai"; // "openai" = OpenAI-compatible Chat Completions: POST {baseUrl}/chat/completions

/** Where a call goes. `own` = the household's connection, not the server default; `key` is null for an endpoint that needs none. */
export type Connection = {
  protocol: Protocol; baseUrl: string; key: string | null; textModel: string | null; documentModel: string | null; own: boolean;
};

export type Part = { type: "text"; text: string } | { type: "image"; mime: string; base64: string } | { type: "pdf"; base64: string };
export type ToolResult = { id: string; name: string; content: string; isError: boolean };
/** `raw` is the provider's own assistant message exactly as the adapter returned it in `Reply.raw` (Anthropic: the content blocks, thinking included; OpenAI-compatible: the `message` object with its `tool_calls`). */
export type Turn = { role: "user"; parts: Part[] } | { role: "assistant"; raw: unknown } | { role: "tools"; results: ToolResult[] };
export type ToolSpec = { name: string; description: string; schema: object };

export type ModelRequest = {
  connection: Connection; model: string; system: string; turns: Turn[]; tools?: ToolSpec[]; forceTool?: string;
  maxTokens: number; timeoutMs: number; fetch?: typeof globalThis.fetch;
  /** The app's own address, for the localhost rule; defaults to the APP_URL setting. Tests inject it. */
  appUrl?: URL;
};

export type Reply = {
  text: string; calls: { id: string; name: string; input: unknown }[];
  stop: "end" | "tools" | "length" | "refusal" | "pause" | "other";
  raw: unknown; inputTokens: number; outputTokens: number;
};

/** Messages are fixed and free of secrets, URLs and model output; `status` is the HTTP status when the provider answered. */
export class ModelError extends Error {
  constructor(message: string, readonly status?: number, readonly timeout = false) { super(message); }
}
