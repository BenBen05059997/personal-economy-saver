import { tokenParamFor } from "./providers";
import { ModelError, type ModelRequest, type Part, type Reply, type Turn } from "./types";

// OpenAI-compatible Chat Completions over plain fetch (no second SDK: the Worker is near its size limit, D56).
const MAX_RESPONSE_BYTES = 1024 * 1024;

type Message = Record<string, unknown>;

function content(parts: Part[]): string | Message[] {
  if (parts.length === 1 && parts[0].type === "text") return parts[0].text;
  return parts.map(part =>
    part.type === "text" ? { type: "text", text: part.text }
    : part.type === "image" ? { type: "image_url", image_url: { url: `data:${part.mime};base64,${part.base64}` } }
    : { type: "file", file: { filename: "document.pdf", file_data: `data:application/pdf;base64,${part.base64}` } });
}

function messages(system: string, turns: Turn[]): Message[] {
  const out: Message[] = [{ role: "system", content: system }];
  for (const turn of turns) {
    if (turn.role === "user") out.push({ role: "user", content: content(turn.parts) });
    else if (turn.role === "assistant") out.push(turn.raw as Message);
    else for (const r of turn.results) out.push({ role: "tool", tool_call_id: r.id, content: r.isError ? "Error: " + r.content : r.content });
  }
  return out;
}

const STOPS: Record<string, Reply["stop"]> = { stop: "end", tool_calls: "tools", length: "length", content_filter: "refusal" };

/** "tool_calls" with no calls is not a tool turn: it is an answer when there is text and an unexpected stop when there is none. */
function stopOf(finish: string | undefined, hasCalls: boolean, hasText: boolean): Reply["stop"] {
  if (hasCalls) return "tools";
  if (finish === "tool_calls") return hasText ? "end" : "other";
  return STOPS[finish ?? ""] ?? "other";
}

async function readLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new ModelError("The AI service sent too large a reply."); }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function callOpenAI(request: ModelRequest): Promise<Reply> {
  const { connection: c } = request;
  const body = {
    model: request.model, messages: messages(request.system, request.turns), [tokenParamFor(c.baseUrl)]: request.maxTokens,
    ...(request.tools && { tools: request.tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.schema } })) }),
    ...(request.tools && request.forceTool && { tool_choice: { type: "function", function: { name: request.forceTool } } }),
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  let status: number, text: string;
  try {
    const response = await (request.fetch ?? globalThis.fetch)(c.baseUrl + "/chat/completions", {
      method: "POST", redirect: "error", signal: controller.signal, body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...(c.key && { authorization: "Bearer " + c.key }) },
    });
    status = response.status;
    text = await readLimited(response);
  } catch (error) {
    if (error instanceof ModelError) throw error;
    if (controller.signal.aborted) throw new ModelError("The AI service took too long.", undefined, true);
    throw new ModelError("Couldn't reach the AI service.");
  } finally { clearTimeout(timer); }
  if (status < 200 || status >= 300) throw new ModelError("The AI service refused the request.", status);

  type Wire = { choices?: { message?: Message; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  let wire: Wire;
  try { wire = JSON.parse(text); } catch { throw new ModelError("The AI service sent a reply the app could not read."); }
  const choice = wire.choices?.[0];
  const message = choice?.message;
  if (!message) throw new ModelError("The AI service sent a reply the app could not read.");
  const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls as { id?: string; function?: { name?: string; arguments?: string } }[] : [];
  const calls = rawCalls.map(call => {
    let input: unknown = null; // unparseable arguments: the caller's schema check rejects null with paths only
    try { input = JSON.parse(call.function?.arguments ?? ""); } catch { /* stays null */ }
    return { id: call.id || "call_" + crypto.randomUUID(), name: String(call.function?.name ?? ""), input };
  });
  return {
    text: typeof message.content === "string" ? message.content : "",
    calls, stop: stopOf(choice.finish_reason, calls.length > 0, typeof message.content === "string" && message.content.trim() !== ""),
    // Sent back as the assistant turn; ids the server left out are filled so the tool results can name them.
    raw: calls.length ? { ...message, tool_calls: rawCalls.map((call, i) => ({ ...call, id: calls[i].id })) } : message,
    inputTokens: wire.usage?.prompt_tokens ?? 0, outputTokens: wire.usage?.completion_tokens ?? 0,
  };
}
