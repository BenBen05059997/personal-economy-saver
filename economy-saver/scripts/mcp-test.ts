// A finite terminal demo over the real MCP HTTP protocol on loopback.
// Ephemeral test token and routing key stay in memory, with no output or HTTP request logging.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { and, eq } from "drizzle-orm";
import { seedBen } from "@/db/seed";
import * as s from "@/db/schema";
import { issueMcpToken, listMcpTokens, revokeMcpToken } from "@/db/mcp-tokens";
import { consumeRequest } from "@/db/rate-limit";
import { mcpRequest } from "@/lib/mcp/server";

let stage = "database setup";
async function main() {
  process.env.MCP_TOKEN_KEY = randomBytes(32).toString("base64url");
  const pg = new PGlite();
  const db = drizzle(pg, { schema: s });
  const http = createServer(async (incoming, outgoing) => {
    try {
      const bytes: Buffer[] = [];
      for await (const chunk of incoming) bytes.push(Buffer.from(chunk));
      const headers = new Headers();
      for (const [key, val] of Object.entries(incoming.headers)) {
        if (typeof val === "string") headers.set(key, val);
      }
      const request = new Request("http://" + incoming.headers.host + incoming.url, {
        method: incoming.method, headers, ...(bytes.length && { body: Buffer.concat(bytes) }),
      });
      const result = await mcpRequest(request, () => db);
      outgoing.writeHead(result.status, Object.fromEntries(result.headers));
      outgoing.end(Buffer.from(await result.arrayBuffer()));
    } catch { outgoing.writeHead(500); outgoing.end(); }
  });
  const client = new Client({ name: "terminal-demo", version: "1.0.0" });
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    const hid = await seedBen(db, { isDemo: true });
    const other = await seedBen(db, { isDemo: true });
    http.listen(0, "127.0.0.1");
    await once(http, "listening");
    const address = http.address();
    if (!address || typeof address === "string") throw new Error("Loopback unavailable");
    const endpoint = new URL(`http://127.0.0.1:${address.port}/api/mcp`);
    stage = "token issuance";
    const { token, info } = await issueMcpToken(db, hid, { name: "Terminal demo", scopes: ["read", "draft"] });
    assert.ok(!token.includes(hid));
    assert.equal((await listMcpTokens(db, other)).length, 0);
    const transport = new StreamableHTTPClientTransport(endpoint, { requestInit: { headers: { Authorization: "Bearer " + token } } });
    stage = "MCP handshake";
    await client.connect(transport);
    stage = "list tools";
    const list = await client.listTools();
    assert.deepEqual(list.tools.map(tool => tool.name).sort(), ["add_bill", "can_i_spend", "draft_invoice", "list_clients_and_cards", "list_invoices", "log_charge", "options_when_short", "timeline", "whats_due", "where_am_i"]);
    stage = "tool execution";
    const outlook = await client.callTool({ name: "where_am_i", arguments: {} });
    assert.match(JSON.stringify(outlook.content), /18,780 short/);
    console.log("MCP handshake and tools/list succeeded. Ben’s outlook includes a ¥18,780 shortfall.");
    const spend = await client.callTool({ name: "can_i_spend", arguments: { amount_minor: 4000 } });
    assert.match(JSON.stringify(spend.content), /Hold off on cash/);
    console.log("Can I afford ¥4,000? " + (spend.content as { text: string }[])[0].text);
    assert.ok(!((await client.callTool({ name: "whats_due", arguments: {} })).isError));
    const [ownClient] = await db.select().from(s.clients).where(eq(s.clients.householdId, hid)).limit(1);
    const draft = { id: crypto.randomUUID(), clientId: ownClient.id, item: "Poster layout", amount: "18.52", note: "" };
    assert.ok(!(await client.callTool({ name: "draft_invoice", arguments: draft })).isError);
    assert.ok(!(await client.callTool({ name: "draft_invoice", arguments: draft })).isError);
    const [saved] = await db.select().from(s.invoices).where(and(eq(s.invoices.householdId, hid), eq(s.invoices.id, draft.id)));
    assert.equal(saved.amountMinor, 1852);
    assert.equal(saved.status, "draft");
    console.log("The terminal saved one $18.52 draft after two requests. Approval stays in the app.");
    const denied = await fetch(endpoint, { method: "POST", headers: { Origin: "https://wrong.example", Authorization: "Bearer " + token } });
    assert.equal(denied.status, 403);
    assert.equal(await revokeMcpToken(db, other, info.id), false);
    assert.equal(await revokeMcpToken(db, hid, info.id), true);
    assert.equal((await fetch(endpoint, { method: "POST", headers: { Authorization: "Bearer " + token } })).status, 401);
    const { token: readOnly } = await issueMcpToken(db, other, { name: "Read only", scopes: ["read"] });
    const readClient = new Client({ name: "read-test", version: "1.0.0" });
    try {
      await readClient.connect(new StreamableHTTPClientTransport(endpoint, { requestInit: { headers: { Authorization: "Bearer " + readOnly } } }));
      assert.ok(!(await readClient.listTools()).tools.some(t => t.name === "draft_invoice"));
    } finally { await readClient.close(); }

    stage = "rate limits";
    const results = await Promise.all([consumeRequest(db, hid, "ask", 1), consumeRequest(db, hid, "ask", 1)]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(await consumeRequest(db, other, "ask", 1), true);
    console.log("Scope, revocation, Origin and per-household rate limits passed.");
  } finally {
    await client.close();
    if (http.listening) await new Promise<void>(resolve => http.close(() => resolve()));
    await pg.close();
    delete process.env.MCP_TOKEN_KEY;
  }
}

main().catch(() => {
  console.error(`MCP terminal check failed at ${stage}.`);
  process.exitCode = 1;
});
