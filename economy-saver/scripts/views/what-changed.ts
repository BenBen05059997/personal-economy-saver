// What did this change (D77), on Ben's sample: a pending bill, a pending card charge, a shared charge between two people, a confirmed item, and an item of another household.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { seedBen } from "@/db/seed";
import { unconfirmedNumbers } from "@/lib/ai/number-check";
import { termOf } from "@/lib/money/terms";
import { ViewFigure } from "@/components/views/ViewFigure";
import { loadViewContext } from "@/lib/views/load";
import { resolveView } from "@/lib/views/resolve";
import type { FormData, ViewContext, ViewResult } from "@/lib/views/types";
import type { Charge } from "@/lib/money/types";

let passed = 0;
const reads = (view: ViewResult, today: string) => {
  assert.ok(view.facts && view.facts.length > 0, `${view.view} carries facts`);
  assert.deepEqual(unconfirmedNumbers(view.line ?? "", view.facts, { today: today }), [], `${view.view}: every number in the line is one of its facts`);
  for (const item of view.facts) assert.doesNotThrow(() => termOf(item.name), `${item.name} is a term`);
};
async function check(name: string, run: () => void | Promise<void>) { await run(); passed++; console.log(`✓ ${name}`); }
type Rows = FormData["before_after"]["rows"];
const row = (rows: Rows, key: string) => rows.find(r => r.key === key);

async function main() {
  const pg = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(pg, { schema });
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    const hid = await seedBen(db, { isDemo: true });
    const other = await seedBen(db, { isDemo: true });
    const ctx = await loadViewContext(db, hid, ["spending"]), otherCtx = await loadViewContext(db, other, ["spending"]);
    const { state } = ctx;
    const hikari = state.bills.find(bill => bill.status === "pending")!;
    const cardB = state.cards.find(card => card.label === "Card B")!, cardA = state.cards.find(card => card.label === "Card A")!;
    const chargeOf = (amount: number) => state.charges.find(charge => charge.amount === amount)!.id;

    await check("the pending Hikari Denki: Utilities ¥0 → ¥11,220, lowest −¥18,780 → −¥30,000, the sentence becomes ¥30,000 short on the 27th", () => {
      const result = resolveView("what_changed", { itemId: hikari.id }, ctx) as ViewResult<"before_after">;
      const rows = result.data!.rows;
      assert.deepEqual([row(rows, "category")!.label, row(rows, "category")!.before, row(rows, "category")!.after], ["Utilities this month", "¥0", "¥11,220"]);
      assert.deepEqual([row(rows, "low")!.before, row(rows, "low")!.after, row(rows, "low")!.change], ["−¥18,780", "−¥30,000", "−¥11,220"]);
      assert.match(row(rows, "sentence")!.before, /¥18,780 short on the 27th\.$/);
      assert.match(row(rows, "sentence")!.after, /¥30,000 short on the 27th\.$/);
      assert.deepEqual(rows.map(r => r.key), ["category", "low", "sentence"], "only what moves, in the fixed order, the lowest day and the sentence last");
      assert.equal(result.data!.pending, true);
      assert.equal(result.title, "If you confirm Hikari Denki");
      assert.deepEqual(result.table!.head, ["", "Now", "If you confirm", "Change"]);
      assert.deepEqual(unconfirmedNumbers(result.line ?? "", result.facts, { today: state.today }), []);
      assert.match(result.line!, /^Now: .*¥18,780 short on the 27th\. If you confirm it, your sentence becomes: .*¥30,000 short on the 27th\.$/);
    });

    await check("the pending Hikari Denki and an unchanged item read clean; the before and after sides carry both cases and the sentence's day", () => {
      const result = resolveView("what_changed", { itemId: hikari.id }, ctx) as ViewResult;
      reads(result, state.today);
      const pick = (name: string, kase?: string) => result.facts!.find(f => f.name === name && (kase === undefined || f.case === kase))!.value;
      assert.deepEqual([pick("low_point_before_change", "late"), pick("low_point_after_change", "late")], [-18_780, -30_000]);
      assert.equal(pick("safe_to_spend_after_change"), 0);
      assert.match(String(pick("sentence_day")), /^\d{4}-\d{2}-27$/);
      const pot = state.pots[0];
      if (pot) reads(resolveView("what_changed", { itemId: pot.id }, ctx) as ViewResult, state.today);
    });

    await check("a pending ¥8,400 Card B charge: owed ¥61,000 → ¥69,400, the Dec 10 statement ¥61,000 → ¥69,400, Food ¥10,700 → ¥19,100", () => {
      const charge: Charge = { id: "ch-pending", cardId: cardB.id, merchant: "Minato Fresh Market", amount: 8_400, date: "2026-11-14", category: "food", businessBp: 0, source: "card_email", status: "pending" };
      const withPending: ViewContext = { ...ctx, state: { ...state, charges: [...state.charges, charge] } };
      const rows = (resolveView("what_changed", { itemId: "ch-pending" }, withPending) as ViewResult<"before_after">).data!.rows;
      assert.deepEqual([row(rows, `owed-${cardB.id}`)!.before, row(rows, `owed-${cardB.id}`)!.after], ["¥61,000", "¥69,400"]);
      const statement = row(rows, `statement-${cardB.id}`)!;
      assert.deepEqual([statement.label, statement.before, statement.after], ["Card B next statement (due Dec 10)", "¥61,000", "¥69,400"]);
      assert.deepEqual([row(rows, "category")!.label, row(rows, "category")!.before, row(rows, "category")!.after], ["Food this month", "¥10,700", "¥19,100"]);
      assert.equal(rows.some(r => r.key.includes(state.cards.find(c => c.label === "Card A")!.id)), false, "Card A does not move");
      assert.deepEqual(rows.slice(0, 3).map(r => r.key), [`owed-${cardB.id}`, `statement-${cardB.id}`, "category"], "the fixed order");
    });

    await check("two members and the charge shared: Wife owes Ben ¥0 → ¥4,200", () => {
      const charge: Charge = { id: "ch-shared", cardId: cardB.id, merchant: "Minato Fresh Market", amount: 8_400, date: "2026-11-14", category: "food", businessBp: 0, source: "card_email", status: "pending", shared: true };
      const members = [{ id: "m-ben", name: "Ben", shareBp: 5_000 }, { id: "m-wife", name: "Wife", shareBp: 5_000 }];
      const two: ViewContext = { ...ctx, state: { ...state, cards: state.cards.map(card => card.id === cardB.id ? { ...card, ownerId: "m-ben" } : card), charges: [...state.charges, charge], split: { ...state.split, members, since: "2026-11-01" } } };
      const rows = (resolveView("what_changed", { itemId: "ch-shared" }, two) as ViewResult<"before_after">).data!.rows;
      const owes = rows.find(r => r.label === "Wife owes Ben")!;
      assert.deepEqual([owes.before, owes.after, owes.change], ["¥0", "¥4,200", "+¥4,200"]);
      const alone = (resolveView("what_changed", { itemId: "ch-pending" }, { ...two, state: { ...two.state, charges: [...two.state.charges, { ...charge, id: "ch-pending", shared: undefined }] } }) as ViewResult<"before_after">).data!.rows;
      assert.equal(alone.some(r => r.label === "Wife owes Ben"), false, "a charge not shared moves nobody's balance");
    });

    await check("a confirmed bill and a confirmed charge: before is the state without it", () => {
      const confirmed: ViewContext = { state: { ...state, bills: state.bills.map(bill => bill.id === hikari.id ? { ...bill, status: "confirmed" as const } : bill) }, spending: { ...ctx.spending!, bills: [...ctx.spending!.bills, { ...hikari, status: "confirmed" as const }] } };
      const result = resolveView("what_changed", { itemId: hikari.id }, confirmed) as ViewResult<"before_after">;
      assert.equal(result.data!.pending, false);
      assert.equal(result.title, "What Hikari Denki changed");
      assert.deepEqual(result.table!.head, ["", "Without it", "With it", "Change"]);
      const rows = result.data!.rows;
      assert.deepEqual([row(rows, "category")!.before, row(rows, "category")!.after], ["¥0", "¥11,220"]);
      assert.deepEqual([row(rows, "low")!.before, row(rows, "low")!.after], ["−¥18,780", "−¥30,000"]);
      assert.match(result.line!, /^Without it: .* Because of it, your sentence reads: /);
      const b8 = resolveView("what_changed", { itemId: chargeOf(1_400) }, ctx) as ViewResult<"before_after">;
      assert.equal(b8.data!.pending, false, "a confirmed charge");
      assert.deepEqual([row(b8.data!.rows, `owed-${cardB.id}`)!.before, row(b8.data!.rows, `owed-${cardB.id}`)!.after], ["¥59,600", "¥61,000"]);
      assert.deepEqual([row(b8.data!.rows, "category")!.before, row(b8.data!.rows, "category")!.after], ["¥9,300", "¥10,700"]);
    });

    await check("an item that changes nothing says the sentence is unchanged", () => {
      const result = resolveView("what_changed", { itemId: chargeOf(3_850) }, ctx) as ViewResult<"before_after">; // Card A's open cycle is paid on Dec 26, past the 30 days
      const sentence = row(result.data!.rows, "sentence")!;
      assert.equal(sentence.before, sentence.after);
      assert.match(result.line!, /^Your sentence is unchanged: .*¥18,780 short on the 27th\.$/);
      assert.deepEqual([row(result.data!.rows, "low")!.change], [null]);
      assert.equal(row(result.data!.rows, `owed-${cardA.id}`)!.after, "¥86,450");
    });

    await check("a pending pot and a bank balance update: cash and the lowest day move", () => {
      const pot = { id: "pot-new", name: "Tax", saved: 20_000 };
      const withPot = resolveView("what_changed", { itemId: "pot-new" }, { ...ctx, state: { ...state, pendingPots: [pot] } }) as ViewResult<"before_after">;
      assert.deepEqual([row(withPot.data!.rows, "cash")!.before, row(withPot.data!.rows, "cash")!.after], ["¥128,000", "¥108,000"]);
      const update = resolveView("what_changed", { itemId: "bal-1" }, { ...ctx, state: { ...state, balanceUpdates: [{ id: "bal-1", amount: 80_000 }] } }) as ViewResult<"before_after">;
      assert.deepEqual([row(update.data!.rows, "bank")!.before, row(update.data!.rows, "bank")!.after, row(update.data!.rows, "bank")!.change], ["¥67,000", "¥80,000", "+¥13,000"]);
      assert.deepEqual(row(withPot.data!.rows, "pots"), { key: "pots", label: "Saving pots", before: "0", after: "1", change: "+1" });
      // Confirmed, the same rule as a bill or a charge: before is the state without it, after is now.
      const saved = resolveView("what_changed", { itemId: "pot-new" }, { ...ctx, state: { ...state, pots: [pot] } }) as ViewResult<"before_after">;
      assert.equal(saved.data!.pending, false);
      assert.deepEqual(saved.table!.head, ["", "Without it", "With it", "Change"]);
      assert.deepEqual([row(saved.data!.rows, "cash")!.before, row(saved.data!.rows, "cash")!.after], ["¥128,000", "¥108,000"]);
      assert.deepEqual(row(saved.data!.rows, "pots"), { key: "pots", label: "Saving pots", before: "0", after: "1", change: "+1" });
    });

    await check("an item of another household is refused in words", () => {
      const theirs = otherCtx.state.bills.find(bill => bill.status === "pending")!.id;
      assert.notEqual(theirs, hikari.id);
      assert.throws(() => resolveView("what_changed", { itemId: theirs }, ctx), /not in your records/);
      assert.throws(() => resolveView("what_changed", { itemId: "nothing" }, ctx), /not in your records/);
    });

    await check("the before-and-after form draws its rows, the headings and the sentence", () => {
      const html = renderToStaticMarkup(createElement(ViewFigure, { result: resolveView("what_changed", { itemId: hikari.id }, ctx) }));
      assert.match(html, /If you confirm/);
      assert.match(html, /Utilities this month/);
      assert.match(html, /−¥30,000/);
      assert.match(html, /your sentence becomes/, "the sentence is in the figure's label");
      assert.doesNotMatch(html, /ba-sentence/);
    });
  } finally {
    await pg.close();
  }
  console.log(`what-changed: ${passed} checks passed`);
}

export const done = main();
