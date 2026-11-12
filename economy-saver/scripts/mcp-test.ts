// A finite terminal demo over the real MCP HTTP protocol on loopback.
// Ephemeral test token and routing key stay in memory, with no output or HTTP request logging.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { and, eq, inArray, like } from "drizzle-orm";
import { seedBen } from "@/db/seed";
import * as s from "@/db/schema";
import { MCP_TOKEN_LIMIT, issueMcpToken, listMcpTokens, revokeMcpToken } from "@/db/mcp-tokens";
import { consumeRequest } from "@/db/rate-limit";
import { mcpRequest } from "@/lib/mcp/server";
import { MODEL_RULES } from "@/lib/agent/rules";

let stage = "database setup";
const logged: Record<string, unknown>[] = [];
const realInfo = console.info;
console.info = (...args: unknown[]) => { const first = String(args[0]); if (first.startsWith('{"at":')) logged.push(JSON.parse(first)); else realInfo(...args); };
async function main() {
  process.env.MCP_TOKEN_KEY = randomBytes(32).toString("base64url");
  const pg = new PGlite({ extensions: { pg_trgm } });
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
    stage = "instructions";
    const instructions = client.getInstructions();
    assert.equal(instructions, MODEL_RULES);
    assert.match(instructions!, /about to be saved and one detail is missing or matches several[^.]*ask which one/);
    assert.ok(!/\btoday\b|JPY/i.test(instructions!), "the server cannot know the date or currency");
    stage = "list tools";
    const list = await client.listTools();
    assert.deepEqual(list.tools.map(tool => tool.name).sort(), ["add_bill", "add_bills", "add_pot", "bills_for_month", "can_i_spend", "draft_invoice", "foreign_costs", "forget", "goals", "household_snapshot", "list_clients_and_cards", "list_invoices", "list_spaces", "log_charge", "log_charges", "make_canvas", "month_by_category", "open_gaps", "options_when_short", "own_categories", "plan_for", "recall", "regular_costs", "remember", "search_history", "search_spending", "suggestions", "timeline", "to_check", "update_bank_balance", "what_if", "whats_due", "where_am_i", "who_owes_whom"]);
    assert.ok(!list.tools.some(tool => tool.name === "clarify" || tool.name === "out_of_scope"), "the Ask-only tools are never offered over MCP");
    stage = "own categories over MCP";
    const ownTool = list.tools.find(tool => tool.name === "own_categories");
    assert.ok(ownTool, "own_categories is offered");
    const ownWords = ((await client.callTool({ name: "own_categories", arguments: {} })).content as { text: string }[])[0].text;
    assert.match(ownWords, /Under Food: Coffee \(/);
    assert.match(ownWords, /Under Other: Books & films \(.*\); Gear \(/);
    const billProps = Object.keys((list.tools.find(tool => tool.name === "add_bill")!.inputSchema as { properties: Record<string, unknown> }).properties);
    assert.ok(billProps.includes("own_category") && !billProps.includes("ownCategoryId") && !billProps.includes("ownCategoryNew"), "a name, never an id or a new one");
    assert.deepEqual(list.tools.map(tool => tool.name).filter(name => /own_cat|(add|save|rename|merge|remove|delete|file)_.*categor/.test(name)), ["own_categories"], "no tool writes an own category");
    stage = "make_canvas over MCP";
    const drawn = JSON.parse(((await client.callTool({ name: "make_canvas", arguments: { recipe: JSON.stringify({ version: 1, title: "Cash", blocks: [{ type: "number", label: "Cash today", query: { q: "cash" } }] }) } })).content as { text: string }[])[0].text);
    assert.deepEqual([drawn.blocks.length, drawn.blocks[0].type, drawn.blocks[0].label], [1, "number", "Cash today"]);
    stage = "tool execution";
    const outlook = await client.callTool({ name: "where_am_i", arguments: {} });
    assert.match(JSON.stringify(outlook.content), /18,780 short/);
    const plan = JSON.parse(((await client.callTool({ name: "plan_for", arguments: { target_minor: 1_200_000, target_date: "2027-03-31" } })).content as { text: string }[])[0].text);
    assert.equal(plan.monthlyNeededMinor, 300_000);
    const goalsCall = await client.callTool({ name: "goals", arguments: {} });
    assert.ok(!goalsCall.isError);
    const goals = JSON.parse((goalsCall.content as { text: string }[])[0].text);
    assert.deepEqual(goals, { currency: "JPY", goals: [], summary: "No dated savings goals yet." });
    const owes = JSON.parse(((await client.callTool({ name: "who_owes_whom", arguments: {} })).content as { text: string }[])[0].text);
    assert.deepEqual([owes.summary, owes.transfers, owes.split], ["Only one person is in this household, so there is nothing to split.", [], false]);
    const month = (await client.callTool({ name: "month_by_category", arguments: {} })).content as { text: string }[];
    assert.match(month[0].text, /^November: ¥152,230 in total\. Business ¥32,830 of ¥152,230 this month\./);
    const regular = JSON.parse(((await client.callTool({ name: "regular_costs", arguments: {} })).content as { text: string }[])[0].text);
    assert.equal(regular.summary, "Kissa Midori café down ¥920 so far · Minato Fresh Market up ¥180 so far", "D54 through MCP, from the same function");
    const snapshotCall = await client.callTool({ name: "household_snapshot", arguments: {} });
    assert.ok(!snapshotCall.isError);
    const snapshot = JSON.parse((snapshotCall.content as { text: string }[])[0].text);
    assert.equal(snapshot.version, 4);
    assert.equal(snapshot.household.id, hid);
    assert.equal(snapshot.clients.length, 3);
    assert.ok(!("events" in snapshot));
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
    assert.deepEqual([saved.madeBy, saved.askId], ["mcp", null]);
    console.log("The terminal saved one $18.52 draft after two requests. Approval stays in the app.");
    stage = "bulk tools";
    const card = (await db.select().from(s.cards).where(eq(s.cards.householdId, hid)).limit(1))[0];
    const billItem = (i: number) => ({ id: crypto.randomUUID(), biller: `MCP bulk bill ${i}`, amount: "900", due: "2026-11-27", category: null, memberId: null, repeat: null, next_amount: null, next_amount_from: null, cancel_by: null, business_bp: null, shared: null, paidBy: null });
    const chargeItem = (i: number) => ({ id: crypto.randomUUID(), cardId: card.id, merchant: `MCP bulk shop ${i}`, amount: "300", date: "2026-11-03", category: null, business_bp: null, shared: false });
    const billItems = [billItem(0), billItem(1)], chargeItems = [chargeItem(0), chargeItem(1), chargeItem(2)];
    const addedBills = await client.callTool({ name: "add_bills", arguments: { items: billItems } });
    const loggedCharges = await client.callTool({ name: "log_charges", arguments: { items: chargeItems } });
    assert.ok(!addedBills.isError && !loggedCharges.isError);
    const bulkBills = await db.select().from(s.bills).where(and(eq(s.bills.householdId, hid), inArray(s.bills.id, billItems.map(b => b.id))));
    const bulkCharges = await db.select().from(s.charges).where(and(eq(s.charges.householdId, hid), inArray(s.charges.id, chargeItems.map(c => c.id))));
    assert.equal(bulkBills.length, 2);
    assert.equal(bulkCharges.length, 3);
    assert.ok([...bulkBills, ...bulkCharges].every(r => r.status === "pending" && r.madeBy === "mcp" && r.askId === null));
    const refused = await client.callTool({ name: "add_bills", arguments: { items: [billItem(2), { ...billItem(3), due: "2099-01-01" }] } });
    assert.equal(refused.isError, true);
    assert.equal((await db.select().from(s.bills).where(and(eq(s.bills.householdId, hid), like(s.bills.biller, "MCP bulk bill %")))).length, 2, "a bad item saves none");
    assert.equal((await client.callTool({ name: "add_bills", arguments: { items: [] } })).isError, true);
    const mcpLines = logged.filter(l => l.at === "mcp");
    assert.ok(mcpLines.length >= 4);
    const lastLine = mcpLines.at(-1)!;
    assert.deepEqual(Object.keys(lastLine).sort(), ["at", "householdId", "ms", "outcome", "stop", "tools", "turns"]);
    assert.deepEqual([lastLine.householdId, lastLine.outcome, (lastLine.tools as { name: string; ok: boolean }[]).map(t => [t.name, t.ok])], [hid, "error", [["add_bills", false]]]);
    assert.ok(!JSON.stringify(mcpLines).includes("MCP bulk"), "no tool argument or result in the log");
    const denied = await fetch(endpoint, { method: "POST", headers: { Origin: "https://wrong.example", Authorization: "Bearer " + token } });
    assert.equal(denied.status, 403);
    assert.equal(await revokeMcpToken(db, hid, info.id), true);
    assert.equal((await fetch(endpoint, { method: "POST", headers: { Authorization: "Bearer " + token } })).status, 401);
    const { token: readOnly } = await issueMcpToken(db, other, { name: "Read only", scopes: ["read"] });
    const readClient = new Client({ name: "read-test", version: "1.0.0" });
    try {
      await readClient.connect(new StreamableHTTPClientTransport(endpoint, { requestInit: { headers: { Authorization: "Bearer " + readOnly } } }));
      assert.ok(!(await readClient.listTools()).tools.some(t => t.name === "draft_invoice" || t.name === "add_bills" || t.name === "log_charges" || t.name === "update_bank_balance" || t.name === "add_pot"));
      assert.ok((await readClient.listTools()).tools.some(t => t.name === "own_categories"), "own_categories is a read tool");
    } finally { await readClient.close(); }

    stage = "token cap";
    const capHousehold = await seedBen(db, { isDemo: true });
    for (let i = 0; i < MCP_TOKEN_LIMIT; i++) await issueMcpToken(db, capHousehold, { name: `Cap ${i}`, scopes: ["read"] });
    await assert.rejects(issueMcpToken(db, capHousehold, { name: "One too many", scopes: ["read"] }), /already has 10 live access tokens/);
    const [capped] = await listMcpTokens(db, capHousehold);
    assert.equal(await revokeMcpToken(db, capHousehold, capped.id), true);
    await issueMcpToken(db, capHousehold, { name: "After a revoke", scopes: ["read"] });

    stage = "rate limits";
    const results = await Promise.all([consumeRequest(db, hid, "ask", 1), consumeRequest(db, hid, "ask", 1)]);
    assert.equal(results.filter(Boolean).length, 1);
    console.log("Scope, revocation, Origin and rate limits passed.");
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
