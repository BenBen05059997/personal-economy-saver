import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { tokenParamFor } from "./providers";
import { generate, sdkFetch } from "./sdk";
import { ModelError, type ModelRequest, type Reply } from "./types";

type Message = Record<string, unknown>;
type Wire = { choices?: { message?: Message; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
const STOPS: Record<string, Reply["stop"]> = { stop: "end", tool_calls: "tools", length: "length", content_filter: "refusal" };

/** "tool_calls" with no calls is an answer when there is text and an unexpected stop when there is none. */
function stopOf(finish: string | undefined, hasCalls: boolean, hasText: boolean): Reply["stop"] {
  if (hasCalls) return "tools";
  if (finish === "tool_calls") return hasText ? "end" : "other";
  return STOPS[finish ?? ""] ?? "other";
}

export async function callOpenAI(request: ModelRequest): Promise<Reply> {
  const { connection: c } = request;
  const provider = createOpenAICompatible({
    name: "openai-compatible", baseURL: c.baseUrl, apiKey: c.key ?? undefined, fetch: sdkFetch(request),
    transformRequestBody: body => {
      const messages = (body.messages as Message[]).map(message => {
        if (message.role !== "assistant") return message;
        const turn = request.turns[Number(message.content)];
        return turn?.role === "assistant" ? turn.raw as Message : message;
      });
      const { max_tokens, ...rest } = body;
      return { ...rest, messages, [tokenParamFor(c.baseUrl)]: max_tokens };
    },
  });
  const generated = await generate(provider(request.model), request);
  const wire = generated.response?.body as Wire;
  const choice = wire.choices?.[0];
  const message = choice?.message;
  if (!message) throw new ModelError("The AI service sent a reply the app could not read.");
  const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls as { id?: string; function?: { name?: string; arguments?: string } }[] : [];
  const calls = rawCalls.map(call => {
    let input: unknown = null;
    try { input = JSON.parse(call.function?.arguments ?? ""); } catch { /* The caller validates null with paths only. */ }
    return { id: call.id || "call_" + crypto.randomUUID(), name: String(call.function?.name ?? ""), input };
  });
  return {
    text: typeof message.content === "string" ? message.content : "",
    calls, stop: stopOf(choice.finish_reason, calls.length > 0, typeof message.content === "string" && message.content.trim() !== ""),
    raw: calls.length ? { ...message, tool_calls: rawCalls.map((call, i) => ({ ...call, id: calls[i].id })) } : message,
    inputTokens: wire.usage?.prompt_tokens ?? 0, outputTokens: wire.usage?.completion_tokens ?? 0,
  };
}
