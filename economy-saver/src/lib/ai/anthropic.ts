import { createAnthropic } from "@ai-sdk/anthropic";
import { generate, sdkFetch } from "./sdk";
import { ModelError, type ModelRequest, type Reply } from "./types";

type Block = { type: string; text?: string; id?: string; name?: string; input?: unknown };
type Wire = { content: Block[]; stop_reason?: string; usage: { input_tokens: number; output_tokens: number } };

const STOPS: Record<string, Reply["stop"]> = {
  end_turn: "end", stop_sequence: "end", tool_use: "tools", max_tokens: "length", refusal: "refusal", pause_turn: "pause",
};

export async function callAnthropic(request: ModelRequest): Promise<Reply> {
  const { connection: c } = request;
  if (!c.key) throw new ModelError("The AI key is missing.");
  const provider = createAnthropic({
    authToken: c.key,
    headers: { "x-stainless-timeout": String(request.timeoutMs / 1000) },
    baseURL: c.baseUrl.replace(/\/$/, "") + "/v1",
    fetch: sdkFetch(request, encoded => {
      const body = JSON.parse(encoded) as {
        system: unknown; messages: { role: string; content: Block[] | string }[];
        tools?: Record<string, unknown>[]; output_config?: Record<string, unknown>;
      };
      body.system = request.system;
      for (const message of body.messages) {
        if (message.role === "assistant" && Array.isArray(message.content)) {
          message.content = message.content.flatMap(block => {
            const turn = request.turns[Number(block.text)];
            return turn?.role === "assistant" ? turn.raw as Block[] : [];
          });
        } else if (Array.isArray(message.content) && message.content.length === 1 && message.content[0].type === "text") {
          message.content = message.content[0].text ?? "";
        }
      }
      for (const tool of body.tools ?? []) tool.strict = true;
      if (!request.forceTool) body.output_config = { ...body.output_config, effort: "low" };
      return JSON.stringify(body);
    }),
  });
  const generated = await generate(provider(request.model), request);
  const response = generated.response?.body as Wire;
  return {
    text: response.content.flatMap(block => block.type === "text" ? [block.text] : []).join("\n"),
    calls: response.content.flatMap(block => block.type === "tool_use" ? [{ id: block.id!, name: block.name!, input: block.input }] : []),
    stop: STOPS[response.stop_reason ?? ""] ?? "other",
    raw: response.content, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens,
  };
}
