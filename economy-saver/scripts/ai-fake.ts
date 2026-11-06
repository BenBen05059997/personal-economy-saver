// A fake model transport for the tests that exercise the connection check (lib/ai/check.ts): it answers the check's three
// cases for either protocol, in the way a good model would or in one of the ways a bad one fails. No network.
export type FakeMode = "good" | "notools" | "injected" | "chatty" | "down";

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
  const seen: { url: string; model: string }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const body = await request.clone().json() as { model: string; messages: { role: string; content: unknown }[] };
    seen.push({ url: request.url, model: body.model });
    if (mode === "down") return new Response("no", { status: 401 });
    const anthropic = new URL(request.url).pathname.endsWith("/messages");
    const first = body.messages.find(m => m.role === "user")!.content;
    const question = typeof first === "string" ? first : "";
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
