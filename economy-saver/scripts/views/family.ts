// Who owes whom, People and the family link (D45, D52, D77): the who_owes_whom view, and the family page drawn read-only through the views.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { unconfirmedAmounts } from "@/lib/ai/number-check";
import { splitBalance } from "@/lib/money/split";
import type { MoneyState } from "@/lib/money/types";
import { benMoney } from "@/lib/sample/ben";
import { FamilyView } from "@/components/family/FamilyView";
import { RankedBars } from "@/components/views/forms/RankedBars";
import { resolveView } from "@/lib/views/resolve";
import { whoOwesWhomView } from "@/lib/views/v/who-owes-whom";
import type { ViewResult } from "@/lib/views/types";

let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`✓ ${name}`); }
const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
const render = (element: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router as never }, element));

// Ben and his wife, 50% each; the split began Nov 1; Ben put a shared ¥8,400 charge on his card on Nov 5.
const two: MoneyState = {
  ...benMoney,
  split: {
    members: [{ id: "m-ben", name: "Ben", shareBp: 5_000 }, { id: "m-wife", name: "Wife", shareBp: 5_000 }], since: "2026-11-01", settledThrough: null, settledAt: null, bills: [],
    charges: [{ id: "c1", merchant: "Market", amountMinor: 8_400, date: "2026-11-05", paidBy: "m-ben", createdAt: "2026-11-05T09:00:00.000Z" }],
  },
};
const owes = whoOwesWhomView({}, { state: two }) as ViewResult<"ranked_bars">;

check("a shared ¥8,400 charge on Ben's card: Wife owes Ben ¥4,200, bars paid 8,400 against a share of 4,200", () => {
  assert.equal(owes.line, "Wife owes Ben ¥4,200.");
  const [ben, wife] = owes.data!.rows;
  assert.deepEqual([ben.label, ben.total, ben.parts, ben.tick, ben.sub], ["Ben", 8_400, [8_400], 4_200, "is owed ¥4,200"]);
  assert.deepEqual([wife.label, wife.total, wife.parts, wife.tick, wife.sub], ["Wife", 0, [0], 4_200, "owes ¥4,200"]);
  assert.deepEqual(owes.data!.segments, [{ key: "paid", legend: "Paid", tone: "main" }]);
  assert.equal(owes.data!.tick?.legend, "Fair share");
  assert.equal(owes.figures.owedMinor, 4_200);
  const balance = splitBalance(two.split, two.today);
  assert.deepEqual(balance.members.map(m => [m.paidMinor, m.shareMinor]), [[8_400, 4_200], [0, 4_200]]);
});

check("the line, the table twin and the figures agree; every Minor figure is an integer", () => {
  assert.deepEqual(owes.table!.head, ["Person", "Paid", "Fair share", "Balance"]);
  assert.deepEqual(owes.table!.rows.map(row => row.cells), [["Ben", "¥8,400", "¥4,200", "is owed ¥4,200"], ["Wife", "¥0", "¥4,200", "owes ¥4,200"]]);
  assert.deepEqual(owes.table!.foot, ["Together", "¥8,400", "¥8,400", ""]);
  assert.deepEqual(unconfirmedAmounts(owes.line ?? "", [JSON.stringify(owes.figures)]), []);
  for (const [key, value] of Object.entries(owes.figures)) if (key.endsWith("Minor")) assert.ok(Number.isInteger(value), key);
  const html = render(createElement(RankedBars, { result: owes }));
  assert.ok(html.includes("Fair share") && html.includes("is owed ¥4,200") && html.includes("owes ¥4,200"));
});

check("with one member it is empty and says to add a person; two members with nothing shared say so", () => {
  const one = whoOwesWhomView({}, { state: benMoney });
  assert.equal(one.data, null);
  assert.deepEqual(one.empty, { words: "Add a person in Household → People to split shared costs.", add: "person", addLabel: "Add a person" });
  const none = whoOwesWhomView({}, { state: { ...two, split: { ...two.split, charges: [] } } });
  assert.equal(none.data, null);
  assert.match(none.empty!.words, /Nothing has been shared/);
});

check("it takes no arguments and is live through resolveView", () => {
  assert.equal((resolveView("who_owes_whom", {}, { state: two }) as ViewResult).line, "Wife owes Ben ¥4,200.");
  assert.throws(() => resolveView("who_owes_whom", { month: "2026-11" }, { state: two }), /does not take/);
});

const family = (state: MoneyState) => render(createElement(FamilyView, { name: "Ben's household", context: { state, spending: state } }));
const html = family(two);

check("the family page draws the month by Category and Person, shared bills and who owes whom, read-only", () => {
  assert.ok(html.includes("Where this month goes"), "D74's heading");
  assert.ok(!/<h2>Where the month goes/.test(html), "the old heading");
  assert.ok(html.includes("Category") && html.includes("Person"));
  assert.ok(html.includes("Shared bills coming up"));
  assert.ok(html.includes("Who owes whom") && html.includes("Wife owes Ben ¥4,200."));
  assert.ok(html.includes("Display") && html.includes("Table"), "Chart · Table");
});

check("the family page markup has no Ask about this, Pin or File, no Add, no email and no PayPal details", () => {
  assert.ok(!/Ask about this|Pin to Home|Pin this|\bFile\b|Add a /.test(html), "no controls");
  assert.ok(!/<form|<button[^>]*type="submit"/.test(html));
  assert.ok(!html.includes("@"), "no email");
  assert.ok(!/paypal/i.test(html));
  assert.ok(!html.includes("href=\"/"), "no link into the signed-in app");
  const alone = family(benMoney);
  assert.ok(!/Ask about this|Pin|\bFile\b|Add a /.test(alone) && !alone.includes("Who owes whom"));
});

console.log(`family: ${passed} passed`);
