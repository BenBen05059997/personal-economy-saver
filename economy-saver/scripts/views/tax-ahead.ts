// The tax ahead (D77): a pot at 20% holding ¥10,000, Ben's open Acme $1,200 (Nov 22) and Northwind $800 (Nov 25), and Government & tax bills. Fictional data only; PGlite, no credentials.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadMoneyState } from "@/db/household";
import { seedBen } from "@/db/seed";
import { fact } from "@/lib/money/facts";
import { fillShare } from "@/lib/money/pots";
import { TAX_AHEAD_DAYS, taxAhead } from "@/lib/money/tax-ahead";
import type { Bill, MoneyState, Pot } from "@/lib/money/types";
import { resolveView } from "@/lib/views/resolve";
import { ViewError, type ViewResult } from "@/lib/views/types";
import { StepLine } from "@/components/views/forms/StepLine";
import { reads } from "../fixtures/view-reads";
import { createChecks, openDb } from "../fixtures/harness";
import { DEMO_DATE } from "@/db/clock";

const { check, tally } = createChecks();

async function main() {
  const { pg, db } = await openDb();
  try {
    const ben = await seedBen(db, { isDemo: true });
    const base = await loadMoneyState(db, ben, DEMO_DATE);
    const tax: Pot = { id: "pot-tax", name: "Tax", saved: 10_000, fillPct: 20 };
    const bill = (over: Partial<Bill> = {}): Bill => ({ id: "tax-1", biller: "Resident tax", amount: 40_000, due: "2026-12-20", category: "government_tax", businessBp: 0, status: "confirmed", ...over });
    const world = (bills: Bill[], pots: Pot[] = [tax]): MoneyState => ({ ...base, pots, bills: [...base.bills, ...bills] });
    const ctxOf = (s: MoneyState) => ({ state: s });
    const first = fillShare(180_000, 2000), second = fillShare(120_000, 2000), at = (iso: string) => Math.round((Date.parse(iso) - Date.parse(DEMO_DATE)) / 86_400_000);

    await check("the pot steps by fillShare on Nov 22 and Nov 25; the bills line steps to ¥40,000 on Dec 20; it is covered", () => {
      assert.deepEqual([first, second], [36_000, 24_000]);
      const ahead = taxAhead(world([bill()]), "pot-tax", 90)!;
      assert.equal(ahead.pot[0], 10_000);
      assert.equal(ahead.pot[at("2026-11-21")], 10_000);
      assert.equal(ahead.pot[at("2026-11-22")], 10_000 + first);
      assert.equal(ahead.pot[at("2026-11-25")], 10_000 + first + second);
      assert.equal(ahead.bills[at("2026-12-19")], 0);
      assert.equal(ahead.bills[at("2026-12-20")], 40_000);
      assert.deepEqual(ahead.steps.map(s => [s.date, s.addMinor]), [["2026-11-22", first], ["2026-11-25", second]]);
      assert.equal(ahead.low.short, false);
      assert.equal(ahead.low.marginMinor, 70_000 - 40_000);
      const result = resolveView("tax_ahead", { potId: "pot-tax" }, ctxOf(world([bill()]))) as ViewResult<"step_line">;
      assert.equal(result.line, "The pot covers the tax bills through Dec 20.");
      assert.deepEqual(result.data!.lines.map(l => [l.key, l.tone, l.label]), [["main", "main", "In the pot"], ["quiet", "quiet", "Tax bills due so far"]]);
      assert.equal(result.data!.marks.length, 1);
      assert.equal(result.data!.marks[0].index, at("2026-12-20"));
      assert.equal(fact(result.facts, "tax_covered_through")!.value, "2026-12-20", "the pot covers the one tax bill, due that day");
      assert.equal(fact(result.facts, "tax_ahead"), null, "nothing short");
      assert.ok(renderToStaticMarkup(createElement(StepLine, { result })).includes("In the pot"));
    });

    await check("short: a ¥100,000 bill leaves the pot ¥30,000 short on Dec 20; a bill before the invoices land is short on its own day", () => {
      const result = resolveView("tax_ahead", { potId: "pot-tax" }, ctxOf(world([bill({ amount: 100_000 })]))) as ViewResult<"step_line">;
      assert.equal(result.line, "The pot is ¥30,000 short of the tax bills on Dec 20.");
      assert.equal(result.data!.low.short, true);
      assert.equal(result.data!.low.index, at("2026-12-20"));
      assert.equal(fact(result.facts, "tax_ahead")!.value, 30_000);
      const early = taxAhead(world([bill({ due: "2026-11-20" })]), "pot-tax", 90)!;
      assert.deepEqual([early.low.short, early.low.shortMinor, early.low.index], [true, 30_000, at("2026-11-20")]);
    });

    await check("tax_ahead reads clean short and pending; short carries the short amount, the day and the bill due that day", () => {
      const short = resolveView("tax_ahead", { potId: "pot-tax" }, ctxOf(world([bill({ amount: 100_000 })]))) as ViewResult;
      reads(short, DEMO_DATE);
      const facts = short.facts!, due = facts.find(f => f.name === "bill_amount")!;
      assert.equal(facts.find(f => f.name === "tax_ahead")!.value, 30_000);
      assert.equal(facts.find(f => f.name === "tax_short_on")!.value, "2026-12-20");
      assert.deepEqual([due.value, due.about, due.period], [100_000, { type: "bill", id: "tax-1", name: "Resident tax" }, { on: "2026-12-20" }]);
      reads(resolveView("tax_ahead", { potId: "pot-tax" }, ctxOf(world([bill({ status: "pending", amount: 500_000 })]))) as ViewResult, DEMO_DATE);
    });

    await check("a pending tax bill is named and not counted", () => {
      const pending = world([bill({ status: "pending", amount: 500_000 })]);
      const ahead = taxAhead(pending, "pot-tax", 90)!;
      assert.equal(ahead.bills[89], 0);
      assert.deepEqual(ahead.taxBills.map(b => [b.pending, b.counted]), [[true, false]]);
      const result = resolveView("tax_ahead", { potId: "pot-tax" }, ctxOf(pending));
      assert.match(result.line!, /Resident tax waits in To check and is not counted yet\./);
      assert.equal(fact(result.facts, "not_counted")!.about!.name, "Resident tax", "a bill that waits in To check is named, not counted");
      assert.notEqual(result.data, null);
    });

    await check("a bill outside the window and a bill of another kind are not counted", () => {
      assert.equal(taxAhead(world([bill({ due: "2027-03-01" }), bill({ id: "rent", category: "housing", biller: "Rent" })]), "pot-tax", 90)!.taxBills.length, 0);
      assert.equal(taxAhead(world([bill({ due: "2027-03-01" })]), "pot-tax", 180)!.taxBills.length, 1);
    });

    await check("empty: a pot with no fill rule asks for one; no tax bill in the window asks for one", () => {
      const noRule = resolveView("tax_ahead", { potId: "pot-tax" }, ctxOf(world([bill()], [{ ...tax, fillPct: undefined }])));
      assert.equal(noRule.data, null);
      assert.equal(noRule.empty!.words, "Set a fill rule on this pot to see the tax ahead.");
      const noBill = resolveView("tax_ahead", { potId: "pot-tax" }, ctxOf(world([])));
      assert.equal(noBill.empty!.words, "Add your tax bills (Government & tax) to see whether this pot covers them.");
      assert.equal(noBill.empty!.add, "bill");
      assert.throws(() => resolveView("tax_ahead", { potId: "nope" }, ctxOf(world([bill()]))), (e: unknown) => e instanceof ViewError && /couldn't find that pot/.test(e.message));
      assert.equal((resolveView("tax_ahead", { potId: "pot-tax" }, ctxOf(world([bill()]))) as ViewResult<"step_line">).data!.days, TAX_AHEAD_DAYS, "the default window is the engine's");
      assert.throws(() => resolveView("tax_ahead", { potId: "pot-tax", days: 10 }, ctxOf(world([bill()]))), ViewError);
    });
  } finally {
    await pg.close();
  }
  console.log(`\n${tally.passed} checks passed`);
}

export const done = main();
