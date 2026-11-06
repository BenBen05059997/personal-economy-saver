import Anthropic from "@anthropic-ai/sdk";
import { ModelError, type ModelRequest, type Part, type Reply, type Turn } from "./types";

// The only file that imports the Anthropic SDK. Host from the connection, no retries (each attempt reserves its own
// allowance), no SDK logging.
const block = (part: Part): Anthropic.ContentBlockParam =>
  part.type === "text" ? { type: "text", text: part.text }
  : part.type === "image" ? { type: "image", source: { type: "base64", media_type: part.mime as "image/png", data: part.base64 } }
  : { type: "document", source: { type: "base64", media_type: "application/pdf", data: part.base64 } };

function message(turn: Turn): Anthropic.MessageParam {
  if (turn.role === "assistant") return { role: "assistant", content: turn.raw as Anthropic.ContentBlockParam[] };
  if (turn.role === "tools") {
    return { role: "user", content: turn.results.map(r => ({ type: "tool_result" as const, tool_use_id: r.id, content: r.content, ...(r.isError && { is_error: true }) })) };
  }
  const only = turn.parts.length === 1 ? turn.parts[0] : null;
  return { role: "user", content: only?.type === "text" ? only.text : turn.parts.map(block) };
}

const STOPS: Record<string, Reply["stop"]> = {
  end_turn: "end", stop_sequence: "end", tool_use: "tools", max_tokens: "length", refusal: "refusal", pause_turn: "pause",
};

export async function callAnthropic(request: ModelRequest): Promise<Reply> {
  const { connection: c } = request;
  if (!c.key) throw new ModelError("The AI key is missing.");
  const client = new Anthropic({ apiKey: c.key, baseURL: c.baseUrl, fetch: request.fetch, maxRetries: 0, timeout: request.timeoutMs, logLevel: "off" });
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: request.model, max_tokens: request.maxTokens, system: request.system, messages: request.turns.map(message),
      ...(request.tools && { tools: request.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.schema as Anthropic.Tool.InputSchema, strict: true })) }),
      ...(request.tools && { tool_choice: request.forceTool ? { type: "tool" as const, name: request.forceTool } : { type: "auto" as const } }),
      // A forced tool and the effort setting are not combined: the reader never sent one.
      ...(!request.forceTool && { output_config: { effort: "low" as const } }),
    });
  } catch (error) {
    if (error instanceof Anthropic.APIConnectionTimeoutError) throw new ModelError("The AI service took too long.", undefined, true);
    if (error instanceof Anthropic.APIError && error.status !== undefined) throw new ModelError("The AI service refused the request.", error.status);
    throw new ModelError("Couldn't reach the AI service.");
  }
  return {
    text: response.content.flatMap(b => b.type === "text" ? [b.text] : []).join("\n"),
    calls: response.content.flatMap(b => b.type === "tool_use" ? [{ id: b.id, name: b.name, input: b.input }] : []),
    stop: STOPS[response.stop_reason ?? ""] ?? "other",
    raw: response.content, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens,
  };
}
