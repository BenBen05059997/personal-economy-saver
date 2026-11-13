// Where you stand and the what-if ghost (D77), on Ben's sample: the waterfall's numbers, the ghost line, the step-line form with and without a ghost, and the starter.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { seedBen } from "@/db/seed";
import { unconfirmedAmounts } from "@/lib/ai/number-check";
import { resolveRecipe } from "@/lib/canvas/resolve";
import { starterRecipes } from "@/lib/canvas/starters";
import { ViewFigure } from "@/components/views/ViewFigure";
import { positionSteps } from "@/lib/money/position";
import { low, series } from "@/lib/money/runway";
import { loadViewContext } from "@/lib/views/load";
import { resolveView } from "@/lib/views/resolve";
import type { ViewResult } from "@/lib/views/types";
import { forecastView } from "@/lib/views/v/forecast";

let passed = 0;
async function check(name: string, run: () => void | Promise<void>) { await run(); passed++; console.log(`✓ ${name}`); }

async function main() {
  const pg = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(pg, { schema });
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    const hid = await seedBen(db, { isDemo: true });
    const ctx = await loadViewContext(db, hid, ["spending"]);
    const { state } = ctx;

    await check("Ben's position: bank 67,000 + PayPal 61,000 = 128,000; cards owed 86,450 and 61,000; clients owe 300,000; net 280,550", () => {
      const result = resolveView("position", {}, ctx) as ViewResult<"waterfall">;
      assert.deepEqual(result.figures, { bankMinor: 67_000, paypalMinor: 61_000, cashMinor: 128_000, potsMinor: 0, cardsOwedMinor: 147_450, clientsOwedMinor: 300_000, netMinor: 280_550 });
      const steps = result.data!.steps;
      assert.deepEqual(steps.map(step => [step.label, step.kind, step.minor]), [
        ["Bank", "start", 67_000], ["PayPal", "plus", 61_000], ["Cash to spend", "subtotal", 128_000],
        ["Card A owed", "minus", -86_450], ["Card B owed", "minus", -61_000], ["Clients owe you", "plus", 300_000], ["What you have", "total", 280_550]]);
      assert.deepEqual(steps.filter(step => step.about).map(step => step.key), ["clients", "net"], "the invoices not yet paid are a guess");
      assert.deepEqual(positionSteps(state), steps);
      assert.deepEqual(unconfirmedAmounts(result.line ?? "", [JSON.stringify(result.figures)]), []);
      assert.ok(result.table!.rows.length === steps.length);
    });

    await check("a household with nothing says what to add", () => {
      const result = resolveView("position", {}, { state: { ...state, bank: 0, paypal: 0, cards: [], charges: [], statements: [], invoices: [], bills: [] } });
      assert.ok(result.empty && result.data === null && /Add a bill/.test(result.empty.addLabel ?? ""));
    });

    await check("pots come off the cash and show as their own step", () => {
      const steps = positionSteps({ ...state, pots: [{ id: "p", name: "Tax", saved: 20_000 }] });
      assert.deepEqual(steps.slice(0, 4).map(step => [step.key, step.minor]), [["bank", 67_000], ["paypal", 61_000], ["pots", -20_000], ["cash", 108_000]]);
    });

    await check("what_if {amountMinor: 40000}: low −58,780 on Nov 27, ghost −18,780, and the ghost is the forecast's late line", () => {
      const result = resolveView("what_if", { amountMinor: 40_000 }, ctx) as ViewResult<"step_line">;
      assert.equal(result.figures.lowWithMinor, -58_780);
      assert.equal(result.figures.lowWithDate, "2026-11-27");
      assert.equal(result.figures.lowNowMinor, -18_780);
      const data = result.data!, main = data.lines.find(l => l.key === "main")!, ghost = data.lines.find(l => l.key === "ghost")!;
      assert.deepEqual(data.lines.map(l => l.tone), ["main", "ghost"]);
      assert.deepEqual(ghost.points, forecastView({ case: "late" }, ctx).data && (forecastView({ case: "late" }, ctx) as ViewResult<"step_line">).data!.lines[0].points);
      assert.equal(low(series(state, "worst"), state.today).amount, -18_780);
      assert.equal(main.points[0], ghost.points[0] - 40_000, "today's balance is lower by the spend");
      assert.equal(data.low.label, "Short ¥58,780 on Fri, Nov 27");
      assert.deepEqual(data.marks, [], "a spend today needs no mark");
      assert.ok(!Object.values(result.figures).includes(40_000), "the amount asked about is not repeated as a figure");
      assert.deepEqual(unconfirmedAmounts(result.line ?? "", [JSON.stringify(result.figures)]), []);
    });

    await check("what_if with a date later in the month spends on that day; a late client moves the usual case; bad asks are refused in words", () => {
      const dated = resolveView("what_if", { amountMinor: 40_000, date: "2026-11-20" }, ctx) as ViewResult<"step_line">;
      const main = dated.data!.lines[0].points, ghost = dated.data!.lines[1].points;
      assert.equal(main[5], ghost[5], "nothing differs before the day");
      assert.equal(main[6], ghost[6] - 40_000);
      assert.deepEqual(dated.data!.marks, [{ index: 6, label: "Your spend" }]);
      const acme = state.clients.find(c => c.name.startsWith("Acme"))!;
      const late = resolveView("what_if", { late: { clientId: acme.id, days: 10 } }, ctx) as ViewResult<"step_line">;
      assert.equal(late.data!.lines[1].key, "ghost");
      assert.notDeepEqual(late.data!.lines[0].points, late.data!.lines[1].points);
      assert.deepEqual(late.data!.lines[1].points, series(state, "expected").map(v => Math.round(v)));
      assert.throws(() => resolveView("what_if", {}, ctx), /an amount to spend, or one client/);
      assert.throws(() => resolveView("what_if", { amountMinor: 100, late: { clientId: acme.id, days: 3 } }, ctx), /not both/);
      assert.throws(() => resolveView("what_if", { late: { clientId: "nobody", days: 3 } }, ctx), /not in your records/);
      assert.throws(() => resolveView("what_if", { amountMinor: 100, date: "2020-01-01" }, ctx), /today or later/);
    });

    await check("the figures draw: the waterfall's aria and bars, the ghost's dashed line, and Home's forecast has no ghost", () => {
      const html = renderToStaticMarkup(createElement(ViewFigure, { result: resolveView("position", {}, ctx) }));
      assert.match(html, /Card A owed/);
      assert.match(html, /about <!-- -->\+¥300,000|about .*¥300,000/);
      assert.match(html, /wf-about/);
      const ghost = renderToStaticMarkup(createElement(ViewFigure, { result: resolveView("what_if", { amountMinor: 40_000 }, ctx) }));
      assert.match(ghost, /sl-t-ghost/);
      assert.match(ghost, /sl-dot-ghost/);
      assert.match(ghost, /As things are now/);
      const home = renderToStaticMarkup(createElement(ViewFigure, { result: forecastView({}, ctx) }));
      assert.doesNotMatch(home, /ghost/);
    });

    await check("the starter Where you stand is a position view and resolves", () => {
      const starter = starterRecipes(state).find(item => item.id === "where-you-stand")!;
      assert.deepEqual(starter.recipe.blocks, [{ type: "view", view: "position", args: {} }]);
      const [block] = resolveRecipe(starter.recipe, { state, spending: ctx.spending! });
      assert.ok(block.type === "view" && block.data.form === "waterfall" && block.data.figures.netMinor === 280_550);
    });
  } finally {
    await pg.close();
  }
  console.log(`position: ${passed} checks passed`);
}

export const done = main();
