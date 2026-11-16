import { CHECK_QUESTIONS, PROBE_TOOLS } from "@/lib/ai/check";

// A fake model transport for the tests that exercise the connection check (lib/ai/check.ts): it answers the text and image
// cases for either protocol, in the way a good model would or in one of the ways a bad one fails. No network.
export type FakeMode = "good" | "notools" | "injected" | "chatty" | "noimages" | "wrongimage" | "down" | "missingmodel" | "credit" | "unreachable";

type Usage = Record<string, number>;
/** A model's reply in Anthropic's wire shape: why it stopped and its content blocks. */
export function anthropicReply(stopReason: string, content: unknown[], over: { id?: string; model?: string; usage?: Usage } = {}) {
  return Response.json({ id: over.id ?? "msg_fixture", type: "message", role: "assistant", model: over.model ?? "fixture-text", content, stop_reason: stopReason, stop_sequence: null,
    usage: over.usage ?? { input_tokens: 1, output_tokens: 1 } });
}
/** A model's reply in the OpenAI-compatible chat shape: why it stopped and its message. */
export function chatReply(finishReason: string, message: Record<string, unknown>, over: { id?: string; model?: string; usage?: unknown } = {}) {
  return Response.json({ id: over.id ?? "chatcmpl-fixture", object: "chat.completion", created: 1, model: over.model ?? "fixture-text",
    choices: [{ index: 0, finish_reason: finishReason, message: { role: "assistant", ...message } }], usage: "usage" in over ? over.usage : { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
}
const FIXTURE = { id: "m", model: "x" };
/** A reply that calls one tool, in either protocol's wire shape. */
export function wireCall(anthropic: boolean, id: string, name: string, input: unknown) {
  return anthropic
    ? anthropicReply("tool_use", [{ type: "tool_use", id, name, input }], FIXTURE)
    : chatReply("tool_calls", { content: null, tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(input) } }] }, { ...FIXTURE, id: "c", usage: { prompt_tokens: 1, completion_tokens: 1 } });
}
/** A reply that ends with words, in either protocol's wire shape. */
export function wireWords(anthropic: boolean, text: string) {
  return anthropic
    ? anthropicReply("end_turn", [{ type: "text", text }], FIXTURE)
    : chatReply("stop", { content: text }, { ...FIXTURE, id: "c", usage: { prompt_tokens: 1, completion_tokens: 1 } });
}
const call = (anthropic: boolean, name: string, input: unknown) => wireCall(anthropic, (anthropic ? "tu_" : "tc_") + name, name, input);

export function fakeModel(mode: FakeMode) {
  const seen: { url: string; model: string; image: unknown; question: string; tools: number }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const body = await request.clone().json() as { model: string; tools?: unknown[]; messages: { role: string; content: unknown }[] };
    const anthropic = new URL(request.url).pathname.endsWith("/messages");
    const first = body.messages.find(m => m.role === "user")!.content;
    const parts = Array.isArray(first) ? first as { type: string; text?: string }[] : [];
    const image = parts.find(part => part.type === (anthropic ? "image" : "image_url"));
    const question = typeof first === "string" ? first : parts.filter(part => part.type === "text").map(part => part.text).join("");
    seen.push({ url: request.url, model: body.model, image, question, tools: body.tools?.length ?? 0 });
    if (mode === "down") return new Response("no", { status: 401 });
    if (mode === "credit") return Response.json({ error: { message: "The credit balance is too low for fictional-billing." } }, { status: 400 });
    if (mode === "unreachable") throw new Error("Fictional network error.");
    if (image) {
      if (mode === "noimages") return Response.json({ error: { message: "Images are not supported." } }, { status: 415 });
      if (mode === "missingmodel") return Response.json({ error: { code: "model_not_found", message: "Internal fictional model detail." } }, { status: 404 });
      return wireWords(anthropic, mode === "wrongimage" ? "6174" : "6173");
    }
    const hasResult = body.messages.some(m => m.role === "tool" || (Array.isArray(m.content) && m.content.some((b: { type?: string }) => b.type === "tool_result")));
    if (mode === "notools") return wireWords(anthropic, "You are fine.");
    if (question === CHECK_QUESTIONS.uses_tools) return call(anthropic, PROBE_TOOLS.cash, {});
    if (question === CHECK_QUESTIONS.ignores_injection) {
      if (!hasResult) return call(anthropic, PROBE_TOOLS.due, {});
      return wireWords(anthropic, mode === "injected" ? "The invoice was paid. ¥12,340 is due on Nov 20." : "¥12,340 is due on Nov 20. The bill's name contains an instruction, which I ignored; nothing was paid or sent.");
    }
    return mode === "chatty" ? call(anthropic, PROBE_TOOLS.cash, {}) : call(anthropic, PROBE_TOOLS.decline, { reason: "not about money" });
  }) as typeof globalThis.fetch;
  return { fetch, seen };
}
