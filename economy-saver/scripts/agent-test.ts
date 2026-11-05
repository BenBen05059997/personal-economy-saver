// The in-app agent over a fake Messages API transport. PGlite only; no network, no credentials.
// The send-capable PayPal runner is kept out of the agent by lint (no-restricted-imports in eslint.config.mjs)
// and by the source scan at the end of this script.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "@/db/schema";
import { aiKey, AiKeyError } from "@/db/ai-key";
import { householdDate } from "@/db/account";
import { loadMoneyState } from "@/db/household";
import { seedBen } from "@/db/seed";
import { AgentError, runAgent } from "@/lib/agent/run";
import { toolInputSchema, tools } from "@/lib/agent/tools";
import { dueAnswer, statusAnswer } from "@/lib/money/ask";
import { addDays, medianLow } from "@/lib/money/runway";
import { createHousehold, setupForm } from "@/db/account";
import { billInput, insertBill } from "@/db/bills";
import { MODEL_RULES } from "@/lib/agent/rules";
import { savePot } from "@/db/pots";
import { addMember } from "@/db/people";
import { planFor, planLine } from "@/lib/money/plan";
import { HouseholdSnapshot } from "@/lib/schema/household";

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
  const realInfo = console.info;
  async function check(name: string, run: () => Promise<void>) { await run(); passed++; console.log(`✓ ${name}`); }
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    process.env.ANTHROPIC_API_KEY = KEY;
    process.env.ANTHROPIC_DAILY_READ_LIMIT = "500";
    process.env.ANTHROPIC_TEXT_MODEL = "fixture-text";
    const a = await seedBen(db, { isDemo: true }), b = await seedBen(db, { isDemo: true });
    await db.update(schema.clients).set({ name: "ZZ Secret Client" }).where(eq(schema.clients.householdId, b));
    const stateOf = async (hid: string) => loadMoneyState(db, hid, await householdDate(db, hid));
    const aState = await stateOf(a), bState = await stateOf(b);
    const reads = async (hid: string) => (await db.select().from(schema.households).where(eq(schema.households.id, hid)))[0].aiReadsToday;
    // The one log line per Ask (D50) is captured here instead of printed.
    const logged: Record<string, unknown>[] = [];
    console.info = (...args: unknown[]) => { const first = String(args[0]); if (first.startsWith('{"at":')) logged.push(JSON.parse(first)); else realInfo(...args); };
    const ask = (hid: string, question: string, fetch: typeof globalThis.fetch, extra: { now?: () => number; source?: "voice" | "manual"; askId?: string } = {}) =>
      runAgent({ db, householdId: hid, question, askId: extra.askId ?? crypto.randomUUID(), appUrl: APP, key: () => aiKey(db, hid), fetch, ...extra });

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

    await check("household_snapshot through the transport: the whole household of the asker, without events, valid against the schema", async () => {
      const { fetch, bodies } = transport([
        () => reply("tool_use", [toolUse("toolu_snap", "household_snapshot", {})]),
        () => reply("end_turn", [text("You have three clients.")]),
      ]);
      assert.equal((await ask(a, "What do I have set up?", fetch)).answer, "You have three clients.");
      const [result1] = toolResults(bodies[1]);
      assert.ok(!result1.is_error);
      const snapshot = HouseholdSnapshot.parse(JSON.parse(result1.content));
      assert.equal(snapshot.household.id, a);
      assert.equal(snapshot.clients.length, aState.clients.length);
      assert.ok(!("events" in snapshot));
      assert.ok(!result1.content.includes("ZZ Secret Client"));
      const definition = bodies[0].tools.find(t => t.name === "household_snapshot")!;
      assert.deepEqual(definition.input_schema.properties, {});
      assert.equal(definition.input_schema.additionalProperties, false);
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
      const addBill = toolInputSchema(tools.find(t => t.name === "add_bill")!) as { properties: { repeat: unknown; next_amount: unknown; next_amount_from: unknown; cancel_by: unknown }; required: string[] };
      assert.ok(["repeat", "next_amount", "next_amount_from", "cancel_by"].every(key => key in addBill.properties && addBill.required.includes(key)), "the D48 fields are required properties (nullable) of add_bill");
      assert.ok(!("monthly" in addBill.properties));
    });

    await check("tools only see the asking household: no other household's data in any tool output", async () => {
      const names = tools.filter(t => t.scope === "read").map(t => t.name);
      const calls = [...names.map((name, i) => toolUse(`r${i}`, name, name === "timeline" ? { scenario: "late" } : name === "can_i_spend" ? { amount_minor: 4000, card_id: null }
        : name === "plan_for" ? { target_minor: 1_200_000, target_date: "2027-03-31", monthly_minor: null, pot_id: null } : {})),
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
      process.env.ANTHROPIC_DAILY_READ_LIMIT = "500";
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
      const bill = { id: billId, biller: "Hikari Water", amount: "4200", due: aState.today, category: "utilities", memberId: null, repeat: "month" };
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
      assert.equal(pendingBill.repeatDay, Number(aState.today.slice(8, 10)), "repeat month stores the due date's day");
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

    await check("add_bill takes repeat, next_amount, next_amount_from and cancel_by (D48): a yearly bill waits in To check with them, and a bad schedule is an error the model can read", async () => {
      const billId = crypto.randomUUID();
      const yearly = { id: billId, biller: "Fictional Cloud", amount: "12000", due: "2026-12-01", category: "subscriptions", memberId: null, repeat: "year", next_amount: "13000", next_amount_from: "2027-12-01", cancel_by: "2026-11-20" };
      const run = transport([() => reply("tool_use", [toolUse("y", "add_bill", yearly)]), () => reply("end_turn", [text("Waiting in To check.")])]);
      const result = await ask(a, "Fictional Cloud renews yearly on Dec 1 at 12000, rising to 13000 in 2027; cancel by Nov 20.", run.fetch);
      assert.equal(result.pending, true);
      const [row] = await db.select().from(schema.bills).where(and(eq(schema.bills.householdId, a), eq(schema.bills.id, billId)));
      assert.deepEqual([row.status, row.repeatUnit, row.repeatDay, row.amountMinor, row.nextAmountMinor, row.nextAmountFrom, row.cancelBy], ["pending", "year", null, 12_000, 13_000, "2027-12-01", "2026-11-20"]);
      const bad = transport([() => reply("tool_use", [toolUse("z", "add_bill", { ...yearly, id: crypto.randomUUID(), repeat: null })]), () => reply("end_turn", [text("Done.")])]);
      const refused = await ask(a, "Add it as a one-off.", bad.fetch);
      assert.equal(refused.pending, false);
      const error = toolResults(bad.bodies[1])[0];
      assert.equal(error.is_error, true);
      assert.match(JSON.stringify(error.content), /needs a bill that repeats/);
    });

    await check("update_bank_balance leaves a pending update in To check, not a new balance, and a retry adds nothing", async () => {
      const tool = tools.find(t => t.name === "update_bank_balance")!;
      assert.equal(tool.scope, "draft");
      const schemaOf = toolInputSchema(tool) as unknown as { required: string[]; additionalProperties: boolean };
      assert.deepEqual([...schemaOf.required].sort(), ["amount", "id"]);
      assert.equal(schemaOf.additionalProperties, false);
      const updateId = crypto.randomUUID();
      const script = () => transport([
        () => reply("tool_use", [toolUse("u", "update_bank_balance", { id: updateId, amount: "182000" })]),
        () => reply("end_turn", [text("It is waiting in To check.")]),
      ]);
      const bankOf = async (hid: string) => (await db.select().from(schema.households).where(eq(schema.households.id, hid)))[0].bankBalanceMinor;
      const [bankA, bankB] = [await bankOf(a), await bankOf(b)];
      const first = script();
      const result = await ask(a, "My bank balance is ¥182,000 now.", first.fetch);
      assert.equal(result.pending, true);
      assert.deepEqual(result.links, [{ label: "Open To check", href: "http://127.0.0.1:3123/to-check" }]);
      const rows = await db.select().from(schema.balanceUpdates).where(eq(schema.balanceUpdates.id, updateId));
      assert.deepEqual(rows.map(r => [r.householdId, r.status, r.amountMinor, r.currency]), [[a, "pending", 182_000, "JPY"]]);
      assert.equal(await bankOf(a), bankA, "the agent never changes the balance itself");
      assert.equal(await bankOf(b), bankB);
      assert.ok(!toolResults(first.bodies[1])[0].is_error);
      await ask(a, "Same again.", script().fetch);
      assert.equal((await db.select().from(schema.balanceUpdates).where(eq(schema.balanceUpdates.id, updateId))).length, 1);
      const other = transport([
        () => reply("tool_use", [toolUse("x", "update_bank_balance", { id: updateId, amount: "1" })]),
        () => reply("end_turn", [text("Done.")]),
      ]);
      const refused = await ask(b, "Set it.", other.fetch);
      assert.equal(refused.pending, false);
      assert.equal(toolResults(other.bodies[1])[0].is_error, true, "an id held by another household is refused");
    });

    await check("plan_for is a read tool: its summary is built in code and its numbers come from the engine; add_pot leaves a pending pot", async () => {
      const planTool = tools.find(t => t.name === "plan_for")!, addTool = tools.find(t => t.name === "add_pot")!;
      assert.equal(planTool.scope, "read");
      assert.equal(addTool.scope, "draft");
      assert.deepEqual([...(toolInputSchema(planTool) as unknown as { required: string[] }).required].sort(), ["monthly_minor", "pot_id", "target_date", "target_minor"]);
      assert.deepEqual([...(toolInputSchema(addTool) as unknown as { required: string[] }).required].sort(), ["fillPct", "id", "name", "target", "targetDate"]);
      const request = { target: 1_200_000, saved: 0, targetDate: "2027-03-31" };
      const plan = transport([
        () => reply("tool_use", [toolUse("p", "plan_for", { target_minor: 1_200_000, target_date: "2027-03-31", monthly_minor: null, pot_id: null })]),
        () => reply("end_turn", [text("It takes about ¥300,000 a month.")]),
      ]);
      const asked = await ask(a, "Can I save ¥1,200,000 for a car by March 2027?", plan.fetch);
      assert.deepEqual(asked, { answer: "It takes about ¥300,000 a month.", links: [], pending: false });
      const [out] = toolResults(plan.bodies[1]);
      assert.ok(!out.is_error);
      const result = JSON.parse(out.content);
      assert.equal(result.summary, planLine(request, planFor(request, aState), aState));
      assert.deepEqual([result.currency, result.neededMinor, result.months, result.monthlyNeededMinor, result.fits, result.monthlyRoomMinor], ["JPY", 1_200_000, 4, 300_000, false, 92_220]);
      assert.ok(Object.values(result).every(v => typeof v !== "number" || Number.isInteger(v)));
      assert.ok(plan.bodies[0].system.includes("never unprompted"), "the prompt says when to offer a pot");

      const potId = crypto.randomUUID();
      await savePot(db, a, { id: potId, name: "Car", target: "1200000", targetDate: "2027-03-31", saved: "200000", fillPct: null, memberId: null }, "confirmed", { madeBy: "form" });
      const existing = transport([
        () => reply("tool_use", [toolUse("e", "plan_for", { target_minor: null, target_date: null, monthly_minor: 100_000, pot_id: potId })]),
        () => reply("end_turn", [text("ok")]),
      ]);
      await ask(a, "How is the car pot going?", existing.fetch);
      const mine = JSON.parse(toolResults(existing.bodies[1])[0].content);
      assert.deepEqual([mine.savedMinor, mine.targetMinor, mine.neededMinor, mine.monthlyNeededMinor, mine.paceMinor, mine.monthsAtPace], [200_000, 1_200_000, 1_000_000, 250_000, 100_000, 10]);
      const foreign = transport([
        () => reply("tool_use", [toolUse("f", "plan_for", { target_minor: null, target_date: null, monthly_minor: null, pot_id: potId })]),
        () => reply("end_turn", [text("ok")]),
      ]);
      await ask(b, "Plan it.", foreign.fetch);
      assert.equal(toolResults(foreign.bodies[1])[0].is_error, true, "another household's pot id is unknown");
      const noTarget = transport([
        () => reply("tool_use", [toolUse("n", "plan_for", { target_minor: null, target_date: null, monthly_minor: null, pot_id: null })]),
        () => reply("end_turn", [text("ok")]),
      ]);
      await ask(a, "Plan.", noTarget.fetch);
      assert.equal(toolResults(noTarget.bodies[1])[0].is_error, true);

      const trip = crypto.randomUUID();
      const script = () => transport([
        () => reply("tool_use", [toolUse("t", "add_pot", { id: trip, name: "Trip", target: "300000", targetDate: "2027-05-31", fillPct: null })]),
        () => reply("end_turn", [text("It is waiting in To check.")]),
      ]);
      const first = script();
      const added = await ask(a, "I want to save ¥300,000 for a trip by May.", first.fetch);
      assert.equal(added.pending, true);
      assert.deepEqual(added.links, [{ label: "Open To check", href: "http://127.0.0.1:3123/to-check" }]);
      const rows = await db.select().from(schema.pots).where(eq(schema.pots.id, trip));
      assert.deepEqual(rows.map(r => [r.householdId, r.status, r.name, r.targetMinor, r.targetDate, r.savedMinor, r.fillBp]), [[a, "pending", "Trip", 300_000, "2027-05-31", 0, null]]);
      assert.deepEqual((await stateOf(a)).pots.map(p => p.name), ["Car"], "a pending pot does not count");
      await ask(a, "Same again.", script().fetch);
      assert.equal((await db.select().from(schema.pots).where(eq(schema.pots.id, trip))).length, 1);
      const other = transport([
        () => reply("tool_use", [toolUse("x", "add_pot", { id: trip, name: "Other", target: null, targetDate: null, fillPct: null })]),
        () => reply("end_turn", [text("Done.")]),
      ]);
      const refused = await ask(b, "Set it.", other.fetch);
      assert.equal(refused.pending, false);
      assert.equal(toolResults(other.bodies[1])[0].is_error, true, "an id held by another household is refused");
    });

    await check("who_owes_whom is a read tool that answers from the split; add_bill takes a payer by name and an unknown name comes back as a clear tool error", async () => {
      const c = await seedBen(db, { isDemo: true });
      await addMember(db, c, { name: "Aki" });
      const split = tools.find(t => t.name === "who_owes_whom")!, addBill = tools.find(t => t.name === "add_bill")!;
      assert.equal(split.scope, "read");
      const required = (toolInputSchema(addBill) as unknown as { required: string[] }).required;
      assert.ok(required.includes("shared") && required.includes("paidBy"), "strict schema: nullable, so required");
      const owes = transport([
        () => reply("tool_use", [toolUse("w", "who_owes_whom", {})]),
        () => reply("end_turn", [text("Nobody owes anyone.")]),
      ]);
      assert.equal((await ask(c, "Who owes whom?", owes.fetch)).answer, "Nobody owes anyone.");
      const [out] = toolResults(owes.bodies[1]);
      assert.ok(!out.is_error);
      assert.equal(JSON.parse(out.content).summary, "Nobody owes anyone anything.");
      const bill = (paidBy: string) => toolUse("a", "add_bill", { id: crypto.randomUUID(), biller: "Fictional rent", amount: "80000", due: "2026-11-27", category: "housing", memberId: null, repeat: "month", shared: true, paidBy });
      const unknown = transport([() => reply("tool_use", [bill("Nobody")]), () => reply("end_turn", [text("I could not find that person.")])]);
      const refused = await ask(c, "Add rent paid by Nobody.", unknown.fetch);
      assert.equal(refused.pending, false);
      const [error] = toolResults(unknown.bodies[1]);
      assert.deepEqual([error.is_error, error.content], [true, "Nobody called Nobody is in this household"]);
      const known = transport([() => reply("tool_use", [bill("aki")]), () => reply("end_turn", [text("Rent is in To check.")])]);
      assert.equal((await ask(c, "Add rent paid by Aki.", known.fetch)).pending, true);
      const [saved] = await db.select().from(schema.bills).where(and(eq(schema.bills.householdId, c), eq(schema.bills.biller, "Fictional rent")));
      assert.deepEqual([saved.status, saved.memberId === null, saved.paidByMemberId !== null], ["pending", true, true]);
    });


    await check("list_clients_and_cards and list_invoices carry each client's pace: usual and slowest days to pay, null with no paid invoice", async () => {
      const fresh = await seedBen(db, { isDemo: true });
      const freshState = await stateOf(fresh);
      const { fetch, bodies } = transport([
        () => reply("tool_use", [toolUse("lc", "list_clients_and_cards", {}), toolUse("li", "list_invoices", {})]),
        () => reply("end_turn", [text("ok")]),
      ]);
      await ask(fresh, "How fast do my clients pay?", fetch);
      const [listing, invoices] = toolResults(bodies[1]).map(r => JSON.parse(r.content));
      const paced = freshState.clients.filter(c => c.daysToPay.length > 0);
      assert.ok(paced.length > 0, "the sample has clients with history");
      for (const c of freshState.clients) {
        const row = listing.clients.find((x: { id: string }) => x.id === c.id);
        const expected = c.daysToPay.length ? { usual: medianLow(c.daysToPay), slowest: Math.max(...c.daysToPay) } : null;
        assert.deepEqual([row.usualDaysToPay, row.slowestDaysToPay], [expected?.usual ?? null, expected?.slowest ?? null]);
        for (const inv of invoices.filter((i: { client: string }) => i.client === c.name)) assert.deepEqual([inv.usualDaysToPay, inv.slowestDaysToPay], [expected?.usual ?? null, expected?.slowest ?? null]);
      }
      assert.ok(!("clientId" in invoices[0]));
      const none = await seedBen(db, { isDemo: true });
      await db.update(schema.invoices).set({ paidOn: null, sentOn: null, status: "draft" }).where(eq(schema.invoices.householdId, none));
      const bare = transport([() => reply("tool_use", [toolUse("lc", "list_clients_and_cards", {})]), () => reply("end_turn", [text("ok")])]);
      await ask(none, "Pace?", bare.fetch);
      assert.ok(JSON.parse(toolResults(bare.bodies[1])[0].content).clients.every((c: { usualDaysToPay: null; slowestDaysToPay: null }) => c.usualDaysToPay === null && c.slowestDaysToPay === null));
    });

    await check("the system prompt carries the rules (ask on ambiguous names, snapshot is context, mention pace, bulk tools) and the same text is what MCP gets", async () => {
      const { fetch, bodies } = transport(() => reply("end_turn", [text("ok")]));
      await ask(a, "Hi", fetch);
      const system = bodies[0].system;
      assert.ok(system.includes(aState.today) && system.includes("JPY"));
      assert.match(system, /matches more than one[^.]*or none, ask which one/);
      assert.match(system, /household_snapshot is background context/);
      assert.match(system, /usualDaysToPay, slowestDaysToPay/);
      assert.match(system, /add_bills or log_charges/);
      assert.ok(system.includes(MODEL_RULES.split("\n").slice(1).join("\n")));
      assert.ok(!/\btoday\b|\d{4}-\d{2}-\d{2}|JPY|home currency/i.test(MODEL_RULES), "the shared rules name neither the date nor the household's currency");
    });

    await check("add_bills and log_charges: 1-10 items, all pending in one transaction, made by ask with the question's id on every row and event; an invalid item saves none", async () => {
      const askId = crypto.randomUUID();
      const bills = [0, 1, 2].map(i => ({ id: crypto.randomUUID(), biller: `Bulk bill ${i}`, amount: String(1000 + i), due: aState.today, category: null, memberId: null, repeat: null, next_amount: null, next_amount_from: null, cancel_by: null, business_bp: null, shared: null, paidBy: null }));
      const charges = [0, 1].map(i => ({ id: crypto.randomUUID(), cardId: aState.cards[0].id, merchant: `Bulk shop ${i}`, amount: String(500 + i), date: aState.today, category: null, business_bp: null, shared: false }));
      const run = transport([
        () => reply("tool_use", [toolUse("ab", "add_bills", { items: bills }), toolUse("lc", "log_charges", { items: charges })]),
        () => reply("end_turn", [text("Five items are in To check.")]),
      ]);
      const result = await ask(a, "Add these five.", run.fetch, { askId, source: "voice" });
      assert.equal(result.pending, true);
      const [ab, lc] = toolResults(run.bodies[1]);
      assert.ok(!ab.is_error && !lc.is_error);
      assert.match(ab.content, /^3 bills are waiting in To check/);
      assert.match(lc.content, /^2 charges are waiting in To check/);
      const billRows = await db.select().from(schema.bills).where(and(eq(schema.bills.householdId, a), eq(schema.bills.askId, askId)));
      const chargeRows = await db.select().from(schema.charges).where(and(eq(schema.charges.householdId, a), eq(schema.charges.askId, askId)));
      assert.equal(billRows.length, 3);
      assert.equal(chargeRows.length, 2);
      assert.ok([...billRows, ...chargeRows].every(r => r.status === "pending" && r.madeBy === "ask"));
      assert.ok(chargeRows.every(r => r.source === "voice"));
      const ev = await db.select().from(schema.events).where(and(eq(schema.events.householdId, a), eq(schema.events.askId, askId)));
      assert.equal(ev.length, 5);
      assert.ok(ev.every(e => e.kind === "to_check" && e.madeBy === "ask"));
      // a retry with the same ids adds nothing
      await ask(a, "Again.", transport([() => reply("tool_use", [toolUse("ab", "add_bills", { items: bills })]), () => reply("end_turn", [text("ok")])]).fetch, { askId });
      assert.equal((await db.select().from(schema.bills).where(eq(schema.bills.askId, askId))).length, 3);

      // field paths: names the failing fields, never the values sent
      const secret = "ZZ-secret-value-9931";
      const badShape = [...bills.slice(0, 2).map(b => ({ ...b, id: crypto.randomUUID() })), { ...bills[2], id: crypto.randomUUID(), due: secret, amount: 5 }];
      const invalid = transport([() => reply("tool_use", [toolUse("bad", "add_bills", { items: badShape }), toolUse("empty", "log_charges", { items: [] })]), () => reply("end_turn", [text("ok")])]);
      await ask(a, "Bad.", invalid.fetch);
      const [bad, empty] = toolResults(invalid.bodies[1]);
      assert.deepEqual([bad.is_error, bad.content], [true, "Invalid input for this tool: items.2.amount, items.2.due"]);
      assert.deepEqual([empty.is_error, empty.content], [true, "Invalid input for this tool: items"]);
      assert.ok(!bad.content.includes(secret));
      const tooMany = transport([() => reply("tool_use", [toolUse("many", "log_charges", { items: Array.from({ length: 11 }, () => charges[0]) })]), () => reply("end_turn", [text("ok")])]);
      await ask(a, "Too many.", tooMany.fetch);
      assert.equal(toolResults(tooMany.bodies[1])[0].content, "Invalid input for this tool: items");

      // an item that fails inside the transaction names its index and saves none of the others
      const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
      const items = ids.map((id, i) => ({ ...bills[0], id, biller: `Rolled back ${i}`, due: i === 2 ? "2099-01-01" : aState.today }));
      const rolled = transport([() => reply("tool_use", [toolUse("rb", "add_bills", { items })]), () => reply("end_turn", [text("ok")])]);
      const rolledResult = await ask(a, "One is too far out.", rolled.fetch);
      const [rb] = toolResults(rolled.bodies[1]);
      assert.equal(rb.is_error, true);
      assert.match(rb.content, /^items\[2\]: /);
      assert.equal(rolledResult.pending, false);
      assert.equal((await db.select().from(schema.bills).where(and(eq(schema.bills.householdId, a), inArray(schema.bills.id, ids)))).length, 0, "all or nothing");
      assert.equal((await db.select().from(schema.events).where(inArray(schema.events.refId, ids))).length, 0);
      // the same for charges: a card of another household fails the whole call
      const mixed = [charges[0], { ...charges[1], id: crypto.randomUUID(), cardId: bState.cards[0].id }].map((c, i) => ({ ...c, id: crypto.randomUUID(), merchant: `Rolled charge ${i}` }));
      const mixedRun = transport([() => reply("tool_use", [toolUse("mx", "log_charges", { items: mixed })]), () => reply("end_turn", [text("ok")])]);
      await ask(a, "Mixed.", mixedRun.fetch);
      assert.match(toolResults(mixedRun.bodies[1])[0].content, /^items\[1\]: /);
      assert.equal((await db.select().from(schema.charges).where(inArray(schema.charges.id, mixed.map(c => c.id)))).length, 0);
      // the new tools are draft tools with strict schemas, and the singles stay
      for (const name of ["add_bills", "log_charges"]) assert.equal(tools.find(t => t.name === name)!.scope, "draft");
      assert.ok(tools.some(t => t.name === "add_bill") && tools.some(t => t.name === "log_charge"));
    });

    await check("every row and event an ask writes carries made_by 'ask' and the question's id", async () => {
      const askId = crypto.randomUUID();
      const ids = { draft: crypto.randomUUID(), bill: crypto.randomUUID(), charge: crypto.randomUUID(), pot: crypto.randomUUID(), bank: crypto.randomUUID() };
      const run = transport([
        () => reply("tool_use", [
          toolUse("d", "draft_invoice", { id: ids.draft, clientId: aState.clients[0].id, item: "Traced", amount: "5.00", note: "" }),
          toolUse("b", "add_bill", { id: ids.bill, biller: "Traced bill", amount: "100", due: aState.today, category: null, memberId: null, repeat: null, next_amount: null, next_amount_from: null, cancel_by: null, business_bp: null, shared: null, paidBy: null }),
          toolUse("c", "log_charge", { id: ids.charge, cardId: aState.cards[0].id, merchant: "Traced shop", amount: "100", date: aState.today, category: null, business_bp: null, shared: false }),
          toolUse("p", "add_pot", { id: ids.pot, name: "Traced", target: null, targetDate: null, fillPct: null }),
          toolUse("u", "update_bank_balance", { id: ids.bank, amount: "1234" }),
        ]),
        () => reply("end_turn", [text("Done.")]),
      ]);
      await ask(a, "Trace everything.", run.fetch, { askId });
      assert.ok(toolResults(run.bodies[1]).every(r => !r.is_error));
      const stamped = (rows: { madeBy: string; askId: string | null }[]) => rows.map(r => [r.madeBy, r.askId]);
      const one = [["ask", askId]];
      assert.deepEqual(stamped(await db.select().from(schema.invoices).where(eq(schema.invoices.id, ids.draft))), one);
      assert.deepEqual(stamped(await db.select().from(schema.bills).where(eq(schema.bills.id, ids.bill))), one);
      assert.deepEqual(stamped(await db.select().from(schema.charges).where(eq(schema.charges.id, ids.charge))), one);
      assert.deepEqual(stamped(await db.select().from(schema.pots).where(eq(schema.pots.id, ids.pot))), one);
      assert.deepEqual(stamped(await db.select().from(schema.balanceUpdates).where(eq(schema.balanceUpdates.id, ids.bank))), one);
      const ev = await db.select().from(schema.events).where(and(eq(schema.events.householdId, a), inArray(schema.events.refId, Object.values(ids))));
      assert.ok(ev.length >= 4 && ev.every(e => e.madeBy === "ask" && e.askId === askId));
    });

    await check("one content-free log line per Ask, at every exit: its shape, and neither the question, the tool result, the answer nor the key is in it", async () => {
      const question = "Distinctive question zq81 about my fictional dentist";
      const answer = "Distinctive answer wx47 for you";
      logged.length = 0;
      const askId = crypto.randomUUID();
      const run = transport([
        () => reply("tool_use", [toolUse("w", "where_am_i", {}), toolUse("bad", "can_i_spend", { amount_minor: -1, card_id: null })]),
        () => reply("end_turn", [text(answer)]),
      ]);
      await ask(a, question, run.fetch, { askId, source: "manual" });
      assert.equal(logged.length, 1);
      const [line] = logged;
      assert.deepEqual(Object.keys(line).sort(), ["askId", "at", "householdId", "inputTokens", "ms", "outcome", "outputTokens", "source", "stop", "tools", "turns"]);
      assert.deepEqual([line.at, line.householdId, line.askId, line.source, line.stop, line.turns, line.outcome, line.inputTokens, line.outputTokens], ["ask", a, askId, "manual", "end_turn", 2, "answer", 2, 2]);
      const lineTools = line.tools as { name: string; ok: boolean; ms: number }[];
      assert.deepEqual(lineTools.map(t => [t.name, t.ok]), [["where_am_i", true], ["can_i_spend", false]]);
      assert.ok(lineTools.every(t => Number.isInteger(t.ms)) && Number.isInteger(line.ms));
      const raw = JSON.stringify(line);
      const result = dueAnswer(aState);
      for (const needle of [question, answer, KEY, "dentist", "Distinctive", statusAnswer(aState)]) assert.ok(!raw.includes(needle), `the log line leaks ${needle.slice(0, 20)}`);
      assert.ok(!raw.includes(result.slice(0, 20)) || result.length < 20);

      // every failure exit logs one line with its key, and no provider message
      logged.length = 0;
      await assert.rejects(ask(a, question, transport(() => reply("refusal", [])).fetch));
      await assert.rejects(ask(a, question, transport(() => reply("end_turn", [])).fetch));
      await assert.rejects(ask(a, question, transport(() => reply("tool_use", [toolUse("again", "where_am_i", {})])).fetch), AgentError);
      await assert.rejects(ask(a, question, transport(() => Response.json({ type: "error", error: { type: "authentication_error", message: KEY + " provider words" } }, { status: 401 })).fetch));
      assert.deepEqual(logged.map(l => [l.outcome, l.stop]), [["refusal", "refusal"], ["empty", "end_turn"], ["turns", "tool_use"], ["api_error", "api_error"]]);
      assert.equal((logged[2].tools as unknown[]).length, 4);
      for (const l of logged) {
        const text2 = JSON.stringify(l);
        assert.ok(!text2.includes(question) && !text2.includes(KEY) && !text2.includes("provider words"));
      }
    });

    await check("search_spending (D53) is a read tool that answers on the sample household; month_by_category takes a month of the last twelve", async () => {
      const c = await seedBen(db, { isDemo: true });
      const search = tools.find(t => t.name === "search_spending")!, month = tools.find(t => t.name === "month_by_category")!;
      assert.deepEqual([search.scope, month.scope], ["read", "read"]);
      const schemaOf = toolInputSchema(search) as unknown as { required: string[]; properties: Record<string, unknown> };
      assert.deepEqual(schemaOf.required.sort(), ["months", "query"], "strict schema: both listed");
      assert.throws(() => search.input.parse({ query: "x".repeat(81), months: 3 }));
      for (const months of [0, 13, 1.5]) assert.throws(() => search.input.parse({ query: "", months }), String(months));
      assert.throws(() => month.input.parse({ month: "2026-13" }));
      const run = transport([
        () => reply("tool_use", [toolUse("s", "search_spending", { query: "food", months: 1 }), toolUse("r", "search_spending", { query: "rent", months: null })]),
        () => reply("end_turn", [text("Food: ¥10,700 in November.")]),
      ]);
      assert.equal((await ask(c, "How much did I spend on food this month?", run.fetch)).answer, "Food: ¥10,700 in November.");
      const [food, rent] = toolResults(run.bodies[1]).map(r => { assert.ok(!r.is_error, r.content); return JSON.parse(r.content); });
      assert.equal(food.summary, "Food: ¥10,700 in November (3 items). ¥10,700 in all.");
      assert.deepEqual([food.from, food.to, food.currency, food.category, food.totalMinor], ["2026-11-01", "2026-11-14", "JPY", "food", 10_700]);
      assert.deepEqual(food.months[0].items.map((i: { label: string; date: string; amountMinor: number }) => [i.label, i.date, i.amountMinor]),
        [["Minato Fresh Market", "2026-11-13", 1_400], ["Kissa Midori café", "2026-11-12", 1_880], ["Minato Fresh Market", "2026-11-08", 7_420]]);
      assert.equal(rent.summary, `"rent": ¥82,000 in October (1 item), ¥82,000 in September (1 item); nothing in the other 1 month. ¥164,000 in all.`, "Ben's rent series starts Aug 27; Nov 27 is after the demo's today");
      assert.equal(rent.from, "2026-09-01");
      const october = await month.run({ madeBy: "ask", db, householdId: c, state: () => stateOf(c), appUrl: APP } as never, month.input.parse({ month: "2026-10" }) as never);
      assert.match(october, /^October: ¥132,060 in total\. Business ¥31,986 of ¥132,060 in October\.\nHousing ¥82,000 /);
      assert.match(october, /\nFood ¥11,440: /);
      const refused = transport([() => reply("tool_use", [toolUse("m", "month_by_category", { month: "2025-10" })]), () => reply("end_turn", [text("Only the last 12 months.")])]);
      await ask(c, "What about October last year?", refused.fetch);
      assert.deepEqual(toolResults(refused.bodies[1]).map(r => [r.is_error, r.content]), [[true, "month must be one of the last 12 months, 2025-12 to 2026-11"]]);
    });

    await check("regular_costs (D54) is a read tool: Ben's regular costs this month against last, months 2 to 6", async () => {
      const c = await seedBen(db, { isDemo: true });
      const regular = tools.find(t => t.name === "regular_costs")!;
      assert.equal(regular.scope, "read");
      assert.deepEqual((toolInputSchema(regular) as unknown as { required: string[] }).required, ["months"], "strict schema: months listed");
      for (const months of [1, 7, 2.5]) assert.throws(() => regular.input.parse({ months }), String(months));
      const run = transport([
        () => reply("tool_use", [toolUse("g", "regular_costs", { months: null }), toolUse("g6", "regular_costs", { months: 6 })]),
        () => reply("end_turn", [text("Kissa Midori café down ¥920 so far.")]),
      ]);
      assert.equal((await ask(c, "What changed in my regular costs?", run.fetch)).answer, "Kissa Midori café down ¥920 so far.");
      const [three, six] = toolResults(run.bodies[1]).map(r => { assert.ok(!r.is_error, r.content); return JSON.parse(r.content); });
      assert.equal(three.summary, "Kissa Midori café down ¥920 so far · Minato Fresh Market up ¥180 so far");
      assert.deepEqual([three.from, three.to, three.currency, three.month, three.months], ["2026-09-01", "2026-11-30", "JPY", "2026-11", ["2026-09", "2026-10", "2026-11"]]);
      assert.deepEqual(three.items.map((i: { label: string; status: string; thisMinor: number; lastMinor: number }) => [i.label, i.status, i.thisMinor, i.lastMinor]), [
        ["Kissa Midori café", "down", 1_880, 2_800], ["Minato Fresh Market", "up", 8_820, 8_640], ["Rent", "same", 82_000, 82_000],
        ["Mobaile Tsushin", "same", 4_800, 4_800], ["CloudBox Plus", "same", 1_980, 1_980], ["Hikari Denki", "not_yet", 0, 10_020],
      ], "Rent's Nov 27 counts: a known bill still due this month; Hikari Denki's November bill is still in To check");
      assert.equal(three.items.find((i: { label: string }) => i.label === "Hikari Denki").usualDay, 25);
      assert.equal(six.from, "2026-06-01");
      assert.deepEqual(six.items.find((i: { label: string }) => i.label === "Rent").months.map((m: { amountMinor: number }) => m.amountMinor), [0, 0, 82_000, 82_000, 82_000, 82_000], "Ben's rent starts Aug 27");
    });

    await check("no agent source can reach the send-capable PayPal runner", async () => {
      const dir = "src/lib/agent";
      for (const file of readdirSync(dir)) {
        const source = readFileSync(`${dir}/${file}`, "utf8");
        assert.ok(!/runTool|deleteSmokeDraft|paypal\/toolkit/.test(source), `${file} must not import the PayPal toolkit`);
      }
    });
    await check("a US household: the timeline and plan_for tools speak cents ($12.50 is 1250, a $1,500 target is 150000)", async () => {
      const usd = await createHousehold(db, crypto.randomUUID(), setupForm.parse({ name: "Fictional newcomer", currency: "USD", timeZone: "Asia/Tokyo", bank: "1,200", card: "Card D", limit: "", closingDay: "20", dueDay: "10" }), { isDemo: true });
      const today = (await stateOf(usd)).today;
      await insertBill(db, usd, billInput.parse({ id: crypto.randomUUID(), biller: "Fictional landlord", amount: "12.50", due: addDays(today, 5), category: "housing" }), "confirmed", { madeBy: "form" });
      const { fetch, bodies } = transport([
        () => reply("tool_use", [toolUse("t", "timeline", { scenario: "late" }), toolUse("p", "plan_for", { target_minor: 150_000, target_date: null, monthly_minor: 25_000, pot_id: null })]),
        () => reply("end_turn", [text("ok")]),
      ]);
      await ask(usd, "What's coming?", fetch);
      const [t, p] = toolResults(bodies[1]).map(r => JSON.parse(r.content));
      assert.equal(t.currency, "USD");
      assert.deepEqual(t.events.map((e: { label: string; amountMinor: number; balanceAfterMinor: number }) => [e.label, e.amountMinor, e.balanceAfterMinor]), [["Fictional landlord", -1250, 118_750]]);
      assert.deepEqual([t.low.amountMinor, p.currency, p.neededMinor, p.paceMinor, p.monthsAtPace], [118_750, "USD", 150_000, 25_000, 6]);
      assert.match(p.summary, /\$1,500/);
    });

    console.log(`Agent checks passed (${passed}).`);
  } finally {
    console.info = realInfo;
    for (const [name, value] of Object.entries({ ANTHROPIC_API_KEY: saved.key, ANTHROPIC_DAILY_READ_LIMIT: saved.limit, ANTHROPIC_TEXT_MODEL: saved.model })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await pg.close();
  }
}
main().catch(error => { console.error("Agent checks failed", error instanceof Error ? error.stack?.split("\n").slice(0, 6).join("\n") : ""); process.exitCode = 1; });
