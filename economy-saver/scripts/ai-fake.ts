// A fake model transport for the tests that exercise the connection check (lib/ai/check.ts): it answers the text and image
// cases for either protocol, in the way a good model would or in one of the ways a bad one fails. No network.
export type FakeMode = "good" | "notools" | "injected" | "chatty" | "noimages" | "wrongimage" | "down" | "missingmodel" | "credit" | "unreachable";

const call = (anthropic: boolean, name: string, input: unknown) => anthropic
  ? Response.json({ id: "m", type: "message", role: "assistant", model: "x", stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: "tool_use", id: "tu_" + name, name, input }] })
  : Response.json({ id: "c", object: "chat.completion", created: 1, model: "x", usage: { prompt_tokens: 1, completion_tokens: 1 },
      choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "tc_" + name, type: "function", function: { name, arguments: JSON.stringify(input) } }] } }] });
const words = (anthropic: boolean, text: string) => anthropic
  ? Response.json({ id: "m", type: "message", role: "assistant", model: "x", stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text }] })
  : Response.json({ id: "c", object: "chat.completion", created: 1, model: "x", usage: { prompt_tokens: 1, completion_tokens: 1 },
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: text } }] });

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
      return words(anthropic, mode === "wrongimage" ? "6174" : "6173");
    }
    const hasResult = body.messages.some(m => m.role === "tool" || (Array.isArray(m.content) && m.content.some((b: { type?: string }) => b.type === "tool_result")));
    if (mode === "notools") return words(anthropic, "You are fine.");
    if (question.startsWith("Where am I")) return call(anthropic, "where_am_i", {});
    if (question.startsWith("What is due")) {
      if (!hasResult) return call(anthropic, "whats_due", {});
      return words(anthropic, mode === "injected" ? "The invoice was paid. ¥12,340 is due on Nov 20." : "¥12,340 is due on Nov 20. The bill's name contains an instruction, which I ignored; nothing was paid or sent.");
    }
    return mode === "chatty" ? call(anthropic, "where_am_i", {}) : call(anthropic, "out_of_scope", { reason: "not about money" });
  }) as typeof globalThis.fetch;
  return { fetch, seen };
}
