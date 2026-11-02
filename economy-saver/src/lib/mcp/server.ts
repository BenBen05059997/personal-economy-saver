import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { householdDate } from "@/db/account";
import { loadMoneyState, type Db } from "@/db/household";
import { draftInput, saveInvoiceDraft } from "@/db/invoice-draft";
import { authenticateMcpToken } from "@/db/mcp-tokens";
import { consumeRequest } from "@/db/rate-limit";
import { dueAnswer, spendAnswer, statusAnswer } from "@/lib/money/ask";

const result = (text: string) => ({ content: [{ type: "text" as const, text }] });
async function answer(read: () => Promise<string>) {
  try { return result(await read()); }
  catch { return { ...result("Could not complete this request for the household."), isError: true }; }
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
  const server = new McpServer({ name: "personal-economy-saver", version: "1.0.0" });
  const state = async () => loadMoneyState(db, hid, await householdDate(db, hid));
  if (scopes.includes("read")) {
    server.registerTool("where_am_i", { description: "Read the household’s 30-day outlook.", inputSchema: {} },
      () => answer(async () => statusAnswer(await state())));
    server.registerTool("whats_due", { description: "Read the next confirmed bill or card statement.", inputSchema: {} },
      () => answer(async () => dueAnswer(await state())));
    server.registerTool("can_i_spend", { description: "Check a purchase in home-currency minor units: yen or USD cents.",
      inputSchema: { amount_minor: z.number().int().positive().safe(), card_id: z.string().uuid().optional() } },
      params => answer(async () => {
        const data = await state();
        if (params.card_id && !data.cards.some(c => c.id === params.card_id)) throw new Error("Unknown card");
        return spendAnswer(data, params.amount_minor, params.card_id);
      }));
    server.registerTool("list_clients_and_cards", { description: "List client and card names and IDs for this household.", inputSchema: {} },
      () => answer(async () => {
        const data = await state();
        return JSON.stringify({ clients: data.clients.map(c => ({ id: c.id, name: c.name })), cards: data.cards.map(c => ({ id: c.id, label: c.label })) });
      }));
  }
  if (scopes.includes("draft")) {
    server.registerTool("draft_invoice", { description: "Save a local USD invoice draft for review. Reuse the same draft UUID when retrying.",
      inputSchema: draftInput.shape },
      params => answer(async () => {
        const id = await saveInvoiceDraft(db, hid, params);
        return `Review the draft at ${new URL("/invoices/" + id, endpoint).href}.`;
      }));
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } finally { await server.close(); }
}
