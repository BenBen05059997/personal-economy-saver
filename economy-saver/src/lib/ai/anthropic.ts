import { createAnthropic } from "@ai-sdk/anthropic";
import { generate, sdkFetch } from "./sdk";
import { ModelError, type ModelRequest, type Reply } from "./types";

type Block = { type: string; text?: string; cache_control?: unknown; id?: string; name?: string; input?: unknown };
type Wire = { content: Block[]; stop_reason?: string; usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } };

const STOPS: Record<string, Reply["stop"]> = {
  end_turn: "end", stop_sequence: "end", tool_use: "tools", max_tokens: "length", refusal: "refusal", pause_turn: "pause",
};

export async function callAnthropic(request: ModelRequest): Promise<Reply> {
  const { connection: c } = request;
  if (!c.key) throw new ModelError("The AI key is missing.");
  const provider = createAnthropic({
    apiKey: c.key,
    headers: { "x-stainless-timeout": String(request.timeoutMs / 1000) },
    baseURL: c.baseUrl.replace(/\/$/, "") + "/v1",
    fetch: sdkFetch(request, encoded => {
      const body = JSON.parse(encoded) as {
        system: unknown; messages: { role: string; content: Block[] | string }[];
        tools?: Record<string, unknown>[]; output_config?: Record<string, unknown>;
      };
      // tool_choice is auto here (forced choices are a 400 on current models), so the prompt asks for the one call.
      const forced = request.forceTool ? `Answer only by calling the ${request.forceTool} tool once.` : "";
      const cache = { type: "ephemeral", ttl: "1h" };
      if (request.systemStable !== undefined) {
        if (!request.system.startsWith(request.systemStable)) throw new ModelError("The system text does not start with its stable part.");
        // Tools, then the stable system block, then the conversation: each mark caches everything before it.
        const varying = [request.system.slice(request.systemStable.length).trim(), forced].filter(Boolean).join("\n\n");
        body.system = [{ type: "text", text: request.systemStable, cache_control: cache }, ...varying ? [{ type: "text", text: varying }] : []];
      } else {
        body.system = forced ? `${request.system}\n\n${forced}` : request.system;
      }
      const caching = request.systemStable !== undefined; // a one-shot call (the reader, voice fill) has no next turn to read it
      if (caching && body.tools?.length) body.tools[body.tools.length - 1].cache_control = cache;
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
      // The last block of the last message, so the next turn of the same question reads this one.
      const last = body.messages[body.messages.length - 1];
      if (caching && last) {
        if (typeof last.content === "string") last.content = [{ type: "text", text: last.content }];
        last.content[last.content.length - 1].cache_control = cache;
      }
      for (const tool of body.tools ?? []) if (tool.name === request.forceTool) tool.strict = true; else delete tool.strict;
      // Thinking counts toward max_tokens; low effort keeps short replies (voice fill, Ask) inside theirs; the reader asks for medium.
      body.output_config = { ...body.output_config, effort: request.effort ?? "low" };
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
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0, cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
  };
}
