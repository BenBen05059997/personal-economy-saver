// The in-app agent over a fake Messages API transport. PGlite only; no network, no credentials.
// The send-capable PayPal runner is kept out of the agent by lint (no-restricted-imports in eslint.config.mjs)
// and by the source scan at the end of this script.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { aiKey, AiKeyError } from "@/db/ai-key";
import { householdDate } from "@/db/account";
import { loadMoneyState } from "@/db/household";
import { seedBen } from "@/db/seed";
import { AgentError, runAgent } from "@/lib/agent/run";
import { toolInputSchema, tools } from "@/lib/agent/tools";
import { dueAnswer } from "@/lib/money/ask";

type Block = Record<string, unknown>;
const text = (value: string): Block => ({ type: "text", text: value });
const toolUse = (id: string, name: string, input: unknown): Block => ({ type: "tool_use", id, name, input });
const reply = (stop_reason: string, content: Block[]) => Response.json({
  id: "msg_fixture", type: "message", role: "assistant", model: "fixture-text", content, stop_reason, stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
});

/** A scripted transport: each request gets the next response; every request body is recorded. */
function transport(script: ((bodies: Body[]) => Response)[] | ((bodies: Body[]) => Response)) {
  const bodies: Body[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    assert.equal(new URL(request.url).host, "api.anthropic.com");
    assert.equal(new URL(request.url).pathname, "/v1/messages");
    assert.equal(request.headers.get("authorization"), "Bearer " + KEY);
    bodies.push(await request.json());
    const next = Array.isArray(script) ? script[bodies.length - 1] : script;
    assert.ok(next, "unexpected extra model call");
    return next(bodies);
  }) as typeof globalThis.fetch;
  return { fetch, bodies };
}
type Body = { model: string; max_tokens: number; system: string; tool_choice: unknown; output_config: unknown; thinking?: unknown;
  temperature?: unknown; tools: { name: string; strict: boolean; input_schema: Record<string, unknown> }[];
  messages: { role: string; content: string | Block[] }[] };
const toolResults = (body: Body) => (body.messages.at(-1)!.content as Block[]).filter(b => b.type === "tool_result") as
  { tool_use_id: string; content: string; is_error?: boolean }[];

const KEY = "sk-ant-fictional-" + "a".repeat(40);
const APP = new URL("http://127.0.0.1:3123");

async function main() {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  const saved = { key: process.env.ANTHROPIC_API_KEY, limit: process.env.ANTHROPIC_DAILY_READ_LIMIT, model: process.env.ANTHROPIC_TEXT_MODEL };
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) { await run(); passed++; console.log(`✓ ${name}`); }
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    process.env.ANTHROPIC_API_KEY = KEY;
    process.env.ANTHROPIC_DAILY_READ_LIMIT = "50";
    process.env.ANTHROPIC_TEXT_MODEL = "fixture-text";
    const a = await seedBen(db, { isDemo: true }), b = await seedBen(db, { isDemo: true });
    await db.update(schema.clients).set({ name: "ZZ Secret Client" }).where(eq(schema.clients.householdId, b));
    const stateOf = async (hid: string) => loadMoneyState(db, hid, await householdDate(db, hid));
    const aState = await stateOf(a), bState = await stateOf(b);
    const reads = async (hid: string) => (await db.select().from(schema.households).where(eq(schema.households.id, hid)))[0].aiReadsToday;
    const ask = (hid: string, question: string, fetch: typeof globalThis.fetch, extra: { now?: () => number; source?: "voice" | "manual" } = {}) =>
      runAgent({ db, householdId: hid, question, askId: crypto.randomUUID(), appUrl: APP, key: () => aiKey(db, hid), fetch, ...extra });

    await check("a question runs a tool, feeds the engine's own answer back and reserves one allowance unit per model call", async () => {
      const { fetch, bodies } = transport([
        () => reply("tool_use", [text("Checking."), toolUse("toolu_1", "whats_due", {})]),
        () => reply("end_turn", [text("Rent is due soon and covered.")]),
      ]);
      const before = await reads(a);
      const result = await ask(a, "What's due?", fetch);
      assert.deepEqual(result, { answer: "Rent is due soon and covered.", links: [], pending: false });
      assert.equal(await reads(a), before + 2);
      assert.equal(bodies.length, 2);
      const [first, second] = bodies;
      assert.equal(first.model, "fixture-text");
      assert.equal(first.max_tokens, 16000);
      assert.deepEqual(first.tool_choice, { type: "auto" });
      assert.deepEqual(first.output_config, { effort: "low" });
      assert.ok(!("thinking" in first) && !("temperature" in first));
      assert.ok(first.system.includes(aState.today) && first.system.includes("JPY"));
      assert.deepEqual(first.tools.map(t => t.name).sort(), tools.map(t => t.name).sort());
      assert.ok(first.tools.every(t => t.strict === true));
      assert.deepEqual(first.messages, [{ role: "user", content: "What's due?" }]);
      assert.equal(second.messages.length, 3);
      assert.equal(second.messages[1].role, "assistant");
      assert.deepEqual(second.messages[1].content, [text("Checking."), toolUse("toolu_1", "whats_due", {})]);
      const [result1] = toolResults(second);
      assert.equal(result1.tool_use_id, "toolu_1");
      assert.equal(result1.content, dueAnswer(aState));
      assert.ok(!result1.is_error);
    });

    await check("tool schemas are strict: every property required, nullable instead of optional, no extra properties", async () => {
      for (const tool of tools) {
        const schemaOut = toolInputSchema(tool) as { type: string; properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };
        assert.equal(schemaOut.type, "object");
        assert.equal(schemaOut.additionalProperties, false);
        assert.deepEqual([...schemaOut.required].sort(), Object.keys(schemaOut.properties).sort());
        assert.ok(!JSON.stringify(schemaOut).includes('"nullable"'));
      }
      const spend = toolInputSchema(tools.find(t => t.name === "can_i_spend")!) as { properties: { card_id: { anyOf: { type: string }[] } } };
      assert.ok(spend.properties.card_id.anyOf.some(v => v.type === "null"));
    });

    await check("tools only see the asking household: no other household's data in any tool output", async () => {
      const names = tools.filter(t => t.scope === "read").map(t => t.name);
      const calls = [...names.map((name, i) => toolUse(`r${i}`, name, name === "timeline" ? { scenario: "late" } : name === "can_i_spend" ? { amount_minor: 4000, card_id: null } : {})),
        toolUse("spend-b-card", "can_i_spend", { amount_minor: 4000, card_id: bState.cards[0].id }),
        toolUse("draft-b-client", "draft_invoice", { id: crypto.randomUUID(), clientId: bState.clients[0].id, item: "Poster", amount: "10.00", note: "" })];
      const { fetch, bodies } = transport([() => reply("tool_use", calls), () => reply("end_turn", [text("Done.")])]);
      await ask(a, "Tell me everything.", fetch);
      const results = toolResults(bodies[1]);
      assert.equal(results.length, calls.length);
      const forbidden = ["ZZ Secret", bState.clients[0].id, bState.cards[0].id, ...bState.invoices.map(i => i.id)];
      for (const r of results) for (const needle of forbidden) assert.ok(!r.content.includes(needle), "another household's data leaked");
      const byId = new Map(results.map(r => [r.tool_use_id, r]));
      assert.equal(byId.get("spend-b-card")!.is_error, true);
      assert.equal(byId.get("draft-b-client")!.is_error, true);
      for (const r of results) if (r.is_error) assert.ok(r.content.length < 60 && !/select|sql|at \//i.test(r.content));
      const [bInvoices] = [await db.select().from(schema.invoices).where(and(eq(schema.invoices.householdId, b), eq(schema.invoices.status, "draft")))];
      assert.equal(bInvoices.length, 0);
    });

    await check("timeline, invoices and the options ladder come from the engine, as integer minor units", async () => {
      const { fetch, bodies } = transport([
        () => reply("tool_use", [toolUse("t", "timeline", { scenario: "late" }), toolUse("o", "options_when_short", {}), toolUse("i", "list_invoices", {})]),
        () => reply("end_turn", [text("ok")]),
      ]);
      await ask(a, "What's coming and what are my options?", fetch);
      const [t, o, i] = toolResults(bodies[1]).map(r => JSON.parse(r.content));
      assert.equal(t.currency, "JPY");
      assert.ok(t.events.length > 0 && t.events.every((e: { amountMinor: number; date: string }) => Number.isInteger(e.amountMinor) && e.date >= aState.today));
      assert.ok(t.low.amountMinor < 0 && /^\d{4}-\d{2}-\d{2}$/.test(t.low.date));
      assert.equal(o.gapMinor, -t.low.amountMinor);
      assert.ok(o.options.length > 0 && o.options.every((x: { costMinor: number }) => Number.isInteger(x.costMinor)));
      assert.ok(i.length > 0 && i.every((x: { client: string; amountMinor: number; currency: string }) => x.client && Number.isInteger(x.amountMinor) && x.currency === "USD"));
      assert.ok(i.length <= 50);
    });

    await check("options_when_short says 'not short' when the runway is fine", async () => {
      const c = await seedBen(db, { isDemo: true });
      await db.update(schema.households).set({ bankBalanceMinor: 99_999_999 }).where(eq(schema.households.id, c));
      const { fetch, bodies } = transport([() => reply("tool_use", [toolUse("o", "options_when_short", {})]), () => reply("end_turn", [text("Fine.")])]);
      await ask(c, "Am I short?", fetch);
      assert.equal(toolResults(bodies[1])[0].content, "not short");
    });

    await check("an unknown tool, invalid input and a failing tool return is_error results and the loop continues", async () => {
      const { fetch, bodies } = transport([
        () => reply("tool_use", [toolUse("u1", "send_invoice", { id: "x" }), toolUse("u2", "can_i_spend", { amount_minor: -5, card_id: null }), toolUse("u3", "where_am_i", {})]),
        () => reply("end_turn", [text("I could only check your status.")]),
      ]);
      const result = await ask(a, "Send the invoice now.", fetch);
      assert.equal(result.answer, "I could only check your status.");
      const [u1, u2, u3] = toolResults(bodies[1]);
      assert.deepEqual([u1.is_error, u2.is_error, u3.is_error ?? false], [true, true, false]);
      assert.ok(tools.every(t => t.name !== "send_invoice" && t.name !== "send_reminder"));
    });

    await check("a fifth tool turn stops with an AgentError", async () => {
      const { fetch, bodies } = transport(() => reply("tool_use", [toolUse("again", "where_am_i", {})]));
      await assert.rejects(ask(a, "Loop forever.", fetch), AgentError);
      assert.equal(bodies.length, 5);
    });

    await check("a refusal, a cut-off answer, an empty answer and a spent time budget are AgentErrors", async () => {
      await assert.rejects(ask(a, "x", transport(() => reply("refusal", [])).fetch), { name: "Error", message: "The assistant declined to answer that." });
      await assert.rejects(ask(a, "x", transport(() => reply("max_tokens", [text("part")])).fetch), /cut off/);
      await assert.rejects(ask(a, "x", transport(() => reply("end_turn", [])).fetch), /no answer/);
      let clock = 0;
      const slow = transport(() => { clock = 30_000; return reply("tool_use", [toolUse("s", "where_am_i", {})]); });
      await assert.rejects(ask(a, "x", slow.fetch, { now: () => clock }), /too long/);
      assert.equal(slow.bodies.length, 1);
      // each request's timeout is the time left of the 20 s budget
      const timeouts: string[] = [];
      const timed = (async (input: string | URL | Request, init?: RequestInit) => {
        timeouts.push(new Request(input, init).headers.get("x-stainless-timeout") ?? "");
        return reply("end_turn", [text("ok")]);
      }) as typeof globalThis.fetch;
      await ask(a, "x", timed);
      assert.ok(Number(timeouts[0]) > 0 && Number(timeouts[0]) <= 20);
    });

    await check("provider errors become fixed, secret-free messages; a spent owner allowance is an AiKeyError", async () => {
      const unauthorised = transport(() => Response.json({ type: "error", error: { type: "authentication_error", message: KEY } }, { status: 401 }));
      await assert.rejects(ask(a, "x", unauthorised.fetch), (error: Error) => error instanceof AgentError && !error.message.includes("sk-ant") && /not accepted/.test(error.message));
      assert.equal(unauthorised.bodies.length, 1, "no retry");
      process.env.ANTHROPIC_DAILY_READ_LIMIT = "1";
      const d = await seedBen(db, { isDemo: true });
      const { fetch } = transport([() => reply("tool_use", [toolUse("q", "where_am_i", {})]), () => reply("end_turn", [text("never")])]);
      await assert.rejects(ask(d, "x", fetch), AiKeyError);
      process.env.ANTHROPIC_DAILY_READ_LIMIT = "50";
    });

    await check("a missing model setting stops before any allowance is reserved", async () => {
      delete process.env.ANTHROPIC_TEXT_MODEL;
      const before = await reads(a);
      await assert.rejects(ask(a, "x", transport(() => reply("end_turn", [text("no")])).fetch), /ANTHROPIC_TEXT_MODEL is not set/);
      assert.equal(await reads(a), before);
      process.env.ANTHROPIC_TEXT_MODEL = "fixture-text";
    });

    await check("draft_invoice saves a draft in the asking household only and the answer carries the review link", async () => {
      const draftId = crypto.randomUUID();
      const input = { id: draftId, clientId: aState.clients[0].id, item: "Poster layout", amount: "18.52", note: "" };
      const { fetch, bodies } = transport([
        () => reply("tool_use", [toolUse("d", "draft_invoice", input)]),
        () => reply("end_turn", [text("I drafted it; review it before sending.")]),
      ]);
      const result = await ask(a, "Draft an invoice for Poster layout, $18.52.", fetch);
      assert.deepEqual(result.links, [{ label: "Review invoice draft", href: `http://127.0.0.1:3123/invoices/${draftId}` }]);
      assert.ok(toolResults(bodies[1])[0].content.includes(draftId));
      const [draft] = await db.select().from(schema.invoices).where(and(eq(schema.invoices.householdId, a), eq(schema.invoices.id, draftId)));
      assert.equal(draft.status, "draft");
      assert.equal(draft.amountMinor, 1852);
      assert.equal((await db.select().from(schema.invoices).where(eq(schema.invoices.id, draftId))).length, 1);
      assert.equal((await db.select().from(schema.invoices).where(and(eq(schema.invoices.householdId, b), eq(schema.invoices.id, draftId)))).length, 0);
    });

    await check("log_charge and add_bill leave pending rows in To check for the asking household only, and a retry adds nothing", async () => {
      const chargeId = crypto.randomUUID(), billId = crypto.randomUUID();
      const charge = { id: chargeId, cardId: aState.cards[0].id, merchant: "Noodle place", amount: "3800", date: aState.today };
      const bill = { id: billId, biller: "Hikari Water", amount: "4200", due: aState.today, category: "utilities", memberId: null };
      const script = () => transport([
        () => reply("tool_use", [toolUse("c", "log_charge", charge), toolUse("b", "add_bill", bill)]),
        () => reply("end_turn", [text("Both are waiting in To check.")]),
      ]);
      const result = await ask(a, "I paid ¥3,800 at the noodle place and the water bill is ¥4,200.", script().fetch, { source: "voice" });
      assert.equal(result.pending, true);
      assert.deepEqual(result.links, [{ label: "Open To check", href: "http://127.0.0.1:3123/to-check" }]);
      const [row] = await db.select().from(schema.charges).where(and(eq(schema.charges.householdId, a), eq(schema.charges.id, chargeId)));
      assert.equal(row.status, "pending");
      assert.equal(row.source, "voice");
      assert.equal(row.amountMinor, 3800);
      const [pendingBill] = await db.select().from(schema.bills).where(and(eq(schema.bills.householdId, a), eq(schema.bills.id, billId)));
      assert.equal(pendingBill.status, "pending");
      await ask(a, "Same again.", script().fetch);
      assert.equal((await db.select().from(schema.charges).where(eq(schema.charges.id, chargeId))).length, 1);
      assert.equal((await db.select().from(schema.events).where(and(eq(schema.events.householdId, a), eq(schema.events.refId, chargeId)))).length, 1);
      const crossCard = transport([
        () => reply("tool_use", [toolUse("x", "log_charge", { ...charge, id: crypto.randomUUID(), cardId: bState.cards[0].id })]),
        () => reply("end_turn", [text("Done.")]),
      ]);
      const refused = await ask(a, "Log it on that card.", crossCard.fetch);
      assert.equal(refused.pending, false);
      assert.equal(toolResults(crossCard.bodies[1])[0].is_error, true);
    });

    await check("no agent source can reach the send-capable PayPal runner", async () => {
      const dir = "src/lib/agent";
      for (const file of readdirSync(dir)) {
        const source = readFileSync(`${dir}/${file}`, "utf8");
        assert.ok(!/runTool|deleteSmokeDraft|paypal\/toolkit/.test(source), `${file} must not import the PayPal toolkit`);
      }
    });
    console.log(`Agent checks passed (${passed}).`);
  } finally {
    for (const [name, value] of Object.entries({ ANTHROPIC_API_KEY: saved.key, ANTHROPIC_DAILY_READ_LIMIT: saved.limit, ANTHROPIC_TEXT_MODEL: saved.model })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await pg.close();
  }
}
main().catch(error => { console.error("Agent checks failed", error instanceof Error ? error.stack?.split("\n").slice(0, 6).join("\n") : ""); process.exitCode = 1; });
