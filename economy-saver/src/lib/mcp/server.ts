import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { householdDate } from "@/db/account";
import { loadMoneyState, type Db } from "@/db/household";
import { InputError } from "@/db/input-error";
import { authenticateMcpToken } from "@/db/mcp-tokens";
import { consumeRequest } from "@/db/rate-limit";
import { logCall } from "@/lib/agent/log";
import { MODEL_RULES } from "@/lib/agent/rules";
import { tools } from "@/lib/agent/tools";

const result = (text: string) => ({ content: [{ type: "text" as const, text }] });
/** Runs one tool call and writes its one content-free log line (D50): the tool's name, whether it worked and how long it took. */
async function answer(householdId: string, name: string, read: () => Promise<string>) {
  const started = Date.now();
  const line = (ok: boolean) => {
    const ms = Date.now() - started;
    logCall({ at: "mcp", householdId, stop: "tool_call", turns: 1, tools: [{ name, ok, ms }], outcome: ok ? "answer" : "error", ms });
  };
  try { const text = await read(); line(true); return result(text); }
  catch (failure) {
    line(false);
    return { ...result(failure instanceof InputError ? failure.message : "Could not complete this request for the household."), isError: true };
  }
}

// A separate stateless SDK server is constructed per authenticated request. No cookie, global household or merchant toolkit.
export async function mcpRequest(request: Request, connection: () => Db) {
  const origin = request.headers.get("origin");
  const endpoint = new URL(request.url);
  const host = request.headers.get("host");
  if (host) endpoint.host = host;
  if (origin !== null && origin !== endpoint.origin) return new Response("Origin not allowed", { status: 403 });
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  const header = request.headers.get("authorization");
  const token = header && /^Bearer ([A-Za-z0-9_.-]+)$/i.exec(header)?.[1];
  const unauthorized = () => new Response("Valid MCP bearer token required", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  if (!token) return unauthorized();
  const db = connection();
  const caller = await authenticateMcpToken(db, token);
  if (!caller) return unauthorized();
  if (!await consumeRequest(db, caller.householdId, "mcp")) return new Response("Request limit reached", { status: 429, headers: { "Retry-After": "60" } });
  const { householdId: hid, scopes } = caller;
  const server = new McpServer({ name: "personal-economy-saver", version: "1.0.0" }, { instructions: MODEL_RULES });
  const state = async () => loadMoneyState(db, hid, await householdDate(db, hid));
  const ctx = { madeBy: "mcp" as const, db, householdId: hid, state, appUrl: endpoint };
  for (const tool of tools) {
    // Ask-only tools (clarify, out_of_scope) end an Ask turn and mean nothing to another client: never offered, whatever the token holds.
    if (tool.scope === "ask" || !scopes.includes(tool.scope)) continue;
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.input.shape },
      params => answer(hid, tool.name, () => tool.run(ctx, params as never)));
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } finally { await server.close(); }
}
