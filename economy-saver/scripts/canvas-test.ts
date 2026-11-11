// The canvas (D57): the recipe schema, the what-if on the engine, the resolver, the starter recipes and the route's function.
// Fictional data only; PGlite, no credentials.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/canvas-test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { TableBlock } from "@/components/canvas/blocks";
import * as schema from "@/db/schema";
import { savePot } from "@/db/pots";
import { seedBen } from "@/db/seed";
import { drawCanvas } from "@/lib/canvas/draw";
import { SESSION_ENDED } from "@/lib/session-ended";
import { loadCanvasContext, resolveCanvasRequest } from "@/lib/canvas/request";
import { CanvasError, resolveRecipe, type ResolvedBlock } from "@/lib/canvas/resolve";
import { BlockSchema, RecipeSchema, ScenarioSchema, recipeJsonSchema, type Change, type Recipe } from "@/lib/canvas/schema";
import { canvasSummary } from "@/lib/canvas/summary";
import { starterRecipes, STARTER_IDS } from "@/lib/canvas/starters";
import { blockWords } from "@/lib/canvas/words";
import { foreignCosts } from "@/lib/money/fx-cost";
import { money, minorMoney } from "@/lib/money/format";
import { monthByCategory } from "@/lib/money/month";
import { regularCosts } from "@/lib/money/regular";
import { addDays, low, planWindow, series, timeline, safeToSpend, availableCash } from "@/lib/money/runway";
import { stateThrough } from "@/lib/money/window";
import { homeSentence } from "@/lib/money/sentence";
import { monthBounds, monthsBack, spendingItems } from "@/lib/money/spending";
import type { MoneyState } from "@/lib/money/types";
import { WhatIfError, whatIf } from "@/lib/money/whatif";

const TODAY = "2026-11-14";

// A small hand-worked household (fictional): ¥100,000 cash, rent ¥70,000 on Nov 20, a ¥5,000 bill on Nov 25, and one $400 invoice
// (¥60,000 at 150) from Maple Studio, sent today. Maple has paid in 5, 9 and 12 days: usually Nov 23, at slowest Nov 26.
//   usual: 100,000 → Nov 20 30,000 (low) → Nov 23 90,000 → Nov 25 85,000.   late: Nov 20 30,000 → Nov 25 25,000 (low) → Nov 26 85,000.
const small: MoneyState = {
  today: TODAY, homeCurrency: "JPY", fxPerUsd: 150, paypal: 40_000, bank: 60_000,
  bills: [
    { id: "rent@2026-11-20", biller: "Fictional rent", amount: 70_000, due: "2026-11-20", category: "housing", businessBp: 0, status: "confirmed", repeatUnit: "month", repeatDay: 20, startsOn: "2026-06-20", startAmount: 70_000 },
    { id: "rent@2026-12-20", biller: "Fictional rent", amount: 70_000, due: "2026-12-20", category: "housing", businessBp: 0, status: "confirmed", repeatUnit: "month", repeatDay: 20, startsOn: "2026-06-20", startAmount: 70_000 },
    { id: "phone", biller: "Fictional phone", amount: 5_000, due: "2026-11-25", category: "phone_internet", businessBp: 0, status: "confirmed" },
  ],
  storedBills: [
    { id: "rent", biller: "Fictional rent", amount: 70_000, due: "2026-11-20", category: "housing", businessBp: 0, status: "confirmed", repeatUnit: "month", repeatDay: 20 },
    { id: "phone", biller: "Fictional phone", amount: 5_000, due: "2026-11-25", category: "phone_internet", businessBp: 0, status: "confirmed" },
  ],
  cards: [], charges: [], statements: [],
  clients: [{ id: "maple", name: "Maple Studio", email: "ap@maple.example", termsDays: 7, daysToPay: [5, 9, 12] }],
  invoices: [{ id: "inv-1", clientId: "maple", number: "1", item: "Posters", amountUsd: 400, status: "sent", sentOn: TODAY, dueOn: "2026-11-21" }],
  pots: [], pendingPots: [], cancelNotices: [], balanceUpdates: [],
  split: { members: [{ id: "m1", name: "Mina", shareBp: 10_000 }], since: null, settledThrough: null, settledAt: null, bills: [], charges: [] },
};
const lowOf = (state: MoneyState, kind: "expected" | "worst") => low(series(state, kind));
const deepFreeze = <T,>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(deepFreeze); }
  return value;
};
const cashMinor = (n: number) => n; // JPY: minor units are yen

async function main() {
  let passed = 0;
  async function check(name: string, run: () => void | Promise<void>) { await run(); passed++; console.log(`✓ ${name}`); }

  // ------------------------------------------------------------ the what-if, by hand
  await check("canvas redraw uses the shared session message for 401 and keeps other refusals", async () => {
    const recipe: Recipe = { version: 1, title: "Fixture", blocks: [{ type: "sentence", query: { q: "sentence" } }] };
    const scenario = { case: "usual" as const, changes: [] };
    const signal = new AbortController().signal;
    assert.equal(await drawCanvas(recipe, { scenario, signal }, async (url, init) => {
      assert.equal(url, "/api/canvas/resolve");
      assert.equal(init?.method, "POST");
      assert.equal(init?.signal, signal);
      assert.deepEqual(JSON.parse(String(init?.body)), { recipe, scenario });
      return new Response("No household", { status: 401 });
    }), SESSION_ENDED);
    assert.equal(await drawCanvas(recipe, {}, async () => new Response("Invalid recipe", { status: 400 })), "Invalid recipe");
    assert.deepEqual(await drawCanvas(recipe, {}, async () => Response.json({ blocks: [] })), []);
  });

  await check("the hand-worked household: usual low ¥30,000 on Nov 20, late low ¥25,000 on Nov 25", () => {
    assert.deepEqual([lowOf(small, "expected").amount, lowOf(small, "expected").date], [30_000, "2026-11-20"]);
    assert.deepEqual([lowOf(small, "worst").amount, lowOf(small, "worst").date], [25_000, "2026-11-25"]);
  });

  await check("whatIf(state, []) deep-equals the state, is a new object, and nothing is mutated even when the input is frozen", () => {
    const frozen = deepFreeze(structuredClone(small));
    const same = whatIf(frozen, []);
    assert.deepEqual(same, small);
    assert.notEqual(same, frozen);
    const every: Change[] = [
      { kind: "client_late", clientId: "maple", days: 4 }, { kind: "remove_bill", billId: "phone" }, { kind: "change_bill", billId: "rent@2026-11-20", amountMinor: 1 },
      { kind: "add_cost", name: "Fictional lamp", amountMinor: 1_000, date: "2026-11-16" }, { kind: "add_income", name: "Fictional gift", amountMinor: 1_000, date: "2026-11-16" },
    ];
    const changed = whatIf(frozen, every);
    assert.deepEqual(frozen, small, "the input is untouched");
    assert.notDeepEqual(changed, small);
  });

  await check("client_late: 20 days later moves the usual low to ¥25,000 on Nov 25; 0 days is the state again; the late case moves too", () => {
    const later = whatIf(small, [{ kind: "client_late", clientId: "maple", days: 20 }]);
    assert.deepEqual([lowOf(later, "expected").amount, lowOf(later, "expected").date], [25_000, "2026-11-25"]);
    assert.deepEqual(lowOf(whatIf(small, [{ kind: "client_late", clientId: "maple", days: 0 }]), "expected"), lowOf(small, "expected"));
    // Slowest is 12 days: 3 more days puts the late arrival on Nov 29, still after the Nov 25 low: unchanged; 40 more days is Jan 5, outside the window.
    assert.equal(lowOf(whatIf(small, [{ kind: "client_late", clientId: "maple", days: 3 }]), "worst").amount, 25_000);
    assert.equal(whatIf(small, [{ kind: "client_late", clientId: "maple", days: 40 }]).clients[0].lateDays, 40);
    // exactly 1 more day on the usual case moves the arrival from Nov 23 to Nov 24: the low stays ¥30,000
    assert.equal(lowOf(whatIf(small, [{ kind: "client_late", clientId: "maple", days: 1 }]), "expected").amount, 30_000);
    // Without any change the field is absent: the engine is untouched (Ben's numbers are proved by the other suites).
    assert.equal("lateDays" in small.clients[0], false);
  });

  await check("remove_bill: a stored id removes every occurrence, an occurrence id only that one; the low is the day-one cash", () => {
    assert.equal(lowOf(whatIf(small, [{ kind: "remove_bill", billId: "rent" }]), "expected").amount, 100_000);
    assert.equal(whatIf(small, [{ kind: "remove_bill", billId: "rent" }]).bills.length, 1);
    const one = whatIf(small, [{ kind: "remove_bill", billId: "rent@2026-11-20" }]);
    assert.deepEqual(one.bills.map(b => b.id), ["rent@2026-12-20", "phone"]);
    assert.equal(lowOf(one, "expected").amount, 100_000);
  });

  await check("change_bill: rent ¥80,000 instead of ¥70,000 lowers the usual low by exactly ¥10,000; the estimate marks go", () => {
    const changed = whatIf(small, [{ kind: "change_bill", billId: "rent@2026-11-20", amountMinor: cashMinor(80_000) }]);
    assert.equal(lowOf(changed, "expected").amount, 20_000);
    assert.equal(lowOf(changed, "expected").amount - lowOf(small, "expected").amount, -10_000);
    const estimated = { ...small, bills: small.bills.map(b => (b.id === "phone" ? { ...b, amount: 4_000, amountUnknown: true as const, estimated: true as const, amountHigh: 9_000 } : b)) };
    const fixed = whatIf(estimated, [{ kind: "change_bill", billId: "phone", amountMinor: 6_000 }]).bills.find(b => b.id === "phone")!;
    assert.deepEqual([fixed.amount, fixed.estimated, fixed.amountUnknown, fixed.amountHigh], [6_000, undefined, undefined, undefined]);
    assert.equal(whatIf(small, [{ kind: "change_bill", billId: "rent", amountMinor: 80_000 }]).bills.filter(b => b.amount === 80_000).length, 2, "a stored id changes every occurrence");
  });

  await check("add_cost: ¥12,000 on Nov 15 lowers the usual low by exactly ¥12,000 (¥18,000); on Nov 27 it is after both lows", () => {
    assert.equal(lowOf(whatIf(small, [{ kind: "add_cost", name: "Fictional lamp", amountMinor: 12_000, date: "2026-11-15" }]), "expected").amount, 18_000);
    assert.equal(lowOf(whatIf(small, [{ kind: "add_cost", name: "Fictional lamp", amountMinor: 12_000, date: "2026-11-27" }]), "expected").amount, 30_000);
    const text = homeSentence(whatIf(small, [{ kind: "add_cost", name: "Fictional lamp", amountMinor: 12_000, date: "2026-11-15" }])).text;
    assert.match(text, /^You're fine/); // the late low is 25,000 − 12,000 = 13,000
  });

  await check("add_income: ¥50,000 on Nov 16 raises the usual low to ¥80,000 and the late low to ¥75,000", () => {
    const more = whatIf(small, [{ kind: "add_income", name: "Fictional bonus", amountMinor: 50_000, date: "2026-11-16" }]);
    assert.equal(lowOf(more, "expected").amount, 80_000);
    assert.equal(lowOf(more, "worst").amount, 75_000);
    assert.equal(more.clients.length, 2);
  });

  await check("a USD household: change_bill and add_cost take cents", () => {
    const usd: MoneyState = { ...small, homeCurrency: "USD", fxPerUsd: 1, paypal: 400, bank: 600, invoices: [], bills: [{ id: "rent", biller: "Fictional rent", amount: 700, due: "2026-11-20", category: "housing", businessBp: 0, status: "confirmed" }] };
    assert.equal(lowOf(usd, "expected").amount, 300);
    const cents = (n: number) => Math.round(n * 100); // the engine holds dollars as floats
    assert.equal(cents(lowOf(whatIf(usd, [{ kind: "add_cost", name: "Fictional lamp", amountMinor: 12_34, date: "2026-11-15" }]), "expected").amount), 287_66);
    assert.equal(cents(lowOf(whatIf(usd, [{ kind: "change_bill", billId: "rent", amountMinor: 800_50 }]), "expected").amount), 199_50);
  });

  await check("a USD household: add_income raises every day from its date by exactly the cents given, with no drift", () => {
    const usd: MoneyState = { ...small, homeCurrency: "USD", fxPerUsd: 1, paypal: 400, bank: 600, invoices: [], bills: [{ id: "rent", biller: "Fictional rent", amount: 700, due: "2026-11-20", category: "housing", businessBp: 0, status: "confirmed" }] };
    const cents = (n: number) => Math.round(n * 100);
    for (const minor of [1, 7, 33, 1_234, 99_999, 100_001, 1_234_567]) {
      for (const kind of ["expected", "worst"] as const) {
        const before = series(usd, kind);
        const after = series(whatIf(usd, [{ kind: "add_income", name: "Fictional bonus", amountMinor: minor, date: "2026-11-16" }]), kind);
        assert.equal(after.length, before.length);
        const landsAt = 2; // Nov 16 is two days after today (Nov 14)
        after.forEach((amount, i) => assert.equal(cents(amount) - cents(before[i]), i >= landsAt ? minor : 0, `${kind} day ${i} +${minor}`));
      }
    }
  });

  await check("unknown ids and out-of-range dates are refused in words", () => {
    for (const change of [
      { kind: "client_late", clientId: "nobody", days: 3 }, { kind: "remove_bill", billId: "nothing" }, { kind: "change_bill", billId: "nothing", amountMinor: 5 },
      { kind: "remove_bill", billId: "phone@2026-11-25" }, { kind: "add_cost", name: "x", amountMinor: 5, date: "2026-11-13" },
      { kind: "add_cost", name: "x", amountMinor: 5, date: "2029-01-01" }, { kind: "add_income", name: "x", amountMinor: 5, date: TODAY },
    ] as Change[]) assert.throws(() => whatIf(small, [change]), error => error instanceof WhatIfError && /your records|dated|two years/.test(error.message), JSON.stringify(change));
  });

  // ------------------------------------------------------------ the schema
  await check("the schema accepts a good recipe and refuses a money block with an amount of its own, an outside link, 13 blocks and an unknown type", () => {
    const sentence = { type: "sentence", query: { q: "sentence" } };
    const good = { version: 1, title: "Mine", blocks: [sentence, { type: "action", label: "Open Spending", href: "/spending?month=2026-10#top" }] };
    assert.ok(RecipeSchema.safeParse(good).success);
    const refused = (blocks: unknown[], extra: object = {}) => !RecipeSchema.safeParse({ version: 1, title: "Mine", blocks, ...extra }).success;
    assert.ok(refused([{ type: "number", label: "Cash", query: { q: "cash" }, amountMinor: 5_000 }]), "an amount beside the query");
    assert.ok(refused([{ type: "number", label: "Cash", query: { q: "cash", amountMinor: 5_000 } }]), "an amount inside the query");
    assert.ok(refused([{ type: "number", label: "Cash", amount: 5_000, query: { q: "cash" } }]), "a loose amount");
    assert.ok(refused([{ type: "sentence", text: "You're fine", query: { q: "sentence" } }]), "words beside a sentence query");
    assert.ok(refused([{ type: "number", label: "Flow", query: { q: "flow" } }]), "a number block asking for a chart");
    assert.ok(refused([{ type: "progress", label: "Goal", query: { q: "cash" } }]), "progress without its target");
    assert.ok(RecipeSchema.safeParse({ version: 1, title: "Mine", blocks: [{ type: "progress", label: "Goal", query: { q: "cash" }, targetMinor: 300_000 }] }).success);
    for (const href of ["https://evil.example/x", "//evil.example", "/api/ask", "/API/export", "/api", "javascript:alert(1)", "plan", "/a b", "/\\evil", "mailto:a@b.example"]) {
      assert.ok(refused([{ type: "action", label: "Go", href }]), href);
    }
    assert.ok(refused(Array.from({ length: 13 }, () => sentence)), "13 blocks");
    assert.ok(!refused(Array.from({ length: 12 }, () => sentence)), "12 blocks");
    assert.ok(refused([]), "no blocks");
    assert.ok(refused([{ type: "iframe", src: "/spending" }]), "an unknown block type");
    assert.ok(refused([sentence], { version: 2 }), "another version");
    assert.ok(refused([sentence], { notes: "x" }), "an unknown recipe key");
    assert.ok(refused([{ type: "note", text: "x".repeat(601), by: "you" }]) && refused([{ type: "letter", text: "x".repeat(4001) }]) && refused([{ type: "action", label: "x".repeat(61), href: "/" }]));
    assert.ok(refused([{ type: "sliders", controls: Array.from({ length: 5 }, (_, i) => ({ clientId: `c${i}`, maxDays: 10 })) }]), "five sliders");
    assert.ok(!ScenarioSchema.safeParse({ case: "usual", changes: Array.from({ length: 11 }, () => ({ kind: "remove_bill", billId: "x" })) }).success, "11 changes");
    for (const bad of [{ kind: "client_late", clientId: "c", days: 61 }, { kind: "add_cost", name: "x".repeat(81), amountMinor: 5, date: "2026-11-20" }, { kind: "add_cost", name: "x", amountMinor: 5.5, date: "2026-11-20" },
      { kind: "add_cost", name: "x", amountMinor: 0, date: "2026-11-20" }, { kind: "add_cost", name: "x", amountMinor: 5, date: "2026-02-30" }, { kind: "change_bill", billId: "b", amountMinor: 5, extra: 1 }]) {
      assert.ok(!ScenarioSchema.safeParse({ case: "late", changes: [bad] }).success, JSON.stringify(bad));
    }
    assert.ok(BlockSchema.safeParse({ type: "note", text: "A note", by: "assistant" }).success);
  });

  await check("recipeJsonSchema: valid JSON made from the zod definition, strict objects, the block types named", () => {
    const text = recipeJsonSchema();
    assert.ok(text.endsWith("\n"));
    const json = JSON.parse(text);
    assert.equal(json.title, "CanvasRecipe");
    assert.equal(json.additionalProperties, false);
    for (const type of ["sentence", "number", "flow_chart", "timeline", "table", "compare", "progress", "note", "letter", "sliders", "action"]) assert.ok(text.includes(`"${type}"`), type);
    assert.ok(text.length < 60_000, `the agent is shown this: ${text.length} characters`);
  });

  // ------------------------------------------------------------ the database
  const pg = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(pg, { schema });
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    const a = await seedBen(db, { isDemo: true }), b = await seedBen(db, { isDemo: true });
    const context = await loadCanvasContext(db, a, { blocks: [] });
    const { state } = context;
    const format = (n: number) => money(n, state.homeCurrency);
    const clientId = (name: string) => state.clients.find(c => c.name.startsWith(name))!.id;
    const starters = starterRecipes(state);
    const block = <T extends ResolvedBlock["type"]>(resolved: ResolvedBlock[], type: T, nth = 0) => resolved.filter((r): r is Extract<ResolvedBlock, { type: T }> => r.type === type)[nth];

    await check("every starter recipe is valid, resolves, and says in words what each block is", () => {
      assert.deepEqual(starters.map(s => s.id), [...STARTER_IDS]);
      for (const starter of starters) {
        assert.ok(RecipeSchema.safeParse(starter.recipe).success, starter.id);
        const resolved = resolveRecipe(starter.recipe, context);
        assert.equal(resolved.length, starter.recipe.blocks.length, starter.id);
        starter.recipe.blocks.forEach(blockWords);
        assert.ok(resolved.every(r => r.source.length > 0));
      }
    });

    await check("starter tables keep row names readable and put overflow in their own keyboard-accessible region", () => {
      const css = readFileSync("src/components/canvas/canvas.css", "utf8");
      const scroller = css.match(/\.canvas-table-scroll\s*\{([^}]*)\}/)?.[1] ?? "";
      assert.match(scroller, /min-width:\s*0\s*;/);
      assert.match(scroller, /overflow-x:\s*auto\s*;/);
      const nameCell = css.match(/\.canvas-table :is\(th, td\):first-child\s*\{([^}]*)\}/)?.[1] ?? "";
      assert.match(nameCell, /min-width:\s*8rem\s*;/);
      assert.match(nameCell, /overflow-wrap:\s*break-word\s*;/);

      const checked = new Set<string>();
      for (const starter of starters) {
        for (const resolved of resolveRecipe(starter.recipe, context)) {
          if (resolved.type !== "table") continue;
          const html = renderToStaticMarkup(createElement(TableBlock, { data: resolved.data }));
          const region = html.match(/<div\b(?=[^>]*class="canvas-table-scroll")([^>]*)><table\b/)?.[1];
          assert.ok(region, starter.id);
          assert.match(region, /\brole="region"/);
          assert.match(region, /\btabindex="0"/);
          assert.ok(region.includes(`aria-label="${resolved.data.title ?? "Canvas table"}"`));
          if (starter.id === "regular") {
            assert.match(html, /<th scope="row">CloudBox Plus \(Subscriptions\)<\/th>/);
            assert.match(html, /<th scope="row">Hikari Denki \(Utilities\)<\/th>/);
          }
          checked.add(starter.id);
        }
      }
      assert.ok(checked.has("regular") && checked.has("month-vs-last"));
    });

    await check("This month: the sentence is homeSentence, safe to spend, cash and the low point are the engine's, the action leads to Beacon's invoice", () => {
      const resolved = resolveRecipe(starters[0].recipe, context);
      const sentence = block(resolved, "sentence").data;
      assert.equal(sentence.text, homeSentence(state).text);
      assert.equal(sentence.text, "You're fine if Acme and Northwind pay as usual. If they're late, you're ¥18,780 short on the 27th.");
      const numbers = resolved.filter(r => r.type === "number").map(r => (r as Extract<ResolvedBlock, { type: "number" }>).data);
      assert.equal(numbers[0].value, format(safeToSpend(state, 0).amount));
      assert.equal(numbers[1].value, format(availableCash(state)));
      assert.equal(numbers[2].value, format(lowOf(state, "worst").amount));
      const chart = block(resolved, "flow_chart").data;
      assert.deepEqual(chart.points, [...series(state, "worst")]);
      assert.equal(chart.lowLabel, `${format(lowOf(state, "worst").amount)} · Nov 27`);
      const rows = block(resolved, "timeline").data.rows;
      const events = timeline(state, "expected");
      assert.deepEqual(rows.map(r => r.id), events.map(e => e.id));
      assert.equal(rows.length, events.length);
      const action = block(resolved, "action").data;
      assert.equal(action.href, `/invoices/${state.invoices.find(i => i.status === "unbilled")!.id}`);
      assert.equal(action.label, "Invoice Beacon");
      const acme = state.invoices.find(i => i.status === "sent" && i.clientId === state.clients.find(c => c.name.startsWith("Acme"))?.id)!;
      const nudge = starterRecipes(state, [acme.id])[0].recipe.blocks.find(b => b.type === "action");
      assert.deepEqual(nudge, { type: "action", label: "Nudge Acme", href: `/invoices/${acme.id}` });
      const toReview = starterRecipes({ ...state, invoices: [] })[0].recipe.blocks.find(b => b.type === "action");
      assert.deepEqual(toReview, { type: "action", label: "Open To check", href: "/to-check" });
      assert.equal(block(resolved, "sentence").source, "Worked out from your records");
      assert.equal(resolved.find(r => r.type === "number" && r.data.label === "Cash today")!.source, "From your records");
    });

    await check("the flow's low point equals low(series(...)) for both cases, and the low_point number agrees", () => {
      for (const [kind, scenarioCase] of [["expected", "usual"], ["worst", "late"]] as const) {
        const recipe: Recipe = { version: 1, title: "Flow", blocks: [
          { type: "flow_chart", query: { q: "flow", scenario: { case: scenarioCase, changes: [] } } },
          { type: "number", label: "Low", query: { q: "low_point", scenario: { case: scenarioCase, changes: [] } } },
        ] };
        const [chart, number] = resolveRecipe(recipe, context) as [Extract<ResolvedBlock, { type: "flow_chart" }>, Extract<ResolvedBlock, { type: "number" }>];
        const expected = low(series(state, kind));
        assert.deepEqual(chart.data.points, [...series(state, kind)]);
        assert.equal(chart.data.points[chart.data.lowIndex], expected.amount);
        assert.equal(chart.data.lowIndex, expected.dayIndex);
        assert.equal(number.data.value, format(expected.amount));
      }
      const sevenDays: Recipe = { version: 1, title: "Short", blocks: [{ type: "flow_chart", query: { q: "flow", days: 7 } }] };
      assert.equal((resolveRecipe(sevenDays, context)[0] as Extract<ResolvedBlock, { type: "flow_chart" }>).data.points.length, 7);
    });

    await check("27D: a 60-day timeline and flow from Nov 14 run to Jan 12 and hold the bills past the plan window", () => {
      const { state } = context;
      const through = addDays(state.today, 59);
      assert.equal(through, "2027-01-12");
      const wide = stateThrough(state, through);
      assert.ok(wide.bills.some(bill => bill.due > addDays(state.today, planWindow(state) - 1)), "a bill past the default window");
      const [flow, line] = resolveRecipe({ version: 1, title: "Sixty", blocks: [{ type: "flow_chart", query: { q: "flow", days: 60 } }, { type: "timeline", query: { q: "events", days: 60 } }] }, context) as [Extract<ResolvedBlock, { type: "flow_chart" }>, Extract<ResolvedBlock, { type: "timeline" }>];
      assert.deepEqual(flow.data.points, [...series(wide, "worst", 60)]);
      assert.equal(flow.data.points.length, 60);
      const direct = timeline(wide, "worst", 60);
      assert.equal(line.data.rows.length, direct.length);
      assert.ok(direct.some(event => event.date > addDays(state.today, planWindow(state) - 1)));
      assert.ok(direct.every(event => event.date <= through));
    });

    await check("What if clients pay late: every client late by (slowest − usual) gives the engine's own late case; the sliders read the scenario", () => {
      const recipe = starters[1].recipe;
      const resolved0 = resolveRecipe(recipe, context);
      const sliders = block(resolved0, "sliders").data.controls;
      assert.deepEqual(sliders.map(c => c.name).sort(), ["Acme Corp", "Northwind"]);
      assert.ok(sliders.every(c => c.days === 0 && c.maxDays === 30 && c.pace));
      assert.equal(block(resolved0, "flow_chart").data.points.join(), series(state, "expected").join(), "no slider moved: the usual case");
      assert.equal(block(resolved0, "sentence").live, true);
      assert.equal(block(resolved0, "sliders").live, false);
      // Acme: usual 14, slowest 25 → 11 days; Northwind: usual 12, slowest 16 → 4 days.
      const scenario = { case: "usual" as const, changes: [{ kind: "client_late" as const, clientId: clientId("Acme"), days: 11 }, { kind: "client_late" as const, clientId: clientId("Northwind"), days: 4 }] };
      const resolved = resolveRecipe(recipe, context, scenario);
      assert.deepEqual(block(resolved, "flow_chart").data.points, [...series(state, "worst")]);
      assert.equal(block(resolved, "number").data.value, format(lowOf(state, "worst").amount));
      assert.deepEqual(series(whatIf(state, scenario.changes), "expected"), series(state, "worst"));
      assert.equal(block(resolved, "sentence").data.text, homeSentence(whatIf(state, scenario.changes)).text);
      assert.match(block(resolved, "flow_chart").source, /with your what-if changes$/);
      assert.deepEqual(block(resolved, "sliders").data.controls.map(c => c.days).sort((x, y) => x - y), [4, 11]);
      // The state is the same afterwards, and a second draw is the same.
      assert.deepEqual(resolveRecipe(recipe, context, scenario), resolved);
      assert.equal(block(resolveRecipe(recipe, context), "flow_chart").data.points.join(), series(state, "expected").join());
    });

    await check("This month against last month: totals, the comparison and the table of changes are the month view's", () => {
      const resolved = resolveRecipe(starters[2].recipe, context);
      const october = monthByCategory(context.spending, TODAY, "2026-10"), november = monthByCategory(context.spending, TODAY, "2026-11");
      const numbers = resolved.filter(r => r.type === "number").map(r => (r as Extract<ResolvedBlock, { type: "number" }>).data);
      assert.deepEqual(numbers.map(n => n.value), [minorMoney(october.totalMinor, "JPY"), minorMoney(november.totalMinor, "JPY")]);
      assert.deepEqual(numbers.map(n => n.label), ["October", "November"]);
      const compare = block(resolved, "compare").data;
      const diff = november.totalMinor - october.totalMinor;
      assert.equal(compare.difference, `${diff > 0 ? "+" : "−"}${minorMoney(Math.abs(diff), "JPY")}`);
      const categories = new Set([...october.categories, ...november.categories].map(c => c.label));
      assert.equal(compare.rows.length, categories.size);
      for (const row of compare.rows) {
        assert.equal(row.aMinor, october.categories.find(c => c.label === row.label)?.totalMinor ?? 0);
        assert.equal(row.bMinor, november.categories.find(c => c.label === row.label)?.totalMinor ?? 0);
      }
      const sizes = compare.rows.map(r => Math.abs(r.bMinor - r.aMinor));
      assert.deepEqual(sizes, [...sizes].sort((x, y) => y - x), "biggest change first");
      const table = block(resolved, "table").data;
      assert.deepEqual(table.head, ["Category", "October", "November", "Change"]);
      assert.deepEqual(table.foot, ["Total", minorMoney(october.totalMinor, "JPY"), minorMoney(november.totalMinor, "JPY"), compare.difference]);
      assert.equal(block(resolved, "compare").source, "Worked out from your records");
    });

    await check("Regular costs, month totals, by category and the spending search are the engine's own", () => {
      const resolved = resolveRecipe(starters[3].recipe, context);
      const items = spendingItems(context.spending, monthBounds(monthsBack("2026-11", 3)).first, monthBounds("2026-11").last);
      const regular = regularCosts(items, "JPY", TODAY, 3);
      const table = block(resolved, "table").data;
      assert.equal(table.rows.length, regular.items.length);
      assert.equal(table.caption, regular.changedLine);
      assert.equal(block(resolved, "table").source, "From your records");
      assert.equal(block(resolved, "action").data.href, "/spending");
      const more: Recipe = { version: 1, title: "More", blocks: [
        { type: "table", query: { q: "month_by_category", month: "2026-11" } },
        { type: "table", query: { q: "spending_search", text: "market", months: 3 } },
        { type: "progress", label: "Cash goal", query: { q: "cash" }, targetMinor: 300_000 },
        { type: "table", query: { q: "events", days: 14, scenario: { case: "late", changes: [{ kind: "add_cost", name: "Fictional lamp", amountMinor: 10_000, date: "2026-11-16" }] } } },
      ] };
      const [month, search, progress, events] = resolveRecipe(more, context) as Extract<ResolvedBlock, { type: "table" | "progress" }>[];
      const november = monthByCategory(context.spending, TODAY, "2026-11");
      assert.deepEqual((month as Extract<ResolvedBlock, { type: "table" }>).data.foot, ["Total", minorMoney(november.totalMinor, "JPY")]);
      assert.equal((month as Extract<ResolvedBlock, { type: "table" }>).data.rows.length, november.categories.length);
      const found = (search as Extract<ResolvedBlock, { type: "table" }>).data;
      assert.ok(found.rows.length >= 1 && found.rows.every(r => /20\d\d$/.test(r.cells[0])));
      assert.ok(progress.type === "progress" && !("rows" in progress.data));
      assert.equal(progress.data.valueLabel, format(availableCash(state)));
      assert.equal(progress.data.valueMinor, availableCash(state));
      const ev = (events as Extract<ResolvedBlock, { type: "table" }>).data;
      assert.ok(ev.rows.some(r => r.cells[1] === "Fictional lamp" && r.cells[2] === "−¥10,000"));
      assert.match(events.source, /with your what-if changes$/);
    });

    await check("a month outside the twelve kept, a bad slider client and a bad scenario are refused in words", () => {
      const refuse = (recipe: Recipe, canvas?: Parameters<typeof resolveRecipe>[2]) => assert.throws(() => resolveRecipe(recipe, context, canvas), error => error instanceof CanvasError && error.message.length > 10);
      refuse({ version: 1, title: "Old", blocks: [{ type: "number", label: "Then", query: { q: "month_total", month: "2025-01" } }] });
      refuse({ version: 1, title: "Later", blocks: [{ type: "number", label: "Then", query: { q: "month_total", month: "2027-01" } }] });
      refuse({ version: 1, title: "Slider", blocks: [{ type: "sliders", controls: [{ clientId: "nobody", maxDays: 10 }] }] });
      refuse(starters[1].recipe, { case: "usual", changes: [{ kind: "client_late", clientId: "nobody", days: 2 }] });
      refuse({ version: 1, title: "x", blocks: [{ type: "note", text: "x", by: "you", amountMinor: 5 } as never] });
    });

    await check("the route's function: reads only, refuses a bad body and an outside link", async () => {
      const before = JSON.stringify(await loadCanvasContext(db, a, { blocks: [] }));
      const ok = await resolveCanvasRequest(db, a, { recipe: starters[1].recipe, scenario: { case: "usual", changes: [{ kind: "client_late", clientId: clientId("Acme"), days: 5 }] } });
      assert.equal(ok.length, starters[1].recipe.blocks.length);
      assert.equal(JSON.stringify(await loadCanvasContext(db, a, { blocks: [] })), before, "nothing was written");
      await assert.rejects(resolveCanvasRequest(db, a, { recipe: { version: 1, title: "x", blocks: [{ type: "action", label: "Go", href: "https://evil.example" }] } }), error => error instanceof CanvasError && /inside the app/.test(error.message));
      await assert.rejects(resolveCanvasRequest(db, a, { recipe: starters[0].recipe, extra: true }), CanvasError);
      await assert.rejects(resolveCanvasRequest(db, a, "nonsense"), CanvasError);
      await assert.rejects(resolveCanvasRequest(db, "", { recipe: starters[0].recipe }), /household id/);
    });

    await check("bills_for_month: a table lists the bills a month is for (a November bill due Dec 27 is in November, not December), the context loads them only when asked, and the JSON Schema names the query", async () => {
      const c = await seedBen(db, { isDemo: true });
      await db.insert(schema.bills).values([
        { id: crypto.randomUUID(), householdId: c, biller: "Harbor Energy", amountMinor: 9_800, currency: "JPY", due: "2026-12-27", category: "utilities", periodStart: "2026-11-01", periodEnd: "2026-11-30" },
        { id: crypto.randomUUID(), householdId: c, biller: "Harbor Gas", amountMinor: null, currency: "JPY", due: null, category: "utilities", periodStart: "2026-11-01", periodEnd: "2026-11-30" },
      ]);
      const table = (month: string, text?: string): Recipe => ({ version: 1, title: "Bills", blocks: [{ type: "table", title: "For the month", query: { q: "bills_for_month", month, ...(text !== undefined && { text }) } }] });
      assert.ok(RecipeSchema.safeParse(table("2026-11")).success && !RecipeSchema.safeParse(table("2026-13")).success);
      assert.ok(!RecipeSchema.safeParse({ version: 1, title: "x", blocks: [{ type: "number", label: "x", query: { q: "bills_for_month", month: "2026-11" } }] }).success, "a table query only");
      assert.ok(JSON.stringify(JSON.parse(recipeJsonSchema())).includes("bills_for_month"));
      assert.match(blockWords(table("2026-11", "harbor").blocks[0]), /bills for November 2026 that match "harbor"/);
      const bare = await loadCanvasContext(db, c, { blocks: [] });
      assert.equal(bare.periodBills, undefined);
      assert.throws(() => resolveRecipe(table("2026-11"), bare), error => error instanceof CanvasError && /bills for a month were not loaded/.test(error.message));
      const nov = table("2026-11"), ctx = await loadCanvasContext(db, c, nov);
      assert.equal(ctx.periodBills?.length, 2);
      const [block] = resolveRecipe(nov, ctx);
      assert.equal(block.type, "table");
      if (block.type === "table") {
        assert.deepEqual(block.data.head, ["Bill", "Amount", "Due"]);
        assert.deepEqual(block.data.rows.map(r => r.cells), [["Harbor Energy (11月分)", "¥9,800", "Dec 27"], ["Harbor Gas (11月分)", "amount not known", "date not known"]]);
        assert.deepEqual(block.data.foot, ["Total", "¥9,800", ""]);
        assert.match(block.data.caption ?? "", /month_by_category/);
      }
      const [dec] = resolveRecipe(table("2026-12"), ctx);
      assert.ok(dec.type === "table" && dec.data.rows.length === 0 && /No bill names December 2026/.test(dec.data.empty ?? ""));
      assert.throws(() => resolveRecipe(table("2029-01"), ctx), error => error instanceof CanvasError && /two years/.test(error.message));
    });

    await check("foreign_costs: a table and a number resolve to the engine's numbers, and the context loads the inputs only when asked", async () => {
      const recipe: Recipe = { version: 1, title: "Foreign costs", blocks: [
        { type: "number", label: "What foreign money cost", query: { q: "foreign_costs" } },
        { type: "table", title: "By client and card", query: { q: "foreign_costs" } },
      ] };
      assert.ok(RecipeSchema.safeParse(recipe).success);
      assert.equal(JSON.parse(recipeJsonSchema()).definitions === undefined && JSON.stringify(JSON.parse(recipeJsonSchema())).includes("foreign_costs"), true, "the JSON Schema names the query");
      assert.ok(!RecipeSchema.safeParse({ version: 1, title: "x", blocks: [{ type: "progress", label: "x", query: { q: "foreign_costs" }, targetMinor: 1000 }] }).success, "not a progress query");
      assert.ok(blockWords(recipe.blocks[1]).includes("foreign money"));
      // Without the query the loader reads no inputs, and drawing the query fails in words.
      const bare = await loadCanvasContext(db, a, { blocks: [] });
      assert.equal(bare.foreignCosts, undefined);
      assert.throws(() => resolveRecipe(recipe, bare), error => error instanceof CanvasError && /foreign costs/.test(error.message));
      const withFx = await loadCanvasContext(db, a, recipe);
      assert.ok(withFx.foreignCosts);
      const [number, table] = resolveRecipe(recipe, withFx);
      assert.equal(number.type, "number");
      const fx = withFx.foreignCosts!;
      const jpy = (n: number) => minorMoney(n, "JPY");
      assert.equal(fx.payoutTotals.count, 16);
      assert.equal(fx.payoutTotals.costMinor, 111_637);
      assert.equal(fx.payoutTotals.receiveFeeMinor, 65_913);
      assert.equal(fx.payoutTotals.markupMinor, 45_724);
      if (number.type === "number") {
        const total = fx.payoutTotals.costMinor + fx.chargeTotals.exactMinor + fx.chargeTotals.estimatedMinor;
        assert.ok(number.data.value.includes(jpy(total).replace(/^about /, "")), number.data.value);
        assert.equal(number.source, "Worked out from your records");
      }
      assert.equal(table.type, "table");
      if (table.type === "table") {
        const row = (name: string) => table.data.rows.find(r => r.cells[0].startsWith(name));
        assert.equal(row("Acme")!.cells[1], jpy(52_545));
        assert.equal(row("Northwind")!.cells[1], jpy(36_850));
        assert.equal(row("Beacon")!.cells[1], jpy(22_242));
        assert.ok(row("Acme")!.cells[2].includes(jpy(fx.perClient.find(c => c.clientName.startsWith("Acme"))!.receiveFeeMinor)));
        assert.equal(table.data.rows.length, fx.perClient.length + fx.perCard.length);
        assert.equal(table.data.empty, null);
        assert.equal(table.data.title, "By client and card");
        assert.equal(table.data.head.length, table.data.rows[0].cells.length);
        assert.ok(table.data.caption?.includes(jpy(111_637)), "the payout words are the caption");
      }
      assert.equal(JSON.stringify(resolveRecipe(recipe, withFx)), JSON.stringify(resolveRecipe(recipe, await loadCanvasContext(db, a, recipe))), "the same numbers twice");
      // Ben's seed has no foreign card charge (Fontly Cloud is typed in by hand, qa/README AE): the $24 charge billed ¥3,710 at 150 costs ¥110.
      const fontly = { ...withFx, foreignCosts: foreignCosts({
        today: TODAY, homeCurrency: "JPY", rates: [{ date: "2026-01-01", perUsd: 150 }], cards: [{ id: "c1", label: "Card A", currency: "JPY", foreignFeeBp: null }], invoices: [],
        charges: [{ id: "x1", cardId: "c1", merchant: "Fontly Cloud", date: "2026-11-10", amountMinor: 3710, original: { amountMinor: 2400, currency: "USD" }, fxEstimated: false }],
      }) };
      const [fn, ft] = resolveRecipe(recipe, fontly);
      if (fn.type === "number") assert.equal(fn.data.value, jpy(110));
      if (ft.type === "table") { assert.equal(ft.data.rows.length, 1); assert.equal(ft.data.rows[0].cells[0], "Card A"); assert.equal(ft.data.rows[0].cells[1], jpy(110)); assert.deepEqual(ft.data.foot, ["Total", jpy(110), ""]); }
      // A household with no foreign activity: the empty words and a zero number.
      const quiet = { ...withFx, foreignCosts: foreignCosts({ today: TODAY, homeCurrency: "JPY", rates: [], cards: [], charges: [], invoices: [] }) };
      const [zero, none] = resolveRecipe(recipe, quiet);
      if (zero.type === "number") assert.equal(zero.data.value, jpy(0));
      if (none.type === "table") { assert.equal(none.data.rows.length, 0); assert.equal(none.data.foot, null); assert.equal(none.data.caption, null); assert.match(none.data.empty!, /No payouts or card purchases/); }
    });

    await check("goals progress asks for live dated pots without saving amounts in the recipe", async () => {
      const goalsHome = await seedBen(db, { isDemo: true });
      const recipe: Recipe = { version: 1, title: "Goals", blocks: [{ type: "progress", query: { q: "goals" } }] };
      assert.deepEqual(RecipeSchema.parse(recipe), recipe);
      for (const block of [
        { type: "progress", query: { q: "goals" }, targetMinor: 50_000 },
        { type: "progress", query: { q: "goals", savedMinor: 12_000 } },
        { type: "number", label: "Goals", query: { q: "goals" } },
      ]) assert.ok(!RecipeSchema.safeParse({ ...recipe, blocks: [block] }).success);
      assert.match(blockWords(recipe.blocks[0]), /each dated goal/);
      const draw = async (hid: string) => {
        const [block] = await resolveCanvasRequest(db, hid, { recipe });
        assert.ok(block.type === "progress" && "rows" in block.data);
        return { ...block, data: block.data };
      };
      assert.deepEqual((await draw(goalsHome)).data, { rows: [], empty: "No dated goals yet." });

      const camera = { id: crypto.randomUUID(), name: "Camera", target: "120000", targetDate: "2027-06-30",
        saved: "20000", fillPct: null, memberId: null };
      await savePot(db, goalsHome, camera, "confirmed", { madeBy: "form" });
      await savePot(db, goalsHome, { ...camera, id: crypto.randomUUID(), name: "Trip", target: "50000", saved: "50000" }, "confirmed", { madeBy: "form" });
      await savePot(db, goalsHome, { ...camera, id: crypto.randomUUID(), name: "No date", targetDate: null }, "confirmed", { madeBy: "form" });
      await savePot(db, goalsHome, { ...camera, id: crypto.randomUUID(), name: "Pending" }, "pending", { madeBy: "form" });
      const first = await draw(goalsHome);
      assert.equal(first.data.empty, null);
      assert.deepEqual(first.data.rows.map(row => row.label).sort(), ["Camera", "Trip"]);
      const saved = first.data.rows.find(row => row.id === camera.id)!;
      assert.deepEqual([saved.valueLabel, saved.targetLabel, saved.targetDate], ["¥20,000", "¥120,000", "2027-06-30"]);
      assert.match(saved.summary, /a month to reach ¥120,000/);
      assert.match(canvasSummary([first]), /¥20,000/);
      assert.deepEqual((await draw(b)).data, { rows: [], empty: "No dated goals yet." });

      await savePot(db, goalsHome, { ...camera, saved: "32000" }, "confirmed", { madeBy: "form" });
      assert.equal((await draw(goalsHome)).data.rows.find(row => row.id === camera.id)?.valueLabel, "¥32,000");
      assert.deepEqual(JSON.parse(JSON.stringify(recipe)).blocks[0], { type: "progress", query: { q: "goals" } });
    });

    await check("the summary make_canvas returns names each block and its values, never a note's or a letter's text", async () => {
      const recipe: Recipe = { version: 1, title: "Summary", blocks: [
        { type: "sentence", query: { q: "sentence" } }, { type: "number", label: "Cash today", query: { q: "cash" } },
        { type: "note", text: "Private note words", by: "assistant" }, { type: "letter", text: "Private letter words" },
      ] };
      const blocks = resolveRecipe(recipe, await loadCanvasContext(db, a, { blocks: [] }));
      const summary = canvasSummary(blocks);
      const parsed = JSON.parse(summary) as { blocks: { block: number; type: string; text?: string; label?: string; value?: string }[] };
      assert.deepEqual(parsed.blocks.map(b => b.type), ["sentence", "number", "note", "letter"]);
      assert.match(parsed.blocks[0].text!, /18,780 short/);
      assert.equal(parsed.blocks[1].label, "Cash today");
      assert.match(parsed.blocks[1].value!, /^¥[\d,]+$/);
      assert.ok(!summary.includes("Private"), "the model wrote those words; they are not fed back as a source");
    });

    console.log(`Canvas checks passed (${passed}).`);
  } finally {
    await pg.close();
  }
}

main().catch(error => {
  console.error("Canvas tests failed", error);
  process.exit(1);
});
