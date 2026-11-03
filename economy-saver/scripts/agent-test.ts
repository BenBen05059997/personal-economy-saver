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
      const addBill = toolInputSchema(tools.find(t => t.name === "add_bill")!) as { properties: { monthly: { type: string } } };
      assert.equal(addBill.properties.monthly.type, "boolean");
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
      const bill = { id: billId, biller: "Hikari Water", amount: "4200", due: aState.today, category: "utilities", memberId: null, monthly: true };
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
      assert.equal(pendingBill.repeatDay, Number(aState.today.slice(8, 10)), "monthly: true stores the due date's day");
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
      await savePot(db, a, { id: potId, name: "Car", target: "1200000", targetDate: "2027-03-31", saved: "200000", fillPct: null, memberId: null }, "confirmed");
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
      const bill = (paidBy: string) => toolUse("a", "add_bill", { id: crypto.randomUUID(), biller: "Fictional rent", amount: "80000", due: "2026-11-27", category: "Housing", memberId: null, monthly: true, shared: true, paidBy });
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
