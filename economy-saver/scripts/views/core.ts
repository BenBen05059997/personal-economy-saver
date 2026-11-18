// The views over the canvas (D77): the view registry, the loaders and every view, generic over the registry, on a seeded Ben household.
// Fictional data only; PGlite, no credentials. Exports `done`, the promise of its checks, for the runner.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { seedBen } from "@/db/seed";
import { unconfirmedNumbers } from "@/lib/ai/number-check";
import { termOf } from "@/lib/money/terms";
import { loadCanvasContext } from "@/lib/canvas/request";
import { resolveRecipe } from "@/lib/canvas/resolve";
import type { Recipe } from "@/lib/canvas/schema";
import { ViewFigure } from "@/components/views/ViewFigure";
import { VIEW_META } from "@/lib/views/catalogue";
import { loadViewContext } from "@/lib/views/load";
import { resolveView } from "@/lib/views/resolve";
import type { ViewContext, ViewId } from "@/lib/views/types";
import { createChecks, openDb } from "../fixtures/harness";

const { check, tally } = createChecks();
const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
/** Ben has no pots: the views that take one draw this pot, with a tax bill to meet, added to his state. */
const FIXTURE_POT = { id: "pot-fixture", name: "Tax", saved: 10_000, target: 60_000, targetDate: "2027-03-31", startedOn: "2026-11-01", fillPct: 20 };
const withPot = (ctx: ViewContext): ViewContext => ({ ...ctx, state: { ...ctx.state, pots: [FIXTURE_POT], bills: [...ctx.state.bills, { id: "bill-fixture-tax", biller: "Resident tax", amount: 40_000, due: "2026-12-20", category: "government_tax" as const, businessBp: 0, status: "confirmed" as const }] } });
/** The arguments a view needs to draw at all (the ones it requires); a view with none draws on `{}`. A later stage adds a line here for each view that takes a required id. */
const defaultArgs = (view: ViewId, ctx: ViewContext): Record<string, unknown> => {
  switch (view) {
    case "search_months": return { text: "rent" };
    case "goal_pace": case "tax_ahead": case "pot_story": return { potId: FIXTURE_POT.id };
    case "card_cycle": return { cardId: ctx.state.cards[0].id };
    case "what_changed": return { itemId: ctx.state.bills.find(bill => bill.status === "pending")!.id };
    case "what_if": return { amountMinor: 40_000 };
    default: return {};
  }
};

async function main() {
  const { pg, db } = await openDb();
  try {
    const hid = await seedBen(db, { isDemo: true });
    const all = Object.keys(VIEW_META) as ViewId[];
    const needs = [...new Set(all.flatMap(view => VIEW_META[view].needs))];
    const ctx = await loadViewContext(db, hid, needs);

    await check("the context holds what the needs name, and income and pot moves as integer minor units", () => {
      assert.ok(ctx.spending && ctx.income && ctx.moves && ctx.foreignCosts);
      assert.equal(ctx.income!.length, 16);
      assert.ok(ctx.income!.every(row => row.homeMinor !== null && Number.isInteger(row.homeMinor) && row.sentOn !== null && row.clientId !== null));
      assert.deepEqual(ctx.moves, [], "Ben has no pots");
    });

    await check("loadViewContext reads only what is asked", async () => {
      const bare = await loadViewContext(db, hid, []);
      assert.ok(bare.state && !bare.spending && !bare.income && !bare.moves && !bare.foreignCosts);
      const some = await loadViewContext(db, hid, ["income"], { state: bare.state });
      assert.equal(some.state, bare.state, "the state the caller has is used as it is");
      assert.ok(some.income && !some.spending);
    });

    for (const view of all) {
      await check(`${view}: form, default arguments, integer facts, checked words, table or empty, aria and a figure`, () => {
        const drawn = view === "goal_pace" || view === "tax_ahead" || view === "pot_story" ? withPot(ctx) : ctx, args = defaultArgs(view, drawn);
        const result = resolveView(view, args, drawn);
        assert.equal(result.view, view);
        assert.equal(result.form, VIEW_META[view].form, "VIEW_META and the resolver agree on the form");
        for (const item of result.facts) if (item.unit === "money") assert.ok(Number.isInteger(item.value), `${item.name} is an integer`);
        // D79: nothing is stated only in words. Every number in the line is one of the view's facts, and every fact name is a term.
        assert.deepEqual(unconfirmedNumbers(result.line ?? "", result.facts, { today: drawn.state.today }), [], "every number in the line is one of the view's facts");
        for (const item of result.facts) assert.doesNotThrow(() => termOf(item.name), `${item.name} is a term`);
        if (result.empty === null) assert.ok(result.facts.length > 0, "a view with a picture carries facts");
        assert.deepEqual(unconfirmedNumbers(result.empty?.words ?? "", result.facts, { today: drawn.state.today }), [], "every number in an empty state's words is one of the view's facts");
        assert.ok(result.table !== null || result.empty !== null, "a table or an empty state");
        assert.equal(result.data === null, result.empty !== null, "data is null exactly when empty is set");
        assert.ok(result.aria.length > 0);
        if (result.data !== null) {
          const html = renderToStaticMarkup(createElement(ViewFigure, { result }));
          assert.ok(html.includes(`aria-label="${escapeHtml(result.aria)}"`), `the figure carries the aria label: ${html.slice(0, 200)}`);
        }
      });
    }

    await check("an unknown view and an extra key are refused in words", () => {
      assert.throws(() => resolveView("nope", {}, ctx), /no picture called "nope"/);
      assert.throws(() => resolveView("forecast", { amountMinor: 100 }, ctx), /forecast does not take "amountMinor"/);
    });

    await check("a recipe with a view block parses, resolves and equals resolveView on the same context", async () => {
      const recipe: Recipe = { version: 1, title: "Month", blocks: [{ type: "view", view: "month_by_category", args: { by: "category" } }] };
      const context = await loadCanvasContext(db, hid, recipe);
      const [block] = resolveRecipe(recipe, context);
      assert.equal(block.type, "view");
      assert.deepEqual(block.type === "view" && block.data, resolveView("month_by_category", { by: "category" }, context));
    });
  } finally {
    await pg.close();
  }
  console.log(`\n${tally.passed} checks passed`);
}

export const done = main();
