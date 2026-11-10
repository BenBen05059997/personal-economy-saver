// The in-app agent over a fake Messages API transport. PGlite only; no network, no credentials.
// The send-capable PayPal runner is kept out of the agent by lint (no-restricted-imports in eslint.config.mjs)
// and by the source scan at the end of this script.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "@/db/schema";
import { looksLikeApiKey } from "@/lib/ai/key-text";
import { aiConnection } from "@/db/ai-key";
import { householdDate } from "@/db/account";
import { addMemory, deleteMemory, listMemory } from "@/db/memory";
import { removeBill } from "@/db/bills";
import { confirmPending } from "@/db/confirm";
import { loadMoneyState } from "@/db/household";
import { createSpace, generalSpace, saveBrief } from "@/db/spaces";
import { BriefSchema } from "@/lib/agent/brief";
import { seedBen } from "@/db/seed";
import { AgentError, askBudgetMs, runAgent } from "@/lib/agent/run";
import { toolInputSchema, tools } from "@/lib/agent/tools";
import { dueAnswer, statusAnswer } from "@/lib/money/ask";
import { addDays, low, medianLow, safeToSpend, series } from "@/lib/money/runway";
import { createHousehold, setupForm } from "@/db/account";
import { billInput, insertBill } from "@/db/bills";
import { MODEL_RULES } from "@/lib/agent/rules";
import { THINKING_WORDS, TOOL_WORDS, toolWords } from "@/lib/agent/words";
import { answerQuestion, askInput, assembleContext } from "@/db/ask";
import { askScreenForPath } from "@/lib/agent/screen";
import { RecipeSchema } from "@/lib/canvas/schema";
import { whatIf } from "@/lib/money/whatif";
import { billsForMonth, type PeriodBill } from "@/lib/money/period";
import { dayView } from "@/lib/money/window";
import { latestDate } from "@/lib/money/horizon";
import { homeSentence } from "@/lib/money/sentence";
import { minorPerUnit } from "@/lib/money/format";
import { canvasWords, FIXED } from "@/lib/agent/reply";
import { changeStandingRule } from "@/db/rules";
import { savePot } from "@/db/pots";
import { addMember } from "@/db/people";
import { planFor, planLine } from "@/lib/money/plan";
import { HouseholdSnapshot } from "@/lib/schema/household";
import { InputError } from "@/db/input-error";
import { DEVICE_MEMORY_WORDS } from "@/db/place";
import { applyMemoryChanges, MAX_MEMORY_CHANGES } from "@/lib/store/memory-ops";
import type { MemoryItem } from "@/lib/schema/memory";
import { DEVICE_MEMORY_SOURCE_LABEL, type ConversationTurn } from "@/lib/schema/turn";

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
    assert.equal(request.headers.get("x-api-key"), KEY);
    assert.equal(request.redirect, "manual");
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

// The OpenAI-compatible protocol (D56): Chat Completions, with a household-chosen address.
const OPENAI_HOST = "llm.example", OPENAI_BASE = "https://llm.example/v1", OPENAI_KEY = "fictional-openai-key-" + "b".repeat(20);
type ChatBody = { model: string; max_tokens?: number; max_completion_tokens?: number; tool_choice?: unknown;
  tools?: { type: string; function: { name: string; description: string; parameters: Record<string, unknown> } }[];
  messages: { role: string; content?: string | Block[] | null; tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[]; tool_call_id?: string }[] };
const chatCall = (id: string, name: string, args: unknown) => ({ id, type: "function", function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } });
const chat = (finish_reason: string, content: string | null, tool_calls?: unknown[]) => Response.json({
  id: "chatcmpl-fixture", object: "chat.completion", created: 1, model: "fixture-text",
  choices: [{ index: 0, finish_reason, message: { role: "assistant", content, ...(tool_calls && { tool_calls }) } }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});
function chatTransport(script: ((bodies: ChatBody[]) => Response)[] | ((bodies: ChatBody[]) => Response)) {
  const bodies: ChatBody[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    assert.equal(new URL(request.url).host, OPENAI_HOST);
    assert.equal(new URL(request.url).pathname, "/v1/chat/completions");
    assert.equal(request.method, "POST");
    assert.equal(request.headers.get("authorization"), "Bearer " + OPENAI_KEY);
    bodies.push(await request.json());
    const next = Array.isArray(script) ? script[bodies.length - 1] : script;
    assert.ok(next, "unexpected extra model call");
    return next(bodies);
  }) as typeof globalThis.fetch;
  return { fetch, bodies };
}
const toolMessages = (body: ChatBody) => body.messages.filter(m => m.role === "tool") as { tool_call_id: string; content: string }[];

const AI_NAMES = ["AI_PROTOCOL", "AI_BASE_URL", "AI_API_KEY", "AI_TEXT_MODEL", "ASK_BUDGET_MS"];
const KEY = "sk-ant-fictional-" + "a".repeat(40);
const APP = new URL("http://127.0.0.1:3123");

async function main() {
  const pg = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(pg, { schema });
  const saved = Object.fromEntries(AI_NAMES.map(name => [name, process.env[name]]));
  const budgetProbe = process.argv.includes("--ask-budget-check");
  if (!budgetProbe) delete process.env.ASK_BUDGET_MS;
  let passed = 0;
  const realInfo = console.info;
  async function check(name: string, run: () => Promise<void>) { await run(); passed++; console.log(`✓ ${name}`); }
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    process.env.AI_PROTOCOL = "anthropic";
    process.env.AI_API_KEY = KEY;
    process.env.AI_TEXT_MODEL = "fixture-text";
    const a = await seedBen(db, { isDemo: true }), b = await seedBen(db, { isDemo: true });
    await db.update(schema.clients).set({ name: "ZZ Secret Client" }).where(eq(schema.clients.householdId, b));
    const stateOf = async (hid: string) => loadMoneyState(db, hid, await householdDate(db, hid));
    const aState = await stateOf(a), bState = await stateOf(b);
    // The one log line per Ask (D50) is captured here instead of printed.
    const logged: Record<string, unknown>[] = [];
    console.info = (...args: unknown[]) => { const first = String(args[0]); if (first.startsWith('{"at":')) logged.push(JSON.parse(first)); else realInfo(...args); };
    const ask = (hid: string, question: string, fetch: typeof globalThis.fetch, extra: { now?: () => number; source?: "voice" | "manual"; askId?: string; onStep?: (step: string) => void } = {}) =>
      runAgent({ db, householdId: hid, question, askId: extra.askId ?? crypto.randomUUID(), appUrl: APP, connection: () => aiConnection(db, hid, "text"), fetch, ...extra });

    if (budgetProbe) {
      assert.equal(askBudgetMs(), 1_250);
      process.env.ASK_BUDGET_MS = "9000";
      let clock = 0;
      const model = transport(() => {
        clock = 1_250;
        return reply("tool_use", [toolUse("due", "whats_due", {})]);
      });
      await assert.rejects(ask(a, "What’s due?", model.fetch, { now: () => clock }),
        (error: unknown) => error instanceof AgentError && error.outcome === "budget");
      assert.equal(model.bodies.length, 1, "Ask uses the cached override for its deadline");
      return;
    }

    await check("Ask defaults to 20 seconds and uses the configured budget for its deadline", async () => {
      assert.equal(askBudgetMs(), 20_000);
      execFileSync(process.execPath, [...process.execArgv, process.argv[1], "--ask-budget-check"], {
        env: { ...process.env, ASK_BUDGET_MS: "1250" },
      });
    });

    await check("a question runs a tool, feeds the engine's own answer back, one model call per turn", async () => {
      const { fetch, bodies } = transport([
        () => reply("tool_use", [text("Checking."), toolUse("toolu_1", "whats_due", {})]),
        () => reply("end_turn", [text("Rent is due soon and covered.")]),
      ]);
      const result = await ask(a, "What's due?", fetch);
      assert.deepEqual(result, { kind: "answer", answer: "Rent is due soon and covered.", choices: null, recipe: null, sources: [{ label: "Coming up", href: "/#coming-up" }], links: [], pending: false, offers: [] });
      assert.equal(bodies.length, 2);
      const [first, second] = bodies;
      assert.equal(first.model, "fixture-text");
      assert.equal(first.max_tokens, 16000);
      assert.deepEqual(first.tool_choice, { type: "auto" });
      assert.deepEqual(first.output_config, { effort: "low" });
      assert.ok(!("thinking" in first) && !("temperature" in first));
      assert.ok(first.system.includes(aState.today) && first.system.includes("JPY"));
      assert.deepEqual(first.tools.map(t => t.name).sort(), tools.filter(t => t.name !== "update_brief").map(t => t.name).sort());
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

    await check("snapshot, spending and foreign costs share one read group; the snapshot is scoped, event-free and schema-valid", async () => {
      const { fetch, bodies } = transport([
        () => reply("tool_use", [
          toolUse("toolu_snap", "household_snapshot", {}),
          toolUse("toolu_spend", "month_by_category", { month: null }),
          toolUse("toolu_fx", "foreign_costs", {}),
        ]),
        () => reply("end_turn", [text("You have three clients.")]),
      ]);
      assert.equal((await ask(a, "What do I have set up?", fetch)).answer, "You have three clients.");
      const results = toolResults(bodies[1]);
      assert.deepEqual(results.map(result => [result.tool_use_id, Boolean(result.is_error)]),
        [["toolu_snap", false], ["toolu_spend", false], ["toolu_fx", false]]);
      const [result1] = results;
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
      const addBill = toolInputSchema(tools.find(t => t.name === "add_bill")!) as { properties: { repeat: unknown; next_amount: unknown; next_amount_from: unknown; cancel_by: unknown; repeat_until: unknown }; required: string[] };
      assert.ok(["repeat", "next_amount", "next_amount_from", "cancel_by", "repeat_until"].every(key => key in addBill.properties && addBill.required.includes(key)), "the D48 fields are required properties (nullable) of add_bill");
      assert.ok(!("monthly" in addBill.properties));
    });

    await check("tools only see the asking household: no other household's data in any tool output", async () => {
      const names = tools.filter(t => t.scope === "read").map(t => t.name);
      const calls = [...names.map((name, i) => toolUse(`r${i}`, name, name === "timeline" ? { scenario: "late" } : name === "can_i_spend" ? { amount_minor: 4000, card_id: null }
        : name === "plan_for" ? { target_minor: 1_200_000, target_date: "2027-03-31", monthly_minor: null, pot_id: null } : name === "search_history" ? { text: "ZZ Secret" } : {})),
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

    await check("27D: timeline with on answers one day up to two years ahead from the engine; a day past the horizon or before today is an error the model can read", async () => {
      const state = await loadMoneyState(db, a, aState.today);
      const direct = dayView(state, "worst", "2026-12-31");
      const rentDay = dayView(state, "worst", "2026-12-27");
      assert.ok(rentDay.events.some(e => e.kind === "bill"), "a bill on Dec 27, past the default window");
      const { fetch, bodies } = transport([
        () => reply("tool_use", [toolUse("a", "timeline", { scenario: "late", on: "2026-12-31" }), toolUse("b", "timeline", { scenario: "late", on: "2026-12-27" }), toolUse("c", "timeline", { scenario: "late", on: latestDate(aState.today) }),
          toolUse("d", "timeline", { scenario: "late", on: addDays(latestDate(aState.today), 1) }), toolUse("e", "timeline", { scenario: "late", on: addDays(aState.today, -1) }), toolUse("f", "timeline", { scenario: "late", on: "soon" })]),
        () => reply("end_turn", [text("ok")]),
      ]);
      await ask(a, "How much will I have on Dec 31?", fetch);
      const results = toolResults(bodies[1]);
      const [x, y, z] = results.slice(0, 3).map(r => JSON.parse(r.content));
      assert.equal(x.on, "2026-12-31");
      assert.equal(x.balanceAfterMinor, Math.round(direct.balance * minorPerUnit("JPY")));
      assert.deepEqual(x.events.map((e: { label: string }) => e.label), direct.events.map(e => e.label));
      assert.ok(y.events.some((e: { kind: string; amountMinor: number; direction: string }) => e.kind === "bill" && Number.isInteger(e.amountMinor) && e.direction === "out"));
      assert.equal(z.on, latestDate(aState.today));
      for (const r of results.slice(3)) assert.equal(r.is_error, true);
      assert.match(results[3].content, /two years/);
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

    await check("provider errors become fixed, secret-free messages", async () => {
      const unauthorised = transport(() => Response.json({ type: "error", error: { type: "authentication_error", message: KEY } }, { status: 401 }));
      await assert.rejects(ask(a, "x", unauthorised.fetch), (error: Error) => error instanceof AgentError && !error.message.includes("sk-ant") && /not accepted/.test(error.message));
      assert.equal(unauthorised.bodies.length, 1, "no retry");
    });

    await check("a missing model setting stops before any model call", async () => {
      delete process.env.AI_TEXT_MODEL;
      await assert.rejects(ask(a, "x", transport(() => reply("end_turn", [text("no")])).fetch), /AI_TEXT_MODEL is not set/);
      process.env.AI_TEXT_MODEL = "fixture-text";
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

    await check("foreign_costs (D62) is a read tool: Ben's payout costs with the catalogue guidance; a household with nothing foreign gets nothing: true and no guidance", async () => {
      const tool = tools.find(t => t.name === "foreign_costs")!;
      assert.equal(tool.scope, "read");
      const ben = await seedBen(db, { isDemo: true });
      const t = transport([() => reply("tool_use", [toolUse("fc", "foreign_costs", {})]), () => reply("end_turn", [text("ok")])]);
      const result = await ask(ben, "What do my foreign payments cost me?", t.fetch);
      const out = JSON.parse(toolResults(t.bodies[1])[0].content);
      assert.equal(out.nothing, false);
      assert.equal(out.months, 12);
      assert.ok(out.payouts.count > 0 && out.payouts.costMinor > 0 && out.payouts.perClient.length === 3);
      assert.deepEqual([out.payouts.count, out.payouts.grossMinor, out.payouts.receiveFeeMinor, out.payouts.markupMinor, out.payouts.costMinor, out.payouts.landedMinor], [16, 1_590_000, 65_913, 45_724, 111_637, 1_478_363], "Ben's sixteen paid USD invoices at ¥150");
      assert.deepEqual(out.payouts.perClient.map((c: { clientName: string; count: number; costMinor: number }) => [c.clientName, c.count, c.costMinor]), [["Acme Corp", 5, 52_545], ["Northwind", 5, 36_850], ["Beacon Studio", 6, 22_242]]);
      assert.equal(out.payouts.grossMinor - out.payouts.costMinor, out.payouts.landedMinor);
      assert.match(out.words.payouts, /through PayPal/);
      assert.equal(out.guidance.source.url, "https://www.paypal.com/jp/webapps/mpp/merchant-fees");
      assert.match(out.guidance.mustNotSay, /leave PayPal/);
      assert.ok(out.guidance.steps.length > 0 && out.guidance.traps.length > 0 && out.guidance.maySay);
      assert.deepEqual(result.sources?.map(x => "href" in x ? x.href : x.label), ["/clients"]);

      const bare = await seedBen(db, { isDemo: true });
      await db.update(schema.invoices).set({ paidOn: null, sentOn: null, status: "draft" }).where(eq(schema.invoices.householdId, bare));
      const none = transport([() => reply("tool_use", [toolUse("fc", "foreign_costs", {})]), () => reply("end_turn", [text("ok")])]);
      await ask(bare, "What do my foreign payments cost me?", none.fetch);
      const empty = JSON.parse(toolResults(none.bodies[1])[0].content);
      assert.equal(empty.nothing, true);
      assert.ok(!("guidance" in empty));
      assert.deepEqual([empty.payouts.count, empty.charges.count, empty.charges.items.length], [0, 0, 0]);
    });

    await check("log_charge with original_amount and original_currency (D62) stores the original and the issuer's rate, not estimated; only one of the two is a tool error; the same currency as the card is refused", async () => {
      const c = await seedBen(db, { isDemo: true });
      const cState = await stateOf(c);
      const base = { cardId: cState.cards[0].id, merchant: "Fictional airline", amount: "3090", date: cState.today };
      const id = crypto.randomUUID();
      const t = transport([
        () => reply("tool_use", [toolUse("f", "log_charge", { ...base, id, original_amount: "20", original_currency: "USD" })]),
        () => reply("end_turn", [text("Waiting in To check.")]),
      ]);
      await ask(c, "I paid $20 at the airline, ¥3,090 on my card", t.fetch);
      const [row] = await db.select().from(schema.charges).where(and(eq(schema.charges.householdId, c), eq(schema.charges.id, id)));
      assert.deepEqual([row.status, row.amountMinor, row.originalAmountMinor, row.originalCurrency, row.fxRateMicro, row.fxEstimated], ["pending", 3090, 2000, "USD", 154_500_000, false]);
      for (const bad of [{ original_currency: "USD" }, { original_amount: "20" }, { original_amount: "20", original_currency: "JPY" }]) {
        const failing = transport([
          () => reply("tool_use", [toolUse("f", "log_charge", { ...base, id: crypto.randomUUID(), ...bad })]),
          () => reply("end_turn", [text("Which card?")]),
        ]);
        await ask(c, "I paid in dollars", failing.fetch);
        assert.equal(toolResults(failing.bodies[1])[0].is_error, true, JSON.stringify(bad));
      }
      assert.equal((await db.select().from(schema.charges).where(and(eq(schema.charges.householdId, c), eq(schema.charges.merchant, "Fictional airline")))).length, 1);
      const bulk = transport([
        () => reply("tool_use", [toolUse("f", "log_charges", { items: [{ ...base, id: crypto.randomUUID(), merchant: "Fictional hotel", original_amount: "10", original_currency: "USD" }] })]),
        () => reply("end_turn", [text("ok")]),
      ]);
      await ask(c, "A hotel in dollars", bulk.fetch);
      const [hotel] = await db.select().from(schema.charges).where(and(eq(schema.charges.householdId, c), eq(schema.charges.merchant, "Fictional hotel")));
      assert.deepEqual([hotel.originalAmountMinor, hotel.originalCurrency, hotel.fxRateMicro], [1000, "USD", 309_000_000]);
      assert.match(MODEL_RULES, /foreign_costs/);
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

    await check("add_bill takes repeat_until (D41): a gym that ends waits in To check with it, a one-off with a last payment is an error the model can read, and after Confirm it counts to the last payment only", async () => {
      const billId = crypto.randomUUID();
      const gym = { id: billId, biller: "Fictional Kawa Gym", amount: "6000", due: "2026-11-27", category: "health", memberId: null, repeat: "month", repeat_until: "2026-12-27" };
      const run = transport([() => reply("tool_use", [toolUse("g", "add_bill", gym)]), () => reply("end_turn", [text("Waiting in To check.")])]);
      const result = await ask(a, "Kawa Gym is 6000 a month and ends after December.", run.fetch);
      assert.equal(result.pending, true);
      const [row] = await db.select().from(schema.bills).where(and(eq(schema.bills.householdId, a), eq(schema.bills.id, billId)));
      assert.deepEqual([row.status, row.repeatUnit, row.repeatUntil], ["pending", "month", "2026-12-27"]);
      assert.ok((await loadMoneyState(db, a, "2026-11-14")).bills.filter(b => b.id.startsWith(billId)).every(b => b.status === "pending"), "it counts for nothing until confirmed");
      const bad = transport([() => reply("tool_use", [toolUse("h", "add_bill", { ...gym, id: crypto.randomUUID(), repeat: null })]), () => reply("end_turn", [text("Done.")])]);
      await ask(a, "Add it as a one-off with a last payment.", bad.fetch);
      assert.match(JSON.stringify(toolResults(bad.bodies[1])[0].content), /A last payment needs a bill that repeats/);
      await confirmPending(db, a, "bill", billId);
      assert.deepEqual((await loadMoneyState(db, a, "2026-11-14")).bills.filter(b => b.id.startsWith(billId)).map(b => [b.status, b.due]), [["confirmed", "2026-11-27"]], "counted after Confirm (the plan window ends before Dec 27; the stop itself is in doors-test)");
      await removeBill(db, a, billId);
    });

    await check("add_bill takes period_start and period_end (27F): the bill waits with them, and after Confirm the month view and search_spending name the month it covers while counting on the paid date", async () => {
      const c = await seedBen(db, { isDemo: true });
      const billId = crypto.randomUUID();
      const power = { id: billId, biller: "Fictional Electric", amount: "7300", due: "2026-11-10", category: "utilities", memberId: null, period_start: "2026-10-01", period_end: "2026-10-31" };
      const run = transport([() => reply("tool_use", [toolUse("p", "add_bill", power)]), () => reply("end_turn", [text("Waiting in To check.")])]);
      assert.equal((await ask(c, "October's electricity was 7300, paid Nov 10.", run.fetch)).pending, true);
      const [row] = await db.select().from(schema.bills).where(and(eq(schema.bills.householdId, c), eq(schema.bills.id, billId)));
      assert.deepEqual([row.status, row.due, row.periodStart, row.periodEnd], ["pending", "2026-11-10", "2026-10-01", "2026-10-31"]);
      const bad = transport([() => reply("tool_use", [toolUse("q", "add_bill", { ...power, id: crypto.randomUUID(), period_start: "2026-11-01", period_end: "2026-10-01" })]), () => reply("end_turn", [text("Done.")])]);
      await ask(c, "Add it backwards.", bad.fetch);
      assert.match(JSON.stringify(toolResults(bad.bodies[1])[0].content), /must start on or before/);
      await confirmPending(db, c, "bill", billId);
      const search = tools.find(t => t.name === "search_spending")!, month = tools.find(t => t.name === "month_by_category")!;
      const ctx = { madeBy: "ask", db, householdId: c, state: () => stateOf(c), appUrl: APP } as never;
      const found = JSON.parse(await search.run(ctx, search.input.parse({ query: "electric", months: 1 }) as never));
      assert.deepEqual(found.months[0].items.map((i: { label: string; date: string; periodStart?: string; periodEnd?: string }) => [i.label, i.date, i.periodStart, i.periodEnd]), [["Fictional Electric", "2026-11-10", "2026-10-01", "2026-10-31"]], "counted on the paid date, with the period beside it");
      assert.match(await month.run(ctx, month.input.parse({ month: "2026-11" }) as never), /Fictional Electric \(for 10月分\) Nov 10 ¥7,300/);
    });

    await check("bills_for_month (D63): the pure rule finds a November bill due in December, a period across two months in both, and never a bill without a period", async () => {
      const bill = (id: string, biller: string, due: string | null, start: string, end: string, extra: Partial<PeriodBill> = {}): PeriodBill =>
        ({ id, biller, amountMinor: 9_800, currency: "JPY", due, periodStart: start, periodEnd: end, status: "confirmed", category: "utilities", ...extra });
      const bills = [
        bill("nov", "Harbor Energy", "2026-12-27", "2026-11-01", "2026-11-30"),
        bill("span", "Fictional Water", "2026-11-20", "2026-10-15", "2026-11-14", { amountMinor: 4_000, status: "pending" }),
        bill("unknown", "Harbor Gas", null, "2026-11-01", "2026-11-30", { amountMinor: null }),
        bill("usd", "Fictional Cloud", "2026-12-05", "2026-11-01", "2026-11-30", { amountMinor: 2_400, currency: "USD", category: "subscriptions" }),
      ];
      const nov = billsForMonth(bills, "2026-11"), dec = billsForMonth(bills, "2026-12"), oct = billsForMonth(bills, "2026-10");
      assert.deepEqual(nov.items.map(i => i.id), ["span", "usd", "nov", "unknown"], "by due date, not known last");
      assert.deepEqual(dec.items, [], "a November period is not December, though it is paid then");
      assert.match(dec.summary, /No bill names December 2026/);
      assert.deepEqual(oct.items.map(i => i.id), ["span"], "Oct 15 to Nov 14 is October too");
      assert.deepEqual(nov.items.map(i => i.periodLabel), ["Oct 15 – Nov 14", "11月分", "11月分", "11月分"]);
      assert.deepEqual(nov.totals, [{ currency: "JPY", totalMinor: 13_800, count: 2 }, { currency: "USD", totalMinor: 2_400, count: 1 }], "known amounts only, one total per currency");
      assert.match(nov.summary, /amount not known, due date not known/);
      assert.match(nov.summary, /waiting in To check/);
      assert.deepEqual(billsForMonth(bills, "2026-11", "ENERGY").items.map(i => i.id), ["span", "nov", "unknown"], "a recognized term matches its category");
      assert.deepEqual(billsForMonth(bills, "2026-11", "harbor").items.map(i => i.id), ["nov", "unknown"]);
      assert.match(nov.note, /month_by_category/);
      assert.deepEqual(billsForMonth([], "2026-11").items, []);
    });

    await check("bills_for_month (D63) on Ben's household: Harbor Energy's 11月分 bill due Dec 27 is found for 2026-11 and not for 2026-12; a bill with no period is not listed; the sample numbers do not change", async () => {
      const c = await seedBen(db, { isDemo: true });
      const tool = tools.find(t => t.name === "bills_for_month")!;
      assert.equal(tool.scope, "read");
      assert.deepEqual((toolInputSchema(tool) as unknown as { required: string[] }).required.sort(), ["month", "text"], "strict schema: both listed");
      assert.throws(() => tool.input.parse({ month: "2026-13" }));
      assert.ok(TOOL_WORDS.bills_for_month);
      const before = await stateOf(c);
      const billId = crypto.randomUUID();
      await insertBill(db, c, billInput.parse({ id: billId, biller: "Harbor Energy", amount: "9800", due: "2026-12-27", category: "utilities", memberId: null, periodStart: "2026-11-01", periodEnd: "2026-11-30" }), "confirmed", { madeBy: "ask" });
      const pendingId = crypto.randomUUID();
      await insertBill(db, c, billInput.parse({ id: pendingId, biller: "Harbor Energy Gas", amount: "3100", due: "2026-12-27", category: "utilities", memberId: null, periodStart: "2026-11-01", periodEnd: "2026-11-30" }), "pending", { madeBy: "ask" });
      const ctx = { madeBy: "ask", db, householdId: c, state: () => stateOf(c), appUrl: APP } as never;
      const nov = JSON.parse(await tool.run(ctx, tool.input.parse({ month: "2026-11", text: "" }) as never));
      assert.deepEqual(nov.items.map((i: { biller: string; amountMinor: number; currency: string; due: string; periodStart: string; periodEnd: string; periodLabel: string; status: string; category: string }) => [i.biller, i.amountMinor, i.currency, i.due, i.periodStart, i.periodEnd, i.periodLabel, i.status, i.category]),
        [["Harbor Energy", 9_800, "JPY", "2026-12-27", "2026-11-01", "2026-11-30", "11月分", "confirmed", "utilities"], ["Harbor Energy Gas", 3_100, "JPY", "2026-12-27", "2026-11-01", "2026-11-30", "11月分", "pending", "utilities"]]);
      assert.deepEqual(nov.totals, [{ currency: "JPY", totalMinor: 12_900, count: 2 }]);
      assert.match(nov.summary, /Harbor Energy \(11月分\): ¥9,800, due Dec 27/);
      const dec = JSON.parse(await tool.run(ctx, tool.input.parse({ month: "2026-12", text: "" }) as never));
      assert.deepEqual(dec.items, [], "counted by the due date elsewhere; not listed for December here");
      assert.deepEqual(JSON.parse(await tool.run(ctx, tool.input.parse({ month: "2026-11", text: "gas" }) as never)).items.map((i: { biller: string }) => i.biller), ["Harbor Energy", "Harbor Energy Gas"]);
      const noPeriod = JSON.parse(await tool.run(ctx, tool.input.parse({ month: "2026-11", text: "rent" }) as never));
      assert.deepEqual(noPeriod.items, [], "Ben's rent has no period");
      assert.match(noPeriod.note, /month_by_category/);
      await assert.rejects(() => tool.run(ctx, tool.input.parse({ month: "2029-01", text: "" }) as never), (error: unknown) => error instanceof InputError);
      // The model path: the tool is called by name and its words are shown.
      const run = transport([() => reply("tool_use", [toolUse("b", "bills_for_month", { month: "2026-11", text: "electricity" })]), () => reply("end_turn", [text("It was ¥9,800.")])]);
      await ask(c, "What was November's electricity?", run.fetch);
      assert.match(JSON.stringify(toolResults(run.bodies[1])[0].content), /Harbor Energy \(11月分\): ¥9,800, due Dec 27/);
      await removeBill(db, c, billId); await removeBill(db, c, pendingId);
      assert.deepEqual((await stateOf(c)).bills.map(b => [b.id, b.due, b.amount]), before.bills.map(b => [b.id, b.due, b.amount]), "the period never changed what the engine counts");
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
      assert.deepEqual(asked, { kind: "answer", answer: "It takes about ¥300,000 a month.", choices: null, recipe: null, sources: [{ label: "Plan", href: "/plan" }], links: [], pending: false, offers: [] });
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
      assert.deepEqual(Object.keys(line).sort(), ["askId", "at", "canvas", "householdId", "inputTokens", "kind", "ms", "outcome", "outputTokens", "own", "protocol", "source", "stop", "tools", "turns"]);
      assert.deepEqual([line.kind, line.canvas], ["answer", false]);
      assert.deepEqual([line.at, line.householdId, line.askId, line.source, line.stop, line.turns, line.outcome, line.inputTokens, line.outputTokens, line.protocol, line.own], ["ask", a, askId, "manual", "end", 2, "answer", 2, 2, "anthropic", false]);
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
      assert.deepEqual(logged.map(l => [l.outcome, l.stop]), [["refusal", "refusal"], ["empty", "end"], ["turns", "tools"], ["api_error", "api_error"]]);
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


    // The same Ask code on the other protocol: only the connection and the wire format differ (D56).
    const onOpenai = async (run: () => Promise<void>) => {
      process.env.AI_PROTOCOL = "openai"; process.env.AI_BASE_URL = OPENAI_BASE; process.env.AI_API_KEY = OPENAI_KEY;
      try { await run(); } finally { process.env.AI_PROTOCOL = "anthropic"; process.env.AI_API_KEY = KEY; delete process.env.AI_BASE_URL; }
    };

    await check("openai protocol: a read answer and a tool round; the request shape and the tool result", async () => {
      await onOpenai(async () => {
        const read = chatTransport([() => chat("stop", "You are fine.")]);
        const plain = await ask(a, "Am I fine?", read.fetch);
        assert.deepEqual([plain.kind, plain.answer], ["declined", FIXED.off_topic], "the model ended with text and used no tool: the fixed sentence, not its words");
        const [first] = read.bodies;
        assert.equal(first.model, "fixture-text");
        assert.equal(first.max_tokens, 16000, "an unlisted address gets max_tokens");
        assert.equal(first.max_completion_tokens, undefined);
        assert.equal(first.tool_choice, undefined);
        assert.deepEqual(first.messages.map(m => m.role), ["system", "user"]);
        assert.ok(String(first.messages[0].content).includes(aState.today));
        assert.equal(first.messages[1].content, "Am I fine?");
        assert.deepEqual(first.tools!.map(t => t.function.name).sort(), tools.filter(t => t.name !== "update_brief").map(t => t.name).sort());
        assert.ok(first.tools!.every(t => t.type === "function" && t.function.parameters.additionalProperties === false));

        const c = await seedBen(db, { isDemo: true }), cState = await stateOf(c);
        const { fetch, bodies } = chatTransport([
          () => chat("tool_calls", "Checking.", [chatCall("call_1", "whats_due", {})]),
          () => chat("stop", "Rent is due soon and covered."),
        ]);
        assert.deepEqual(await ask(c, "What's due?", fetch), { kind: "answer", answer: "Rent is due soon and covered.", choices: null, recipe: null, sources: [{ label: "Coming up", href: "/#coming-up" }], links: [], pending: false, offers: [] });
        assert.equal(bodies.length, 2);
        const second = bodies[1];
        assert.deepEqual(second.messages.map(m => m.role), ["system", "user", "assistant", "tool"]);
        assert.deepEqual(second.messages[2].tool_calls, [chatCall("call_1", "whats_due", {})]);
        assert.deepEqual(toolMessages(second), [{ role: "tool", tool_call_id: "call_1", content: dueAnswer(cState) }]);
      });
    });

    await check("openai protocol: a draft tool, an unknown tool and invalid arguments", async () => {
      await onOpenai(async () => {
        const draftId = crypto.randomUUID();
        const input = { id: draftId, clientId: aState.clients[0].id, item: "Poster layout", amount: "18.52", note: "" };
        const draft = chatTransport([() => chat("tool_calls", null, [chatCall("d", "draft_invoice", input)]), () => chat("stop", "I drafted it; review it before sending.")]);
        const result = await ask(a, "Draft an invoice for Poster layout.", draft.fetch);
        assert.deepEqual(result.links, [{ label: "Review invoice draft", href: `http://127.0.0.1:3123/invoices/${draftId}` }]);
        const [row] = await db.select().from(schema.invoices).where(and(eq(schema.invoices.householdId, a), eq(schema.invoices.id, draftId)));
        assert.equal(row.status, "draft");

        const { fetch, bodies } = chatTransport([
          () => chat("tool_calls", null, [chatCall("u1", "send_invoice", { id: "x" }), chatCall("u2", "can_i_spend", { amount_minor: -5, card_id: null }),
            chatCall("u3", "where_am_i", {}), chatCall("u4", "can_i_spend", "{not json")]),
          () => chat("stop", "I could only check your status."),
        ]);
        assert.equal((await ask(a, "Send the invoice now.", fetch)).answer, "I could only check your status.");
        const results = toolMessages(bodies[1]);
        assert.deepEqual(results.map(r => r.tool_call_id), ["u1", "u2", "u3", "u4"]);
        assert.deepEqual(results.map(r => r.content.startsWith("Error: ")), [true, true, false, true]);
        assert.equal(results[0].content, "Error: Unknown tool.");
        assert.match(results[3].content, /^Error: Invalid input for this tool: \(input\)$/, "arguments that are not JSON name the input, never its text");
      });
    });

    await check("openai protocol: the turn limit, a length stop, a refusal and a timeout", async () => {
      await onOpenai(async () => {
        const loop = chatTransport(() => chat("tool_calls", null, [chatCall("again", "where_am_i", {})]));
        await assert.rejects(ask(a, "Loop forever.", loop.fetch), AgentError);
        assert.equal(loop.bodies.length, 5);
        await assert.rejects(ask(a, "x", chatTransport(() => chat("length", "part")).fetch), /cut off/);
        await assert.rejects(ask(a, "x", chatTransport(() => chat("content_filter", null)).fetch), /declined/);
        await assert.rejects(ask(a, "x", chatTransport(() => chat("stop", "")).fetch), /no answer/);
        await assert.rejects(ask(a, "x", chatTransport(() => Response.json({ error: { message: OPENAI_KEY + " provider words" } }, { status: 401 })).fetch),
          (error: Error) => error instanceof AgentError && /not accepted/.test(error.message) && !error.message.includes(OPENAI_KEY));
        await assert.rejects(ask(a, "x", chatTransport(() => Response.json({}, { status: 429 })).fetch), /busy/);
        let n = 0;
        const hang = (async (_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        })) as typeof globalThis.fetch;
        logged.length = 0;
        // 10 ms of the 20 s budget left when the call starts
        await assert.rejects(ask(a, "x", hang, { now: () => (n++ < 2 ? 0 : 19_990) }), /too long/);
        assert.deepEqual([logged[0].outcome, logged[0].stop], ["api_error", "api_error"]);
      });
    });

    await check("the amount check, on both protocols: a confirmed amount passes, an invented one is refused and logged", async () => {
      const refusal = "The model gave an amount the app could not confirm from your numbers, so the answer is not shown. Ask again, or choose another model in Settings.";
      const question = "Can I spend ¥4,000 today?";
      const invented = "You have ¥123,457 left, so ¥4,000 is fine.";
      // anthropic
      const okA = transport([() => reply("tool_use", [toolUse("w", "where_am_i", {})]), () => reply("end_turn", [text("Yes, ¥4,000 is fine.")])]);
      assert.equal((await ask(a, question, okA.fetch)).answer, "Yes, ¥4,000 is fine.");
      const badA = transport([() => reply("tool_use", [toolUse("w", "where_am_i", {})]), () => reply("end_turn", [text(invented)])]);
      logged.length = 0;
      await assert.rejects(ask(a, question, badA.fetch), (error: Error) => error instanceof AgentError && error.message === refusal && error.outcome === "unconfirmed_amount");
      assert.deepEqual([logged[0].outcome, logged[0].protocol, logged[0].own], ["unconfirmed_amount", "anthropic", false]);
      // an amount that is in a tool result of this Ask passes
      const figures = await (async () => { const t = transport([() => reply("tool_use", [toolUse("w", "where_am_i", {})]), () => reply("end_turn", [text("ok")])]); await ask(a, "x", t.fetch); return toolResults(t.bodies[1])[0].content; })();
      const known = /¥([\d,]+)/.exec(figures)?.[0];
      assert.ok(known, "where_am_i names a yen amount");
      const okTool = transport([() => reply("tool_use", [toolUse("w", "where_am_i", {})]), () => reply("end_turn", [text(`You have ${known}.`)])]);
      assert.equal((await ask(a, "Where am I?", okTool.fetch)).answer, `You have ${known}.`);
      // openai
      await onOpenai(async () => {
        const ok = chatTransport([() => chat("tool_calls", null, [chatCall("w", "where_am_i", {})]), () => chat("stop", "Yes, ¥4,000 is fine.")]);
        assert.equal((await ask(a, question, ok.fetch)).answer, "Yes, ¥4,000 is fine.");
        const bad = chatTransport([() => chat("tool_calls", null, [chatCall("w", "where_am_i", {})]), () => chat("stop", invented)]);
        logged.length = 0;
        await assert.rejects(ask(a, question, bad.fetch), (error: Error) => error instanceof AgentError && error.message === refusal && error.outcome === "unconfirmed_amount");
        assert.deepEqual([logged[0].outcome, logged[0].protocol, logged[0].own, logged[0].stop], ["unconfirmed_amount", "openai", false, "end"]);
        const raw = JSON.stringify(logged[0]);
        for (const needle of [OPENAI_BASE, OPENAI_HOST, OPENAI_KEY, "fixture-text", question, "123,457"]) assert.ok(!raw.includes(needle), `the log line leaks ${needle}`);
      });
    });


    // ---------------------------------------------------------------- the reply kinds, the conversation and the decline limit (D60)
    process.env.APP_URL = APP.href;
    const conversation = (hid: string, question: string, fetch: typeof globalThis.fetch, extra: { conversationId?: string; canvas?: unknown; at?: Date } = {}) =>
      answerQuestion(db, hid, askInput.parse({ id: crypto.randomUUID(), conversationId: extra.conversationId ?? crypto.randomUUID(), text: question, source: "manual", canvas: extra.canvas ?? null }), { fetch, at: extra.at });
    const cashCanvas = (extra: unknown[] = []) => JSON.stringify({ version: 1, title: "Cash", blocks: [{ type: "number", label: "Cash today", query: { q: "cash" } }, ...extra] });
    const clarifyInput = { question: "Which Acme do you mean?", choices: ["Acme Studio", "Acme Labs"] };

    await check("D56: a question that looks like an API key is refused before any model call or write, with fixed words", async () => {
      const c = await seedBen(db, { isDemo: true });
      const never = transport(() => assert.fail("a pasted key must never reach a model"));
      const before = (await db.select().from(schema.conversationTurns).where(eq(schema.conversationTurns.householdId, c))).length;
      for (const pasted of ["sk-ant-api03-" + "f".repeat(40), "my key is sk-proj-" + "g".repeat(30), "gsk_" + "h".repeat(40), "AIza" + "i".repeat(35)]) {
        await assert.rejects(conversation(c, pasted, never.fetch), { message: "That looks like an API key. Paste it in Settings → Your AI model. It was not sent or saved." });
      }
      assert.equal((await db.select().from(schema.conversationTurns).where(eq(schema.conversationTurns.householdId, c))).length, before, "nothing was saved");
      assert.equal(looksLikeApiKey("How much should I keep for my risk-management-and-desk-booking costs this month?"), false, "words with sk- inside are fine");
    });

    await check("each kind of reply on the anthropic protocol: answer with a canvas, clarify, both declines and a plain text with no tool", async () => {
      const c = await seedBen(db, { isDemo: true });
      logged.length = 0;
      const withCanvas = transport([
        () => reply("tool_use", [toolUse("m", "make_canvas", { recipe: cashCanvas([{ type: "note", text: "A quiet month.", by: "you" }]) }), toolUse("w", "where_am_i", {})]),
        () => reply("end_turn", [text("Here is your cash.")]),
      ]);
      const shown = await conversation(c, "Show my cash", withCanvas.fetch);
      assert.equal(shown.kind, "answer");
      assert.equal(shown.text, "Here is your cash.");
      assert.equal(shown.canvas?.recipe.title, "Cash");
      assert.equal(shown.canvas?.blocks.length, 2, "the engine drew the blocks");
      assert.deepEqual(shown.sources, [{ label: "Your next 30 days", href: "/#next-30-days" }], "make_canvas adds no source; where_am_i adds its own");
      const note = shown.canvas!.recipe.blocks[1];
      assert.deepEqual(note.type === "note" ? note.by : null, "assistant", "a note the model wrote is always the assistant's");
      const summary = toolResults(withCanvas.bodies[1]).find(r => r.tool_use_id === "m")!.content;
      assert.ok(summary.includes("Cash today") && !summary.includes("A quiet month."), "the summary names the block and never a note's text");
      assert.deepEqual([logged.at(-1)!.kind, logged.at(-1)!.canvas], ["answer", true]);

      // an invalid recipe comes back as words and the last valid one is the canvas
      const bad = transport([
        () => reply("tool_use", [toolUse("m1", "make_canvas", { recipe: JSON.stringify({ version: 1, title: "X", blocks: [{ type: "number", label: "Cash", amount: 5, query: { q: "cash" } }] }) })]),
        () => reply("tool_use", [toolUse("m2", "make_canvas", { recipe: "{not json" })]),
        () => reply("tool_use", [toolUse("m3", "make_canvas", { recipe: cashCanvas() })]),
        () => reply("end_turn", [text("Done.")]),
      ]);
      const fixed = await conversation(c, "Show cash", bad.fetch);
      assert.ok(toolResults(bad.bodies[1])[0].is_error && toolResults(bad.bodies[2])[0].is_error);
      assert.equal(fixed.kind, "answer");
      assert.equal(fixed.canvas?.recipe.title, "Cash");

      const ask1 = transport([() => reply("tool_use", [toolUse("c", "clarify", clarifyInput)])]);
      const clarified = await conversation(c, "Invoice Acme", ask1.fetch);
      assert.deepEqual([clarified.kind, clarified.text, clarified.choices, clarified.canvas, clarified.sources], ["clarify", clarifyInput.question, clarifyInput.choices, null, []]);
      assert.equal(ask1.bodies.length, 1, "a clarifying question ends the question: no second model call");
      assert.deepEqual([logged.at(-1)!.kind, logged.at(-1)!.canvas], ["clarify", false]);

      for (const reason of ["off_topic", "not_offered"] as const) {
        const t = transport([() => reply("tool_use", [toolUse("o", "out_of_scope", { reason })])]);
        const declined = await conversation(c, "Tell me about a stock", t.fetch);
        assert.deepEqual([declined.kind, declined.text, declined.canvas, declined.sources, t.bodies.length], ["declined", FIXED[reason], null, [], 1]);
      }
      const none = transport([() => reply("end_turn", [text("Paris is lovely.")])]);
      const talk = await conversation(c, "Where should I travel?", none.fetch);
      assert.deepEqual([talk.kind, talk.text], ["declined", FIXED.off_topic], "text with no tool is replaced by the fixed sentence");
      assert.ok(!JSON.stringify(logged).includes("Paris"));
      assert.ok(tools.find(t => t.name === "clarify")!.scope === "ask" && tools.find(t => t.name === "out_of_scope")!.scope === "ask");
    });

    await check("each kind of reply on the openai protocol", async () => {
      await onOpenai(async () => {
        const c = await seedBen(db, { isDemo: true });
        const withCanvas = chatTransport([
          () => chat("tool_calls", null, [chatCall("m", "make_canvas", { recipe: cashCanvas() })]),
          () => chat("stop", "Here is your cash."),
        ]);
        const shown = await conversation(c, "Show my cash", withCanvas.fetch);
        assert.deepEqual([shown.kind, shown.canvas?.recipe.title], ["answer", "Cash"]);
        const ask1 = chatTransport([() => chat("tool_calls", null, [chatCall("c", "clarify", clarifyInput)])]);
        const clarified = await conversation(c, "Invoice Acme", ask1.fetch);
        assert.deepEqual([clarified.kind, clarified.choices, ask1.bodies.length], ["clarify", clarifyInput.choices, 1]);
        const off = chatTransport([() => chat("tool_calls", null, [chatCall("o", "out_of_scope", { reason: "not_offered" })])]);
        assert.deepEqual((({ kind, text: words }) => [kind, words])(await conversation(c, "Which fund?", off.fetch)), ["declined", FIXED.not_offered]);
        const none = chatTransport([() => chat("stop", "Paris is lovely.")]);
        assert.equal((await conversation(c, "Where should I travel?", none.fetch)).kind, "declined");
      });
    });

    await check("clarify stops the other calls in its turn", async () => {
      const c = await seedBen(db, { isDemo: true });
      logged.length = 0;
      const t = transport([() => reply("tool_use", [toolUse("w", "where_am_i", {}), toolUse("c", "clarify", clarifyInput), toolUse("d", "whats_due", {})])]);
      const result = await conversation(c, "What about Acme?", t.fetch);
      assert.equal(result.kind, "clarify");
      assert.equal(t.bodies.length, 1);
      assert.deepEqual((logged.at(-1)!.tools as { name: string }[]).map(x => x.name), ["clarify"], "only the clarify call ran");
      assert.deepEqual(result.sources, [], "a tool that did not run adds no source");
    });

    await check("an amount in a letter no tool gave refuses the reply; one from this question's tools passes", async () => {
      const c = await seedBen(db, { isDemo: true });
      const letter = (words: string) => cashCanvas([{ type: "letter", text: words }]);
      const bad = transport([
        () => reply("tool_use", [toolUse("m", "make_canvas", { recipe: letter("Please send $12,345 by Friday.") }), toolUse("w", "where_am_i", {})]),
        () => reply("end_turn", [text("The letter is on the canvas.")]),
      ]);
      await assert.rejects(conversation(c, "Write a letter to Acme", bad.fetch), (error: Error) => error instanceof AgentError && error.outcome === "unconfirmed_amount");
      const known = /¥([\d,]+)/.exec(statusAnswer(await stateOf(c)))?.[0];
      assert.ok(known);
      const good = transport([
        () => reply("tool_use", [toolUse("m", "make_canvas", { recipe: letter(`I have ${known} on hand.`) }), toolUse("w", "where_am_i", {})]),
        () => reply("end_turn", [text("The letter is on the canvas.")]),
      ]);
      assert.equal((await conversation(c, "Write a letter to Acme", good.fetch)).kind, "answer");
    });

    await check("Ask uses only a fixed screen name in the question context and omits the line without a screen", async () => {
      const question = {
        id: crypto.randomUUID(), conversationId: crypto.randomUUID(), text: "What should I check?", source: "manual", canvas: null,
      };
      const withScreen = askInput.parse({ ...question, screen: askScreenForPath("/to-check") });
      const line = "The person is asking from To check.";
      assert.equal((await assembleContext(db, a, withScreen)).context, line);
      assert.equal((await assembleContext(db, a, askInput.parse(question))).context, "");
      const model = transport([() => reply("tool_use", [toolUse("c", "clarify", { question: "Which item?", choices: ["The bill", "The charge"] })])]);
      await answerQuestion(db, a, withScreen, { fetch: model.fetch });
      assert.deepEqual(model.bodies[0].messages, [{ role: "user", content: `${question.text}\n\n${line}` }]);
    });

    await check("Ask screen paths reduce to known sections and the request refuses arbitrary screen text or ids", async () => {
      const rowId = crypto.randomUUID();
      assert.deepEqual(["/", "/canvas", "/to-check", `/cards/${rowId}`, `/clients/${rowId}`, `/invoices/${rowId}`, "/account"]
        .map(askScreenForPath), ["home", "canvas", "check", "cards", "clients", "invoices", "settings"]);
      for (const path of ["/family/example", "/join", "/__proto__", "/somewhere-else"]) {
        assert.equal(askScreenForPath(path), undefined, path);
      }
      const question = { id: crypto.randomUUID(), conversationId: crypto.randomUUID(), text: "Show me.", source: "manual", canvas: null };
      for (const screen of [rowId, `/cards/${rowId}`, "To check", "Ask from the card balance ¥8,900.", null]) {
        assert.ok(!askInput.safeParse({ ...question, screen }).success);
      }
    });

    await check("older turns within the character budget and the canvas reach the model; an amount from an earlier reply confirms nothing", async () => {
      const c = await seedBen(db, { isDemo: true });
      const conversationId = crypto.randomUUID();
      const t0 = new Date("2026-11-06T09:00:00Z");
      const minutes = (n: number) => new Date(t0.getTime() + n * 60_000);
      const round = async (question: string, at: Date, canvas: unknown = null) => {
        const t = transport([() => reply("tool_use", [toolUse("w", "where_am_i", {})]), () => reply("end_turn", [text("Fine.")])]);
        await conversation(c, question, t.fetch, { conversationId, at, canvas });
        return JSON.stringify(t.bodies[0].messages[0]);
      };
      assert.ok(!(await round("first question", t0)).includes("Earlier in this conversation"), "the first turn has no history");
      await round("second question", minutes(1));
      await round("third question", minutes(2));
      await round("fourth question", minutes(3));
      const fifth = await round("fifth question", minutes(5), JSON.parse(cashCanvas()));
      assert.ok(fifth.includes("Earlier in this conversation, for context only; read every number again from the tools:"));
      for (const q of ["second question", "third question", "fourth question"]) assert.ok(fifth.includes(q), q);
      assert.ok(fifth.includes("first question"), "the tail has no turn count cap");
      assert.ok(fifth.includes("The canvas on screen now, as data:") && fifth.includes("Cash today"));
      const late = await round("late question", minutes(5 + 11));
      assert.ok(late.includes("Earlier in this conversation"), "older context stays after ten minutes");

      // an amount only an earlier reply held is not confirmed
      const d = await seedBen(db, { isDemo: true });
      const thread = crypto.randomUUID();
      const first = transport([() => reply("tool_use", [toolUse("c", "clarify", { question: "Did you mean the ¥7,777 bill?", choices: ["Yes", "No"] })])]);
      await conversation(d, "Is the ¥7,777 bill due?", first.fetch, { conversationId: thread, at: t0 });
      const second = transport([() => reply("tool_use", [toolUse("w", "where_am_i", {})]), () => reply("end_turn", [text("Yes, the ¥7,777 bill is covered.")])]);
      await assert.rejects(conversation(d, "Yes", second.fetch, { conversationId: thread, at: minutes(1) }), (error: Error) => error instanceof AgentError && error.outcome === "unconfirmed_amount");
      assert.ok(JSON.stringify(second.bodies[0].messages[0]).includes("7,777"), "the earlier reply was shown to the model as context");
    });

    await check("CONV-010: a confirmed Nov 19 bill changes the same week's follow-up", async () => {
      const hid = await seedBen(db, { isDemo: true });
      const { id: conversationId } = await generalSpace(db, hid);
      const bill = "Kumo Water";
      const askWeek = async (question: string, includesBill: boolean) => {
        const model = transport([
          () => reply("tool_use", [toolUse("t", "timeline", { scenario: "as_usual" })]),
          () => reply("end_turn", [text(includesBill ? "Kumo Water is also due this week." : "I checked what is due this week.")]),
        ]);
        const answer = await conversation(hid, question, model.fetch, { conversationId });
        const [result] = toolResults(model.bodies[1]);
        const events: { label: string; date: string; amountMinor: number }[] = JSON.parse(result.content).events;
        const week = events.filter(event => event.date >= "2026-11-14" && event.date <= "2026-11-21");
        const matched = week.find(event => event.label === bill);
        assert.equal(Boolean(matched), includesBill);
        if (matched) assert.deepEqual([matched.date, Math.abs(matched.amountMinor)], ["2026-11-19", 2500]);
        return answer;
      };
      const first = await askWeek("What's due this week?", false);
      await insertBill(db, hid, billInput.parse({ id: crypto.randomUUID(), biller: bill, amount: "2500", due: "2026-11-19", category: "utilities" }),
        "confirmed", { madeBy: "form" });
      const next = await askWeek("And again, what's due?", true);
      assert.notEqual(next.text, first.text);
      assert.match(next.text, /Kumo Water/);
    });

    await check("the checked space brief is saved after the answer and appears on the next question", async () => {
      const hid = await seedBen(db, { isDemo: true });
      const general = await generalSpace(db, hid);
      await saveBrief(db, hid, general.id, { about: "Original brief" }, "form");
      const askInSpace = (fetch: typeof globalThis.fetch, text: string) => answerQuestion(db, hid, askInput.parse({
        id: crypto.randomUUID(), conversationId: general.id, spaceId: general.id, text, source: "manual", canvas: null,
      }), { fetch });
      const propose = (value: unknown) => transport([
        () => reply("tool_use", [toolUse("w", "where_am_i", {}), toolUse("b", "update_brief", value)]),
        () => reply("end_turn", [text("I checked the forecast.")]),
      ]);

      const unconfirmed = propose({ about: "Invented ¥7,777", state: [{ text: "Pending", source: "where_am_i" }] });
      const refused = await askInSpace(unconfirmed.fetch, "Check the forecast for ¥7,777.");
      assert.equal(refused.brief, undefined, "an amount in the question alone does not confirm a brief");
      assert.equal(logged.at(-1)?.briefDropped, "unconfirmed_amount");
      assert.doesNotMatch(JSON.stringify(logged.at(-1)), /Invented|7,777/);
      assert.equal((await generalSpace(db, hid)).brief.about, "Original brief");
      assert.equal(BriefSchema.safeParse({ about: "1234 5678 9012" }).success, false);
      assert.equal(BriefSchema.safeParse({ about: "x".repeat(2000) }).success, false);

      const checked = propose({ about: "Checked cash", state: [{ text: "Late payments leave a ¥18,780 shortfall.", source: "where_am_i" }] });
      const kept = await askInSpace(checked.fetch, "Check today's cash.");
      assert.equal(kept.brief?.updatedBy, "ask");
      assert.equal((await generalSpace(db, hid)).brief.about, "Checked cash");
      const audit = await db.select().from(schema.events).where(and(eq(schema.events.householdId, hid), eq(schema.events.kind, "brief_updated")));
      assert.equal(audit.length, 2);
      assert.ok(audit.every(event => event.body === null && !event.title.includes("Checked cash")));

      const followup = transport([() => reply("tool_use", [toolUse("w", "where_am_i", {})]), () => reply("end_turn", [text("Here is the latest.")])]);
      await askInSpace(followup.fetch, "What about today?");
      assert.match(JSON.stringify(followup.bodies[0].system), /Space brief.*Checked cash/);
    });

    await check("notes read through recall or history are valid brief sources and unread note ids are dropped", async () => {
      const hid = await seedBen(db, { isDemo: true });
      const here = await generalSpace(db, hid);
      const other = await createSpace(db, hid, "Fictional records");
      const note = await addMemory(db, hid, { kind: "fact", text: "Receipt is in the blue folder.", spaceId: other.id }, { madeBy: "form" });
      const state = [{ text: note.text, source: note.id }];
      const askWith = (name: string, args: object) => {
        const model = transport([
          () => reply("tool_use", [toolUse("read", name, args), toolUse("brief", "update_brief", { state })]),
          () => reply("end_turn", [text("I checked the notes.")]),
        ]);
        return answerQuestion(db, hid, askInput.parse({
          id: crypto.randomUUID(), conversationId: here.id, spaceId: here.id, text: "Check the blue folder note and update the brief.", source: "manual", canvas: null,
        }), { fetch: model.fetch });
      };
      assert.equal((await askWith("where_am_i", {})).brief, undefined);
      assert.equal(logged.at(-1)?.briefDropped, "invalid_source");
      const dropped = JSON.stringify(logged.at(-1));
      assert.ok(!dropped.includes(note.id) && !dropped.includes(note.text));
      for (const [name, args] of [["recall", { space: other.name }], ["search_history", { text: "blue folder", space: other.name }]] as const) {
        assert.deepEqual((await askWith(name, args)).brief?.brief.state, state, name);
        assert.equal(logged.at(-1)?.briefDropped, undefined, name);
      }
      assert.deepEqual((await generalSpace(db, hid)).brief.state, state);
    });

    await check("the profile and current note reach Ask, and Based on names only the memory item it cited", async () => {
      const hid = await seedBen(db, { isDemo: true });
      const here = await createSpace(db, hid, "Fictional tax desk"), elsewhere = await createSpace(db, hid, "Fictional repair desk");
      await addMemory(db, hid, { kind: "fact", text: "Profile says to use Japanese." }, { madeBy: "form" });
      const note = await addMemory(db, hid, { kind: "fact", text: "Keep the tax receipt in the March folder and group the other receipts by client.", spaceId: here.id }, { madeBy: "form" });
      const other = await addMemory(db, hid, { kind: "fact", text: "An unrelated repair note.", spaceId: elsewhere.id }, { madeBy: "form" });
      const model = transport([
        () => reply("tool_use", [toolUse("w", "where_am_i", {})]),
        () => reply("end_turn", [text(`Keep the receipt in March. [[memory:${note.id}]] [[memory:${other.id}]]`)]),
      ]);
      const input = askInput.parse({ id: crypto.randomUUID(), conversationId: here.id, spaceId: here.id, text: "Where does the tax receipt go?", source: "manual", canvas: null });
      const answer = await answerQuestion(db, hid, input, { fetch: model.fetch });
      const prompt = JSON.stringify(model.bodies[0].system);
      assert.ok(prompt.indexOf("Profile says") < prompt.indexOf("Keep the tax receipt") && prompt.includes("Profile says"));
      assert.ok(!prompt.includes("unrelated repair"));
      assert.equal(answer.text, "Keep the receipt in March.");
      const sources = [{ kind: "memory", id: note.id, label: note.text.slice(0, 59) + "…" }];
      assert.ok(note.text.length > 60);
      assert.deepEqual(answer.sources.filter(source => "id" in source), sources);
      const replay = await answerQuestion(db, hid, input, { fetch: transport([]).fetch });
      assert.deepEqual(replay.sources.filter(source => "id" in source), sources);
      assert.equal(await deleteMemory(db, hid, note.id, { madeBy: "form" }), true);
      const afterDelete = await answerQuestion(db, hid, input, { fetch: transport([]).fetch });
      assert.equal(afterDelete.text, answer.text);
      assert.deepEqual(afterDelete.sources.filter(source => "id" in source), sources);
    });

    await check("a cloud journal never stores the citation text of device-only memory", async () => {
      const hid = await seedBen(db, { isDemo: true });
      const space = await generalSpace(db, hid);
      await db.update(schema.households).set({ memoryPlace: "device" }).where(eq(schema.households.id, hid));
      const stamp = new Date().toISOString();
      const note = { id: crypto.randomUUID(), kind: "fact", text: "Local fictional receipt note.", madeBy: "form", askId: null, createdAt: stamp, updatedAt: stamp } as const;
      const model = transport([
        () => reply("tool_use", [toolUse("w", "where_am_i", {})]),
        () => reply("end_turn", [text(`I found the note. [[memory:${note.id}]]`)]),
      ]);
      const input = askInput.parse({ id: crypto.randomUUID(), conversationId: space.id, spaceId: space.id, text: "Find the note.", source: "manual", canvas: null, memory: [note] });
      assert.equal((await answerQuestion(db, hid, input, { fetch: model.fetch })).sources.at(-1)?.label, note.text);
      const [saved] = await db.select({ sources: schema.conversationTurns.sources }).from(schema.conversationTurns)
        .where(and(eq(schema.conversationTurns.householdId, hid), eq(schema.conversationTurns.id, input.id)));
      assert.ok(!JSON.stringify(saved.sources).includes(note.text));
      assert.ok(JSON.stringify(saved.sources).includes(DEVICE_MEMORY_SOURCE_LABEL));
    });

    await check("remember and Keep choose notes for this task and the profile for an explicit always", async () => {
      const hid = await seedBen(db, { isDemo: true });
      const here = await createSpace(db, hid, "Fictional paperwork");
      const askHere = (text: string, fetch: typeof globalThis.fetch) => answerQuestion(db, hid, askInput.parse({
        id: crypto.randomUUID(), conversationId: here.id, spaceId: here.id, text, source: "manual", canvas: null,
      }), { fetch });
      const remember = (words: string) => transport([
        () => reply("tool_use", [toolUse("r", "remember", { kind: "instruction", text: words })]),
        () => reply("end_turn", [text("I remembered it.")]),
      ]);
      const silent = remember("Do not write this silently.");
      await askHere("What is due?", silent.fetch);
      assert.equal(toolResults(silent.bodies[1])[0].is_error, true);
      assert.deepEqual(await listMemory(db, hid), []);
      await askHere("Remember the current invoice uses a blue label.", remember("Use a blue label for the current invoice.").fetch);
      await askHere("Always show due dates first. Remember that.", remember("Show due dates first.").fetch);
      const items = await listMemory(db, hid);
      assert.equal(items.find(item => item.text.startsWith("Use a blue"))?.spaceId, here.id);
      assert.equal(items.find(item => item.text.startsWith("Show due"))?.spaceId, undefined);
      const offer = () => transport([
        () => reply("tool_use", [toolUse("k", "offer_keep", { offer: { kind: "memory", memoryKind: "preference", text: "Use plain labels." } })]),
        () => reply("end_turn", [text("I can keep this.")]),
      ]);
      assert.deepEqual((await askHere("Use plain labels for this task.", offer().fetch)).offers, [{ kind: "memory", memoryKind: "preference", text: "Use plain labels.", spaceId: here.id }]);
      assert.deepEqual((await askHere("From now on, use plain labels.", offer().fetch)).offers, [{ kind: "memory", memoryKind: "preference", text: "Use plain labels." }]);
    });

    await check("Keep offers can assign an unchanged standing rule to the current space", async () => {
      const hid = await seedBen(db, { isDemo: true });
      const space = await createSpace(db, hid, "Fictional rule space");
      const value = { kind: "rule", ruleKind: "bill_ahead", enabled: true, value: "3" } as const;
      const askForRule = () => {
        const model = transport([
          () => reply("tool_use", [toolUse("o", "offer_keep", { offer: value })]),
          () => reply("end_turn", [text("I can keep that rule here.")]),
        ]);
        return answerQuestion(db, hid, askInput.parse({
          id: crypto.randomUUID(), conversationId: space.id, spaceId: space.id, text: "Remind me three days before a bill here.", source: "manual", canvas: null,
        }), { fetch: model.fetch });
      };
      assert.deepEqual((await askForRule()).offers, [{ ...value, spaceId: space.id }]);
      await changeStandingRule(db, hid, { ...value, spaceId: space.id });
      assert.deepEqual((await askForRule()).offers, [], "the same rule assigned here needs no second offer");
    });

    await check("an amount found in history still needs a current tool result", async () => {
      const hid = await seedBen(db, { isDemo: true });
      const space = await generalSpace(db, hid);
      const earlier = transport([() => reply("tool_use", [toolUse("c", "clarify", { question: "Did you mean the ¥7,777 fixture?", choices: ["Yes", "No"] })])]);
      const askHere = (text: string, fetch: typeof globalThis.fetch) => answerQuestion(db, hid, askInput.parse({
        id: crypto.randomUUID(), conversationId: space.id, spaceId: space.id, text, source: "manual", canvas: null,
      }), { fetch });
      await askHere("Was the ¥7,777 fixture due?", earlier.fetch);
      const later = transport([
        () => reply("tool_use", [toolUse("h", "search_history", { text: "fixture", space: "General" })]),
        () => reply("end_turn", [text("You owe ¥7,777.")]),
      ]);
      await assert.rejects(askHere("Find the old question.", later.fetch), (error: unknown) => error instanceof AgentError && error.outcome === "unconfirmed_amount");
      assert.ok(toolResults(later.bodies[1])[0].content.includes("7,777"));
    });

    await check("an ending tool that fails its schema is an ordinary tool error: the loop goes on and the answer is returned", async () => {
      const c = await seedBen(db, { isDemo: true });
      const badInputs: [string, unknown][] = [
        ["clarify", { question: "Which one?", choices: ["Only one"] }],
        ["clarify", { question: "Which one?", choices: ["a", "b", "c", "d", "e"] }],
        ["clarify", { question: "Which one?", choices: ["a", "x".repeat(61)] }],
        ["out_of_scope", { reason: "bored" }],
      ];
      for (const [name, input] of badInputs) {
        const t = transport([
          () => reply("tool_use", [toolUse("e", name, input)]),
          () => reply("end_turn", [text("Rent is due soon.")]),
        ]);
        // with no earlier tool the answer is still declined, but only because the model then called no tool, and the error went back to it
        const first = await conversation(c, "What is due?", t.fetch);
        assert.equal(t.bodies.length, 2, `${name}: the loop continued after the invalid call`);
        assert.ok(toolResults(t.bodies[1])[0].is_error, `${name}: the error went back to the model`);
        assert.equal(first.kind, "declined", `${name}: no data tool was called, so the plain text is declined`);
        const withTool = transport([
          () => reply("tool_use", [toolUse("w", "whats_due", {}), toolUse("e", name, input)]),
          () => reply("end_turn", [text("Rent is due soon.")]),
        ]);
        const answered = await conversation(c, "What is due?", withTool.fetch);
        assert.deepEqual([answered.kind, answered.text], ["answer", "Rent is due soon."], `${name}: an invalid ending call does not end the question`);
        assert.equal(toolResults(withTool.bodies[1]).length, 2, "every call got a result");
      }
    });

    await check("a question whose only tool call errored is not declined as off topic", async () => {
      const c = await seedBen(db, { isDemo: true });
      const charge = { id: crypto.randomUUID(), cardId: crypto.randomUUID(), merchant: "Noodle place", amount: "3800", date: (await stateOf(c)).today };
      const t = transport([
        () => reply("tool_use", [toolUse("l", "log_charge", charge)]),
        () => reply("end_turn", [text("Which card was it?")]),
      ]);
      const result = await conversation(c, "I spent 3800 at the noodle place", t.fetch);
      assert.ok(toolResults(t.bodies[1])[0].is_error, "the call failed");
      assert.deepEqual([result.kind, result.text], ["answer", "Which card was it?"]);
      const none = transport([() => reply("end_turn", [text("Which card was it?")])]);
      assert.equal((await conversation(c, "I spent 3800 at the noodle place", none.fetch)).kind, "declined", "a reply with no tool call at all is still declined");
    });

    await check("a clarifying question and its choices are amount-checked like an answer", async () => {
      const c = await seedBen(db, { isDemo: true });
      const t = transport([() => reply("tool_use", [toolUse("c", "clarify", { question: "Which bill?", choices: ["The ¥7,777 bill", "Another"] })])]);
      await assert.rejects(conversation(c, "Which bill is due?", t.fetch), (error: Error) => error instanceof AgentError && error.outcome === "unconfirmed_amount");
      const asked = transport([() => reply("tool_use", [toolUse("c", "clarify", { question: "Did you mean ¥7,777?", choices: ["Yes", "No"] })])]);
      assert.equal((await conversation(c, "Is ¥7,777 due?", asked.fetch)).kind, "clarify", "an amount the person wrote passes");
    });

    await check("Keep this returns at most three distinct offers across the Ask, with no memory, goal, event or receipt write", async () => {
      const c = await seedBen(db, { isDemo: true });
      const memory = { kind: "memory", memoryKind: "preference", text: "Use short answers" };
      const goal = { kind: "goal", name: "Camera", target: "120000", targetDate: "2027-06-30" };
      const rule = { kind: "rule", ruleKind: "nudge_after", enabled: true, value: "5" };
      const t = transport([
        () => reply("tool_use", [toolUse("m", "offer_keep", { offer: memory }), toolUse("g", "offer_keep", { offer: goal })]),
        () => reply("tool_use", [toolUse("duplicate", "offer_keep", { offer: memory }), toolUse("rule", "offer_keep", { offer: rule }),
          toolUse("extra", "offer_keep", { offer: { kind: "memory", memoryKind: "fact", text: "Camera for work" } })]),
        () => reply("end_turn", [text("You can keep these for next time.")]),
      ]);
      const beforePots = await db.select().from(schema.pots).where(eq(schema.pots.householdId, c));
      const beforeEvents = await db.select().from(schema.events).where(eq(schema.events.householdId, c));
      const question = "I like short answers, want ¥120,000 for a camera by June 30 2027 and nudge at 5 days. Can you help?";
      const input = askInput.parse({ id: crypto.randomUUID(), conversationId: crypto.randomUUID(), text: question, source: "manual", canvas: null });
      const result = await answerQuestion(db, c, input, { fetch: t.fetch });
      assert.deepEqual(result.offers, [memory, goal, rule]);
      assert.deepEqual(result.memoryChanges, []);
      assert.deepEqual(await listMemory(db, c), []);
      assert.deepEqual(await db.select().from(schema.pots).where(eq(schema.pots.householdId, c)), beforePots);
      assert.deepEqual(await db.select().from(schema.events).where(eq(schema.events.householdId, c)), beforeEvents);
      assert.deepEqual(await db.select().from(schema.askReceipts).where(eq(schema.askReceipts.householdId, c)), []);
      assert.ok(t.bodies[0].system.includes("call remember only on an explicit request"));
      assert.equal(tools.find(tool => tool.name === "offer_keep")?.scope, "ask");
      assert.equal(toolResults(t.bodies[2]).find(result => result.tool_use_id === "extra")?.is_error, true);
      assert.deepEqual((await answerQuestion(db, c, input, { fetch: t.fetch })).offers, [], "offers are not kept in the journal");
    });

    await check("Keep this suppresses existing memory and goals and rejects long numbers, excessive text and invalid targets", async () => {
      const c = await seedBen(db, { isDemo: true });
      await addMemory(db, c, { kind: "preference", text: "Use short answers" }, { madeBy: "form" });
      await savePot(db, c, { id: crypto.randomUUID(), name: "Camera", target: "120000", targetDate: "2027-06-30", saved: "0", fillPct: null, memberId: null }, "confirmed", { madeBy: "form" });
      const t = transport([
        () => reply("tool_use", [
          toolUse("long-number", "offer_keep", { offer: { kind: "memory", memoryKind: "fact", text: "A number １２３４ ５６７８ ９０１２" } }),
          toolUse("long-text", "offer_keep", { offer: { kind: "memory", memoryKind: "fact", text: "a".repeat(401) } }),
          toolUse("invalid-target", "offer_keep", { offer: { kind: "goal", name: "Bicycle", target: "-100", targetDate: "2027-06-30" } }),
          toolUse("duplicate-memory", "offer_keep", { offer: { kind: "memory", memoryKind: "preference", text: "USE short answers" } }),
          toolUse("duplicate-pot", "offer_keep", { offer: { kind: "goal", name: "camera", target: "120000", targetDate: "2027-06-30" } }),
          toolUse("invented", "offer_keep", { offer: { kind: "goal", name: "Bicycle", target: "987654", targetDate: "2027-06-30" } }),
        ]),
        () => reply("end_turn", [text("The camera is already a goal.")]),
      ]);
      assert.deepEqual((await ask(c, "I like short answers. Is my ¥120,000 camera saved as a goal?", t.fetch)).offers, []);
      assert.deepEqual(toolResults(t.bodies[1]).filter(result => result.is_error).map(result => result.tool_use_id),
        ["long-number", "long-text", "invalid-target"]);
      assert.equal((await listMemory(db, c)).length, 1);
    });

    await check("Keep this checks the device's memory and current standing rules before returning offers", async () => {
      const c = await seedBen(db, { isDemo: true });
      await db.update(schema.households).set({ memoryPlace: "device", journalPlace: "device" }).where(eq(schema.households.id, c));
      const stamp = "2026-11-14T00:00:00.000Z";
      const memory: MemoryItem[] = [{
        id: crypto.randomUUID(), kind: "preference", text: "Use short answers", madeBy: "form", askId: null, createdAt: stamp, updatedAt: stamp,
      }];
      const newMemory = { kind: "memory", memoryKind: "preference", text: "Answer in Japanese" };
      const t = transport([
        () => reply("tool_use", [
          toolUse("existing-memory", "offer_keep", { offer: { kind: "memory", memoryKind: "preference", text: "Use short answers" } }),
          toolUse("current-rule", "offer_keep", { offer: { kind: "rule", ruleKind: "nudge_after", enabled: true, value: "3" } }),
          toolUse("new-memory", "offer_keep", { offer: newMemory }),
        ]),
        () => reply("end_turn", [text("I can help with that.")]),
      ]);
      const input = askInput.parse({
        id: crypto.randomUUID(), conversationId: crypto.randomUUID(), text: "I like short answers in Japanese. Can you nudge after three days?", source: "manual", canvas: null, memory, recent: [],
      });
      const result = await answerQuestion(db, c, input, { fetch: t.fetch });
      assert.deepEqual(result.offers, [newMemory]);
      assert.deepEqual(result.memoryChanges, [], "the device writes only after the person taps Keep");
      assert.deepEqual(await listMemory(db, c), []);
    });

    await check("Keep offers disappear from clarifications and cannot confirm an amount in the answer", async () => {
      const offer = toolUse("m", "offer_keep", { offer: { kind: "memory", memoryKind: "fact", text: "Payday is ¥987,654" } });
      const t = transport([() => reply("tool_use", [offer]), () => reply("end_turn", [text("Your payday is ¥987,654.")])]);
      await assert.rejects(ask(a, "What is my payday?", t.fetch), (error: unknown) => error instanceof AgentError && error.outcome === "unconfirmed_amount");
      const clarify = transport([
        () => reply("tool_use", [offer]),
        () => reply("tool_use", [toolUse("q", "clarify", { question: "Which payday?", choices: ["This month", "Next month"] })]),
      ]);
      const result = await ask(a, "What is my payday?", clarify.fetch);
      assert.equal(result.kind, "clarify");
      assert.deepEqual(result.offers, []);
    });

    await check("text a tool echoes from the model is not a source: remember and make_canvas cannot confirm an invented amount", async () => {
      const c = await seedBen(db, { isDemo: true });
      const remembered = transport([
        () => reply("tool_use", [toolUse("r", "remember", { kind: "fact", text: "Rent is ¥123,456" })]),
        () => reply("end_turn", [text("Your rent is ¥123,456.")]),
      ]);
      // remember is a write: its text is kept, the invented amount in the answer is not shown, and the reply says so
      const kept = await conversation(c, "Remember my rent", remembered.fetch);
      assert.ok(kept.text.startsWith(FIXED.savedThenStopped) && kept.text.includes("could not confirm") && !kept.text.includes("123,456"));
      const d = await seedBen(db, { isDemo: true });
      const noted = transport([
        () => reply("tool_use", [toolUse("m", "make_canvas", { recipe: cashCanvas([{ type: "number", label: "Rent", query: { q: "cash" }, note: "About ¥55,555 a month" }]) }), toolUse("w", "where_am_i", {})]),
        () => reply("end_turn", [text("Here it is.")]),
      ]);
      await assert.rejects(conversation(d, "Show my cash", noted.fetch), (error: Error) => error instanceof AgentError && error.outcome === "unconfirmed_amount");
      const titled = transport([
        () => reply("tool_use", [toolUse("m", "make_canvas", { recipe: JSON.stringify({ version: 1, title: "Save ¥88,888", blocks: [{ type: "number", label: "Cash today", query: { q: "cash" } }] }) }), toolUse("w", "where_am_i", {})]),
        () => reply("end_turn", [text("Here it is.")]),
      ]);
      await assert.rejects(conversation(d, "Show my cash", titled.fetch), (error: Error) => error instanceof AgentError && error.outcome === "unconfirmed_amount");
      assert.deepEqual(canvasWords(RecipeSchema.parse({ version: 1, title: "T", blocks: [
        { type: "number", label: "L", query: { q: "cash" }, note: "N" }, { type: "table", title: "TT", query: { q: "events" } },
        { type: "progress", label: "P", query: { q: "cash" }, targetMinor: 5 }, { type: "action", label: "A", href: "/plan" }, { type: "note", text: "NT", by: "you" }] })),
      ["T", "L", "N", "TT", "P", "A", "NT"]);
    });

    await check("run-level failures become fixed sentences with no provider text, and a tool that throws a plain Error does not end the loop", async () => {
      const c = await seedBen(db, { isDemo: true });
      const secret = "provider says: key sk-secret-123 is wrong";
      const status = (code: number) => (async () => new Response(secret, { status: code })) as typeof globalThis.fetch;
      const expected: [number, string][] = [[403, "The AI key was not accepted. Check it in Settings."], [500, "The AI service returned HTTP 500. Try again."]];
      for (const [code, words] of expected) {
        await assert.rejects(ask(c, "What is due?", status(code)), (error: Error) => error instanceof AgentError && error.message === words && !error.message.includes("secret"));
      }
      const down = (async () => { throw new Error(secret); }) as typeof globalThis.fetch;
      await assert.rejects(ask(c, "What is due?", down), (error: Error) => error instanceof AgentError && error.message === "Couldn't reach the AI service. Try again.");
      const weird = transport([() => reply("weird_stop", [text("hm")])]);
      await assert.rejects(ask(c, "What is due?", weird.fetch), (error: Error) => error instanceof AgentError && error.message === "The assistant stopped unexpectedly. Try again.");

      const target = tools.find(t => t.name === "whats_due")!;
      const original = target.run;
      target.run = async () => { throw new Error("database exploded: password=hunter2"); };
      try {
        const t = transport([
          () => reply("tool_use", [toolUse("w", "whats_due", {})]),
          () => reply("end_turn", [text("I could not read that.")]),
        ]);
        const result = await ask(c, "What is due?", t.fetch);
        const [back] = toolResults(t.bodies[1]);
        assert.deepEqual([back.is_error, back.content], [true, "This tool could not complete the request."]);
        assert.equal(result.kind, "answer");
      } finally { target.run = original; }
    });

    await check("after an AgentError the question stores no turn", async () => {
      const c = await seedBen(db, { isDemo: true });
      const down = (async () => { throw new Error("offline"); }) as typeof globalThis.fetch;
      await assert.rejects(conversation(c, "What is due?", down), AgentError);
      const stored = await db.select().from(schema.conversationTurns).where(eq(schema.conversationTurns.householdId, c));
      assert.equal(stored.length, 0);
    });

    await check("declined questions are never capped: the sixth decline in an hour is declined like the first, and each is stored", async () => {
      const c = await seedBen(db, { isDemo: true });
      const decline = () => transport([() => reply("tool_use", [toolUse("o", "out_of_scope", { reason: "off_topic" })])]);
      for (let i = 0; i < 6; i++) assert.equal((await conversation(c, `Off topic ${i}`, decline().fetch)).text, FIXED.off_topic);
      const stored = await db.select().from(schema.conversationTurns).where(eq(schema.conversationTurns.householdId, c));
      assert.equal(stored.length, 6);
    });

    await check("a read tool still running when the budget ends stops the question and names the step; a write before it is kept, and a retry with the same id runs nothing again", async () => {
      const h = await seedBen(db, { isDemo: true });
      const tool = tools.find(t => t.name === "where_am_i")!;
      const realRun = tool.run;
      let clock = 0;
      tool.run = () => new Promise<string>(() => {}); // never finishes
      try {
        const billId = crypto.randomUUID();
        const bill = { id: billId, biller: "Hikari Gas", amount: "3100", due: aState.today, category: "utilities", memberId: null, repeat: "month" };
        const slow = transport([
          () => reply("tool_use", [toolUse("b", "add_bill", bill)]),
          () => { clock = 19_950; return reply("tool_use", [toolUse("w", "where_am_i", {})]); },
        ]);
        // no write: a plain AgentError that names the step, outcome budget
        await assert.rejects(ask(h, "Where am I?", transport(() => { clock = 19_950; return reply("tool_use", [toolUse("w", "where_am_i", {})]); }).fetch, { now: () => clock }),
          (e: unknown) => e instanceof AgentError && e.message === "That took too long while looking at where you stand. Try a simpler question." && e.outcome === "budget");
        clock = 0;
        const input = askInput.parse({ id: crypto.randomUUID(), conversationId: crypto.randomUUID(), text: "The gas bill is ¥3,100.", source: "manual", canvas: null });
        // answerQuestion has no clock seam: runAgent reads Date.now, so the same stub is moved by the fetch
        const realNow = Date.now;
        Date.now = () => clock;
        let answer;
        try { answer = await answerQuestion(db, h, input, { fetch: slow.fetch }); } finally { Date.now = realNow; }
        assert.equal(answer.text, FIXED.savedThenStopped + "That took too long while looking at where you stand. Try a simpler question.");
        assert.equal(answer.pending, true);
        assert.equal((await db.select().from(schema.bills).where(and(eq(schema.bills.householdId, h), eq(schema.bills.id, billId)))).length, 1);
        const retry = transport(() => { throw new Error("no model call expected"); });
        const again = await answerQuestion(db, h, input, { fetch: retry.fetch });
        assert.equal(retry.bodies.length, 0);
        assert.equal(again.text, answer.text);
        assert.equal((await db.select().from(schema.bills).where(and(eq(schema.bills.householdId, h), eq(schema.bills.biller, "Hikari Gas")))).length, 1, "the write ran once");
      } finally { tool.run = realRun; }
    });

    await check("the Ask log line carries kind and canvas and never the question, the reply, a note or a letter", async () => {
      const c = await seedBen(db, { isDemo: true });
      logged.length = 0;
      const t = transport([
        () => reply("tool_use", [toolUse("m", "make_canvas", { recipe: cashCanvas([{ type: "note", text: "Distinctive note words", by: "assistant" }]) }), toolUse("w", "where_am_i", {})]),
        () => reply("end_turn", [text("Distinctive reply words.")]),
      ]);
      await conversation(c, "Distinctive question words", t.fetch);
      const [line] = logged;
      assert.deepEqual([line.at, line.kind, line.canvas, line.outcome], ["ask", "answer", true, "answer"]);
      const raw = JSON.stringify(line);
      for (const needle of ["Distinctive", "Cash today", KEY]) assert.ok(!raw.includes(needle), `the log line leaks ${needle}`);
    });

    await check("what_if returns the engine's numbers in minor units; a bad client is an error the model can read", async () => {
      const c = await seedBen(db, { isDemo: true });
      const state = await stateOf(c);
      const client = state.clients[0];
      const changes = [{ kind: "client_late", clientId: client.id, days: 14 }];
      const t = transport([
        () => reply("tool_use", [toolUse("a", "what_if", { case: "late", changes }), toolUse("b", "what_if", { case: "late", changes: [{ kind: "client_late", clientId: "nobody", days: 3 }] })]),
        () => reply("end_turn", [text("Done.")]),
      ]);
      await conversation(c, "What if a client pays two weeks late?", t.fetch);
      const [ok, bad] = toolResults(t.bodies[1]);
      const out = JSON.parse(ok.content);
      const expected = whatIf(state, changes as never);
      const unit = minorPerUnit(state.homeCurrency);
      const point = low(series(expected, "worst"), state.today);
      assert.equal(out.lowPoint.amountMinor, Math.round(point.amount * unit));
      assert.equal(out.lowPoint.date, point.date);
      assert.equal(out.safeToSpendMinor, Math.round(safeToSpend(expected, 0).amount * unit));
      assert.equal(out.lowPointChangeMinor, out.lowPoint.amountMinor - out.now.lowPoint.amountMinor);
      assert.equal(out.sentence.startsWith(homeSentence(expected).text), true);
      assert.ok(bad.is_error && bad.content.includes("not in your records"));
    });


    // ---------------------------------------------------------------- 24B: this device only (D59)
    await check("memory kept on the device: the question carries it into the system text, remember and forget come back as memoryChanges, and nothing is written", async () => {
      const d = await seedBen(db, { isDemo: true });
      const cloud = await seedBen(db, { isDemo: true });
      await db.update(schema.households).set({ memoryPlace: "device", journalPlace: "device" }).where(eq(schema.households.id, d));
      const item = (kind: MemoryItem["kind"], words: string): MemoryItem => ({ id: crypto.randomUUID(), kind, text: words, madeBy: "form", askId: null, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" });
      const held = [item("instruction", "Answer in a single short line"), item("fact", "The gym is shared")];
      const turn = (question: string, replyText: string): ConversationTurn => ({
        version: 1, id: crypto.randomUUID(), conversationId: crypto.randomUUID(), question, kind: "answer", reply: replyText, choices: null, recipe: null, sources: [], thumb: null, createdAt: new Date().toISOString(),
      });
      const recent = [turn("Earlier question", "Earlier reply")];
      const rows = async () => ({
        memories: (await db.select().from(schema.memories).where(eq(schema.memories.householdId, d))).length,
        turns: (await db.select().from(schema.conversationTurns).where(eq(schema.conversationTurns.householdId, d))).length,
        events: (await db.select().from(schema.events).where(eq(schema.events.householdId, d))).length,
      });
      const before = await rows();
      const ask = (hid: string, question: string, extra: Record<string, unknown>, fetch: typeof globalThis.fetch) =>
        answerQuestion(db, hid, askInput.parse({ id: crypto.randomUUID(), conversationId: crypto.randomUUID(), text: question, source: "manual", canvas: null, ...extra }), { fetch });

      const one = transport([
        () => reply("tool_use", [toolUse("r", "remember", { kind: "fact", text: "Rent goes up in April" }), toolUse("f", "forget", { id: held[1].id })]),
        () => reply("end_turn", [text("I'll remember that rent goes up in April, and forgot the gym.")]),
      ]);
      logged.length = 0;
      const answer = await ask(d, "Remember that rent goes up in April and forget the gym", { memory: held, recent }, one.fetch);
      assert.equal(answer.kind, "answer");
      const first = one.bodies[0];
      assert.ok(first.system.includes("Answer in a single short line") && first.system.includes("The gym is shared"), "the carried memory is in the system text");
      assert.ok(first.system.indexOf("Answer in a single short line") < first.system.indexOf("The gym is shared"), "instructions come first");
      const userText = String(first.messages[0].content);
      assert.ok(userText.includes("Earlier question") && userText.includes("Earlier reply"), "the carried turns are the context");
      assert.equal(answer.memoryChanges.length, 2);
      const [added, forgot] = answer.memoryChanges;
      assert.ok(added.op === "add" && added.item.text === "Rent goes up in April" && added.item.madeBy === "ask" && added.item.askId === answer.id);
      assert.deepEqual(forgot, { op: "forget", id: held[1].id });
      assert.equal(answer.firstUse, null);
      assert.deepEqual(await rows(), before, "no memory row, no turn row and no event: the server kept none of it");
      const raw = JSON.stringify(logged);
      for (const needle of ["Rent goes up in April", "Answer in a single short line", "Earlier question"]) assert.ok(!raw.includes(needle), `the log line leaks ${needle}`);

      // a text that counts as a source: an amount in the carried memory passes the amount check
      const amount = transport([() => reply("tool_use", [toolUse("w", "where_am_i", {})]), () => reply("end_turn", [text("Your trip fund is ¥300,000.")])]);
      const withAmount = await ask(d, "How is my trip fund?", { memory: [item("goal", "¥300,000 for a trip in March")], recent: [] }, amount.fetch);
      assert.equal(withAmount.text, "Your trip fund is ¥300,000.");

      // never both places: the kind on the device must be carried, the kind in the cloud must not
      const noModel = transport(() => reply("end_turn", [text("unused")]));
      await assert.rejects(ask(d, "Hello?", { recent }, noModel.fetch), (e: unknown) => e instanceof InputError && /memory on this device/.test(e.message));
      await assert.rejects(ask(d, "Hello?", { memory: held }, noModel.fetch), (e: unknown) => e instanceof InputError && /conversations on this device/.test(e.message));
      await assert.rejects(ask(cloud, "Hello?", { memory: held }, noModel.fetch), (e: unknown) => e instanceof InputError && /memory in our cloud/.test(e.message));
      await assert.rejects(ask(cloud, "Hello?", { recent }, noModel.fetch), (e: unknown) => e instanceof InputError && /conversations in our cloud/.test(e.message));
      assert.equal(noModel.bodies.length, 0, "no model call for a refused question");
      // the size limits are the schema's
      assert.ok(!askInput.safeParse({ id: crypto.randomUUID(), conversationId: crypto.randomUUID(), text: "x", source: "manual", canvas: null, memory: Array(201).fill(held[0]) }).success);
      assert.ok(askInput.safeParse({ id: crypto.randomUUID(), conversationId: crypto.randomUUID(), text: "x", source: "manual", canvas: null, recent: Array(4).fill(recent[0]) }).success, "a device tail has a character budget instead of a turn limit");
      assert.ok(!askInput.safeParse({ id: crypto.randomUUID(), conversationId: crypto.randomUUID(), text: "x", source: "manual", canvas: null, memory: [{ ...held[0], extra: 1 }] }).success);

      // the cloud household is unchanged: its Ask still stores its turn and carries no changes
      const plain = transport([() => reply("tool_use", [toolUse("w", "where_am_i", {})]), () => reply("end_turn", [text("You are fine.")])]);
      const stored = await ask(cloud, "Where am I?", {}, plain.fetch);
      assert.deepEqual(stored.memoryChanges, []);
      assert.equal((await db.select().from(schema.conversationTurns).where(eq(schema.conversationTurns.householdId, cloud))).length, 1);
    });

    // ---------------------------------------------------------------- a failure after a write, a retried id, more than 20 memory changes
    await check("a failure after a write tool becomes a reply that keeps the rows and links (cloud), and the turn is saved; a failure with no write still throws", async () => {
      const h = await seedBen(db, { isDemo: true });
      const billId = crypto.randomUUID();
      const bill = { id: billId, biller: "Hikari Water", amount: "4200", due: aState.today, category: "utilities", memberId: null, repeat: "month" };
      let n = 0;
      const looping = transport(() => (n++ === 0 ? reply("tool_use", [toolUse("b", "add_bill", bill)]) : reply("tool_use", [toolUse("w" + n, "where_am_i", {})])));
      const conversationId = crypto.randomUUID();
      const input = askInput.parse({ id: crypto.randomUUID(), conversationId, text: "The water bill is ¥4,200.", source: "manual", canvas: null });
      logged.length = 0;
      const answer = await answerQuestion(db, h, input, { fetch: looping.fetch });
      assert.equal(answer.kind, "answer");
      assert.equal(answer.text, FIXED.savedThenStopped + "I couldn't finish that. Try a simpler question.");
      assert.ok(!/[0-9]/.test(answer.text), "no amount in the fixed text");
      assert.equal(answer.pending, true);
      assert.deepEqual(answer.links, [{ label: "Open To check", href: "http://127.0.0.1:3123/to-check" }]);
      assert.equal(answer.canvas, null);
      assert.deepEqual(answer.sources, []);
      assert.equal((await db.select().from(schema.bills).where(and(eq(schema.bills.householdId, h), eq(schema.bills.id, billId)))).length, 1);
      assert.equal(logged.at(-1)!.outcome, "turns", "the log line keeps the real outcome");
      const [turn] = await db.select().from(schema.conversationTurns).where(eq(schema.conversationTurns.id, input.id));
      assert.equal(turn.reply, answer.text);
      assert.equal(turn.householdId, h);
      // no write before the failure: still an error, and no turn
      const refused = askInput.parse({ id: crypto.randomUUID(), conversationId, text: "Hello?", source: "manual", canvas: null });
      await assert.rejects(answerQuestion(db, h, refused, { fetch: transport(() => reply("refusal", [])).fetch }), AgentError);
      assert.equal((await db.select().from(schema.conversationTurns).where(eq(schema.conversationTurns.id, refused.id))).length, 0);
      // a write that itself failed does not count as a write
      const badBill = transport([() => reply("tool_use", [toolUse("b", "add_bill", { ...bill, id: "not-a-uuid" })]), () => reply("refusal", [])]);
      await assert.rejects(answerQuestion(db, h, askInput.parse({ id: crypto.randomUUID(), conversationId, text: "Again", source: "manual", canvas: null }), { fetch: badBill.fetch }), AgentError);
    });

    await check("a failure after remember on a device household returns the memory changes with a Memory link", async () => {
      const d = await seedBen(db, { isDemo: true });
      await db.update(schema.households).set({ memoryPlace: "device", journalPlace: "device" }).where(eq(schema.households.id, d));
      const t = transport([() => reply("tool_use", [toolUse("r", "remember", { kind: "fact", text: "Rent goes up in April" })]), () => reply("end_turn", [])]);
      const answer = await answerQuestion(db, d, askInput.parse({ id: crypto.randomUUID(), conversationId: crypto.randomUUID(), text: "Remember rent goes up in April", source: "manual", canvas: null, memory: [], recent: [] }), { fetch: t.fetch });
      assert.equal(answer.kind, "answer");
      assert.equal(answer.text, FIXED.savedThenStopped + "The assistant gave no answer. Try again.");
      assert.equal(answer.memoryChanges.length, 1);
      assert.ok(answer.memoryChanges[0].op === "add" && answer.memoryChanges[0].item.text === "Rent goes up in April");
      assert.deepEqual(answer.links, [{ label: "Open Memory", href: "http://127.0.0.1:3123/memory" }]);
      assert.equal(answer.pending, false);
      assert.equal(answer.firstUse, null);
      assert.equal((await db.select().from(schema.conversationTurns).where(eq(schema.conversationTurns.householdId, d))).length, 0, "the device keeps its own turn");
    });

    await check("a device-journal retry after a write makes no model call and writes nothing twice; a retry with no write runs again; another household's receipt does not count", async () => {
      const d = await seedBen(db, { isDemo: true });
      await db.update(schema.households).set({ journalPlace: "device" }).where(eq(schema.households.id, d));
      const ds = await stateOf(d);
      const billId = crypto.randomUUID(), id = crypto.randomUUID(), conversationId = crypto.randomUUID();
      const bill = { id: billId, biller: "Receipt Water", amount: "4200", due: ds.today, category: "utilities", memberId: null, repeat: null, next_amount: null, next_amount_from: null, cancel_by: null, repeat_until: null };
      const input = askInput.parse({ id, conversationId, text: "The water bill is 4200", source: "manual", canvas: null, recent: [] });
      const first = transport([() => reply("tool_use", [toolUse("b", "add_bill", bill)]), () => reply("end_turn", [text("It is waiting in To check.")])]);
      const firstReply = await answerQuestion(db, d, input, { fetch: first.fetch });
      assert.equal(firstReply.pending, true);
      const count = async () => (await db.select().from(schema.bills).where(and(eq(schema.bills.householdId, d), eq(schema.bills.biller, "Receipt Water")))).length;
      assert.equal(await count(), 1);
      assert.equal((await db.select().from(schema.askReceipts).where(eq(schema.askReceipts.householdId, d))).length, 1);
      const never = transport([]);
      const again = await answerQuestion(db, d, input, { fetch: never.fetch });
      assert.equal(never.bodies.length, 0, "no model call");
      assert.equal(again.text, FIXED.alreadySaved);
      assert.deepEqual(again.links, [{ label: "Open To check", href: "http://127.0.0.1:3123/to-check" }]);
      assert.deepEqual(again.links, firstReply.links, "the retry carries the first reply's links");
      assert.equal(again.pending, firstReply.pending, "and its To check flag");
      assert.equal(await count(), 1, "the bill exists once");
      // a question with no write leaves no receipt and runs again
      const readId = crypto.randomUUID();
      const readInput = askInput.parse({ id: readId, conversationId, text: "Where am I?", source: "manual", canvas: null, recent: [] });
      const read = () => transport([() => reply("tool_use", [toolUse("w", "where_am_i", {})]), () => reply("end_turn", [text("You are fine.")])]);
      const r1 = read(), r2 = read();
      await answerQuestion(db, d, readInput, { fetch: r1.fetch });
      await answerQuestion(db, d, readInput, { fetch: r2.fetch });
      assert.ok(r1.bodies.length > 0 && r2.bodies.length > 0, "a retry with no write runs again");
      // the receipt is this household's: the same id from another household runs
      const other = await seedBen(db, { isDemo: true });
      await db.update(schema.households).set({ journalPlace: "device" }).where(eq(schema.households.id, other));
      const o = transport([() => reply("end_turn", [text("Hello.")])]);
      const otherReply = await answerQuestion(db, other, input, { fetch: o.fetch });
      assert.notEqual(otherReply.text, FIXED.alreadySaved);
      assert.ok(o.bodies.length > 0);
    });

    await check("a device memory tool does not suppress the receipt for a later committed draft in the same turn", async () => {
      const h = await seedBen(db, { isDemo: true });
      await db.update(schema.households).set({ memoryPlace: "device", journalPlace: "device" }).where(eq(schema.households.id, h));
      const owner = (await pg.query<{ role: string }>("select current_user as role")).rows[0].role;
      const id = crypto.randomUUID(), billId = crypto.randomUUID();
      const input = askInput.parse({
        id, conversationId: crypto.randomUUID(), text: "Remember that water is shared and add the new water bill.",
        source: "manual", canvas: null, memory: [], recent: [],
      });
      const bill = { id: billId, biller: "Scoped Water", amount: "4200", due: aState.today, category: "utilities", memberId: null, repeat: null };
      const provider = transport([
        () => reply("tool_use", [toolUse("r", "remember", { kind: "fact", text: "Water is shared" }), toolUse("b", "add_bill", bill)]),
        () => reply("end_turn", [text("It is waiting in To check.")]),
      ]);
      const fetch: typeof globalThis.fetch = async (request, init) => {
        assert.equal((await pg.query<{ role: string }>("select current_user as role")).rows[0].role, owner, "model fetch runs outside tenant scope");
        if (provider.bodies.length === 1) {
          const [draft] = await db.select().from(schema.bills).where(eq(schema.bills.id, billId));
          const [receipt] = await db.select().from(schema.askReceipts).where(and(eq(schema.askReceipts.householdId, h), eq(schema.askReceipts.askId, id)));
          assert.equal(draft?.status, "pending", "the draft already committed");
          assert.ok(receipt, "the receipt already committed");
        }
        return provider.fetch(request, init);
      };
      const answer = await answerQuestion(db, h, input, { fetch });
      assert.equal(answer.text, "It is waiting in To check.");
      assert.equal(answer.pending, true);
      assert.equal(answer.memoryChanges.length, 1);
    });

    await check("a cloud-journal retry of a question that left a pending bill returns the same links and pending flag", async () => {
      const h = await seedBen(db, { isDemo: true });
      const hs = await stateOf(h);
      const id = crypto.randomUUID(), conversationId = crypto.randomUUID();
      const bill = { id: crypto.randomUUID(), biller: "Replay Gas", amount: "3800", due: hs.today, category: "utilities", memberId: null, repeat: null, next_amount: null, next_amount_from: null, cancel_by: null, repeat_until: null };
      const input = askInput.parse({ id, conversationId, text: "The gas bill is 3800", source: "manual", canvas: null });
      const first = transport([() => reply("tool_use", [toolUse("b", "add_bill", bill)]), () => reply("end_turn", [text("It is waiting in To check.")])]);
      const one = await answerQuestion(db, h, input, { fetch: first.fetch });
      assert.equal(one.pending, true);
      assert.deepEqual(one.links.map(l => l.label), ["Open To check"]);
      const never = transport([]);
      const two = await answerQuestion(db, h, input, { fetch: never.fetch });
      assert.equal(never.bodies.length, 0);
      assert.deepEqual([two.kind, two.text, two.links, two.pending, two.sources], [one.kind, one.text, one.links, one.pending, one.sources]);
      assert.equal((await db.select().from(schema.bills).where(and(eq(schema.bills.householdId, h), eq(schema.bills.biller, "Replay Gas")))).length, 1);
    });

    await check("a question retried with the same id (cloud journal) makes no model call and returns the saved turn", async () => {
      const h = await seedBen(db, { isDemo: true });
      const id = crypto.randomUUID(), conversationId = crypto.randomUUID();
      const input = askInput.parse({ id, conversationId, text: "Show my cash", source: "manual", canvas: null });
      const first = transport([
        () => reply("tool_use", [toolUse("m", "make_canvas", { recipe: cashCanvas() }), toolUse("w", "where_am_i", {})]),
        () => reply("end_turn", [text("Here is your cash.")]),
      ]);
      const one = await answerQuestion(db, h, input, { fetch: first.fetch });
      assert.ok(one.canvas);
      const again = transport(() => { throw new Error("no model call expected"); });
      const two = await answerQuestion(db, h, input, { fetch: again.fetch });
      assert.equal(again.bodies.length, 0);
      assert.equal(two.id, id);
      assert.equal(two.kind, one.kind);
      assert.equal(two.text, one.text);
      assert.deepEqual(two.sources, one.sources);
      assert.deepEqual(two.canvas?.recipe, one.canvas?.recipe);
      assert.ok(two.canvas && two.canvas.blocks.length === one.canvas!.blocks.length);
      assert.deepEqual([two.links, two.pending, two.memoryChanges], [[], false, []]);
      // the same id with other words is refused, never answered with the old reply
      await assert.rejects(answerQuestion(db, h, { ...input, text: "Show my bills" }, { fetch: again.fetch }), (e: unknown) => e instanceof InputError && /already answered/.test(e.message));
      assert.equal(again.bodies.length, 0);
      // another household's question with the same id is not found here
      const other = await seedBen(db, { isDemo: true });
      const fresh = transport([() => reply("tool_use", [toolUse("w", "where_am_i", {})]), () => reply("end_turn", [text("You are fine.")])]);
      assert.equal((await answerQuestion(db, other, input, { fetch: fresh.fetch })).text, "You are fine.");
      assert.equal(fresh.bodies.length, 2);
    });

    await check("remember and forget stop at 20 memory changes in one question; the 21st is a plain error the model can read", async () => {
      const d = await seedBen(db, { isDemo: true });
      await db.update(schema.households).set({ memoryPlace: "device", journalPlace: "device" }).where(eq(schema.households.id, d));
      const calls = Array.from({ length: 21 }, (_, i) => toolUse("r" + i, "remember", { kind: "fact", text: "Fact number " + String.fromCharCode(97 + i) }));
      const t = transport([() => reply("tool_use", calls), () => reply("end_turn", [text("I kept some of that.")])]);
      const answer = await answerQuestion(db, d, askInput.parse({ id: crypto.randomUUID(), conversationId: crypto.randomUUID(), text: "Remember all of these", source: "manual", canvas: null, memory: [], recent: [] }), { fetch: t.fetch });
      assert.equal(answer.memoryChanges.length, MAX_MEMORY_CHANGES);
      const results = toolResults(t.bodies[1]);
      assert.ok(!results[19].is_error && results[20].is_error);
      assert.equal(results[20].content, "I can make at most 20 memory changes in one question.");
      applyMemoryChanges([], answer.memoryChanges);
    });

    await check("without the device's list (MCP, a stale page) recall answers in words and remember and forget refuse; the cloud is not read", async () => {
      const d = await seedBen(db, { isDemo: true });
      await db.insert(schema.memories).values({ householdId: d, kind: "fact", text: "Stale cloud row" });
      await db.update(schema.households).set({ memoryPlace: "device" }).where(eq(schema.households.id, d));
      const ctx = { madeBy: "mcp" as const, db, householdId: d, state: async () => loadMoneyState(db, d, await householdDate(db, d)), appUrl: APP };
      const run = (name: string, input: unknown) => tools.find(t => t.name === name)!.run(ctx as never, input as never);
      assert.equal(await run("recall", {}), DEVICE_MEMORY_WORDS);
      await assert.rejects(run("remember", { kind: "fact", text: "Something new" }), (e: unknown) => e instanceof InputError && e.message === DEVICE_MEMORY_WORDS);
      await assert.rejects(run("forget", { id: crypto.randomUUID() }), InputError);
      assert.equal((await db.select().from(schema.memories).where(eq(schema.memories.householdId, d))).length, 1, "nothing was written");
    });

    await check("27B: reads in one turn run together, a write runs alone in its place, results keep the order asked, each tool keeps its own time", async () => {
      const events: string[] = [];
      const wrap = (name: string, delay: number) => {
        const tool = tools.find(t => t.name === name)!;
        const real = tool.run;
        (tool as { run: unknown }).run = async (ctx: never, input: never) => {
          events.push(`${name}:start`);
          await new Promise(resolve => setTimeout(resolve, delay));
          try { return await (real as (c: never, i: never) => Promise<string>)(ctx, input); } finally { events.push(`${name}:end`); }
        };
        return () => { (tool as { run: unknown }).run = real; };
      };
      const restore = [wrap("where_am_i", 40), wrap("whats_due", 10), wrap("draft_invoice", 10)];
      try {
        const draft = { id: crypto.randomUUID(), clientId: aState.clients[0].id, item: "Poster", amount: "10.00", note: "" };
        const { fetch, bodies } = transport([
          () => reply("tool_use", [toolUse("r1", "where_am_i", {}), toolUse("r2", "whats_due", {}), toolUse("w1", "draft_invoice", draft), toolUse("r3", "whats_due", {}), toolUse("bad", "no_such_tool", {})]),
          () => reply("end_turn", [text("Done.")]),
        ]);
        const steps: string[] = [];
        logged.length = 0;
        const result = await ask(a, "Look and draft", fetch, { onStep: step => steps.push(step) });
        assert.equal(result.answer, "Done.");
        // both first reads started before either ended; the write started after both ended; the last read after the write ended
        assert.deepEqual(events.slice(0, 2), ["where_am_i:start", "whats_due:start"]);
        assert.ok(events.indexOf("draft_invoice:start") > events.indexOf("where_am_i:end") && events.indexOf("draft_invoice:start") > events.indexOf("whats_due:end"));
        assert.ok(events.lastIndexOf("whats_due:start") > events.indexOf("draft_invoice:end"));
        assert.equal(events.filter(e => e === "draft_invoice:start").length, 1);
        const results = toolResults(bodies[1]);
        assert.deepEqual(results.map(r => r.tool_use_id), ["r1", "r2", "w1", "r3", "bad"]);
        assert.equal(results[4].content, "Unknown tool.");
        assert.ok(results[4].is_error);
        const line = logged.at(-1) as { tools: { name: string; ok: boolean; ms: number }[] };
        assert.deepEqual(line.tools.map(t => t.name), ["where_am_i", "whats_due", "draft_invoice", "whats_due", "unknown"], "the log keeps the order asked");
        assert.ok(line.tools.every(t => typeof t.ms === "number"));
        assert.deepEqual(steps, [THINKING_WORDS, TOOL_WORDS.where_am_i, TOOL_WORDS.whats_due, TOOL_WORDS.draft_invoice, toolWords("no_such_tool"), THINKING_WORDS]);
        assert.ok(steps.every(step => !/\d/.test(step)), "steps carry words only");
      } finally { restore.forEach(undo => undo()); }
    });

    await check("27B: every tool in the catalogue has words, and the words are plain", async () => {
      for (const tool of tools) assert.ok(TOOL_WORDS[tool.name], `${tool.name} has no words in src/lib/agent/words.ts`);
      assert.deepEqual(Object.keys(TOOL_WORDS).filter(name => !tools.some(t => t.name === name)), [], "words for a tool that is not in the catalogue");
      for (const words of [THINKING_WORDS, ...Object.values(TOOL_WORDS)]) assert.ok(/^[A-Za-z' -]+$/.test(words), words);
    });

    console.log(`Agent checks passed (${passed}).`);
  } finally {
    console.info = realInfo;
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await pg.close();
  }
}
main().catch(error => { console.error("Agent checks failed", error instanceof Error ? error.stack?.split("\n").slice(0, 6).join("\n") : ""); process.exitCode = 1; });
