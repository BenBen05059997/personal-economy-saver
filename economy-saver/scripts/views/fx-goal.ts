// Foreign costs by month and a goal's pace (D62, D77): fx_cost and goal_pace on Ben's sample and on fixtures, and the goal-line form. Fictional data only; PGlite, no credentials.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { foreignCostInputs } from "@/db/fx-cost";
import { loadMoneyState } from "@/db/household";
import { seedBen } from "@/db/seed";
import { unconfirmedAmounts } from "@/lib/ai/number-check";
import { foreignCosts, fxByMonth } from "@/lib/money/fx-cost";
import { goalPace } from "@/lib/money/goals";
import type { Pot } from "@/lib/money/types";
import { resolveView } from "@/lib/views/resolve";
import { VIEW_META } from "@/lib/views/catalogue";
import { ViewError, type ViewResult } from "@/lib/views/types";
import { GoalLine } from "@/components/views/forms/GoalLine";
import { StackedColumns } from "@/components/views/forms/StackedColumns";

let passed = 0;
async function check(name: string, run: () => void | Promise<void>) { await run(); passed++; console.log(`✓ ${name}`); }
const TODAY = "2026-11-14";

async function main() {
  const pg = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(pg, { schema });
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    const ben = await seedBen(db, { isDemo: true });
    const state = await loadMoneyState(db, ben, TODAY);
    const costs = foreignCosts(await foreignCostInputs(db, ben, TODAY));
    const ctx = { state, foreignCosts: costs };

    await check("fx_cost: the monthly payout costs sum to the total, ¥111,637, and the view is Ask only", () => {
      assert.equal(costs.payoutTotals.costMinor, 111_637);
      const months = fxByMonth(costs, TODAY, 6);
      assert.deepEqual(months.map(m => m.month), ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
      assert.equal(months.reduce((sum, m) => sum + m.payoutMinor, 0), 111_637);
      const result = resolveView("fx_cost", {}, ctx) as ViewResult<"stacked_columns">;
      assert.equal(result.data!.columns.reduce((sum, c) => sum + c.total, 0), 111_637);
      for (const c of result.data!.columns) assert.equal(c.parts.reduce((a, b) => a + b, 0), c.total);
      assert.equal(result.figures.totalMinor, 111_637);
      assert.equal(result.table!.foot![3], "¥111,637");
      assert.equal(result.table!.rows.length, 6);
      assert.deepEqual(unconfirmedAmounts(result.line ?? "", [JSON.stringify(result.figures)]), []);
      assert.equal(VIEW_META.fx_cost.askOnly, true);
      assert.equal(VIEW_META.fx_cost.home, null);
      assert.match(renderToStaticMarkup(createElement(StackedColumns, { result })), /sc-col/);
      assert.equal(resolveView("fx_cost", { months: 12 }, ctx).figures.totalMinor, 111_637);
      assert.throws(() => resolveView("fx_cost", { months: 1 }, ctx), ViewError);
    });

    await check("fx_cost: an estimated card cost is marked about, in the column, the table and the line; an unknown one is counted, not priced", () => {
      const input = {
        today: TODAY, homeCurrency: "JPY", rates: [{ date: "2026-01-01", perUsd: 150 }], cards: [{ id: "c1", label: "Card A", currency: "JPY", foreignFeeBp: 220 }, { id: "c2", label: "Card B", currency: "JPY", foreignFeeBp: null }],
        charges: [
          { id: "x1", cardId: "c1", merchant: "Hotel", date: "2026-10-12", amountMinor: 15_000, original: { amountMinor: 10_000, currency: "USD" }, fxEstimated: true },
          { id: "x2", cardId: "c2", merchant: "Cafe", date: "2026-10-13", amountMinor: 1_500, original: { amountMinor: 1_000, currency: "USD" }, fxEstimated: true },
        ], invoices: [],
      };
      const estimate = foreignCosts(input), result = resolveView("fx_cost", { months: 3 }, { state, foreignCosts: estimate }) as ViewResult<"stacked_columns">;
      const october = result.data!.columns.find(c => c.key === "2026-10")!;
      assert.equal(october.total, Math.round(15_000 * 220 / 10_000)); // the reference-rate conversion of $100 at 150 is ¥15,000
      assert.equal(october.totalLabel, "about ¥330");
      assert.equal(result.table!.rows.find(r => r.key === "2026-10")!.cells[3], "about ¥330");
      assert.match(result.line!, /about ¥330/);
      assert.match(result.line!, /1 purchase in another currency has no cost yet/);
    });

    await check("fx_cost: nothing foreign yet says what shows it", () => {
      const none = resolveView("fx_cost", {}, { state, foreignCosts: foreignCosts({ today: TODAY, homeCurrency: "JPY", rates: [], cards: [], charges: [], invoices: [] }) });
      assert.equal(none.data, null);
      assert.match(none.empty!.words, /once a client has paid you in dollars/);
    });

    const pot = (over: Partial<Pot> = {}): Pot => ({ id: "pot-trip", name: "Trip to Osaka", saved: 15_000, target: 60_000, targetDate: "2027-03-31", startedOn: "2026-11-01", ...over });
    const withPots = (...pots: Pot[]) => ({ state: { ...state, pots } });

    await check("goal_pace: the points equal goalPace (expected by today, projection date), the line is its summary", () => {
      const p = pot(), goal = goalPace(p, state)!;
      const result = resolveView("goal_pace", { potId: p.id }, withPots(p)) as ViewResult<"goal_line">;
      assert.deepEqual(result.data!.start, { date: "2026-11-01", minor: 0 });
      assert.equal(result.data!.target.minor, 60_000);
      assert.equal(result.data!.target.date, "2027-03-31");
      assert.equal(result.data!.today.minor, 15_000);
      assert.equal(result.data!.expected.minor, goal.expectedMinor);
      assert.equal(result.data!.projection!.date, goal.reachedOn);
      assert.equal(result.line, goal.summary);
      assert.equal(result.figures.deltaMinor, goal.deltaMinor);
      assert.deepEqual(unconfirmedAmounts(result.line ?? "", [JSON.stringify(result.figures)]), []);
      assert.equal(result.table!.rows.length, 4);
    });

    await check("goal_pace: a reached target draws today as the projection; a pot with no target or date is not a goal; unknown pot refused", () => {
      const done = resolveView("goal_pace", { potId: "pot-trip" }, withPots(pot({ saved: 60_000 }))) as ViewResult<"goal_line">;
      assert.equal(done.line, "Target reached.");
      assert.equal(done.data!.projection!.date, TODAY);
      for (const bare of [pot({ target: undefined }), pot({ targetDate: undefined })]) {
        const none = resolveView("goal_pace", { potId: bare.id }, withPots(bare));
        assert.equal(none.data, null);
        assert.match(none.empty!.words, /target and a date/);
      }
      assert.throws(() => resolveView("goal_pace", { potId: "nope" }, withPots(pot())), (e: unknown) => e instanceof ViewError && /couldn't find that pot/.test(e.message));
      assert.throws(() => resolveView("goal_pace", {}, withPots(pot())), ViewError);
    });

    await check("the goal-line form draws the goal's line, the saved dot, the pace line and the legend", () => {
      const result = resolveView("goal_pace", { potId: "pot-trip" }, withPots(pot())) as ViewResult<"goal_line">;
      const html = renderToStaticMarkup(createElement(GoalLine, { result }));
      assert.ok(html.includes(`aria-label="${result.aria}"`));
      assert.equal((html.match(/class="gl-goal"/g) ?? []).length, 1);
      assert.equal((html.match(/class="gl-saved"/g) ?? []).length, 1);
      assert.equal((html.match(/class="gl-pace"/g) ?? []).length, 1);
      assert.ok(html.includes("Where the goal expects you") && html.includes("Saved ¥15,000"));
    });
  } finally {
    await pg.close();
  }
  console.log(`\n${passed} checks passed`);
}

export const done = main();
