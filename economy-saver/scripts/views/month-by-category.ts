// Where the month goes (D73, D74, D75): the month_by_category view on Ben's sample and the ranked-bars form.
import assert from "node:assert/strict";
import { unconfirmedNumbers } from "@/lib/ai/number-check";
import { fact } from "@/lib/money/facts";
import { TERMS } from "@/lib/money/terms";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MoneyState } from "@/lib/money/types";
import { benMoney } from "@/lib/sample/ben";
import { RankedBars } from "@/components/views/forms/RankedBars";
import { monthByCategoryView } from "@/lib/views/v/month-by-category";
import { ViewError, type ViewResult } from "@/lib/views/types";

let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`✓ ${name}`); }
const ctx = { state: benMoney, spending: benMoney };
const resolve = (args: Parameters<typeof monthByCategoryView>[0], c = ctx) => monthByCategoryView(args, c) as ViewResult<"ranked_bars">;
const category = resolve({});
const rows = category.data!.rows;

check("November total 152,230; Business 32,830 / Personal 119,400", () => {
  assert.equal(fact(category.facts, "month_total")!.value, 152_230);
  assert.equal(rows.reduce((sum, row) => sum + row.total, 0), 152_230);
  const business = resolve({ by: "business" });
  assert.equal(fact(business.facts, "business_share")!.value, 32_830);
  assert.equal(Number(fact(business.facts, "month_total")!.value) - Number(fact(business.facts, "business_share")!.value), 119_400);
  assert.deepEqual(business.strip, [{ label: "Business", value: "¥32,830" }, { label: "Personal", value: "¥119,400" }]);
  assert.equal(business.line, "Business ¥32,830 of ¥152,230 this month");
  assert.deepEqual(business.data!.segments.map(s => s.tone), ["main", "quiet"]);
  assert.ok(business.data!.rows.every(row => row.children === undefined && row.parts[0] + row.parts[1] === row.total));
  assert.deepEqual(business.table!.head, ["Category", "Business", "Personal", "Total"]);
});

check("Category: spent main and still to come soft, a last-month tick, own categories as children", () => {
  assert.deepEqual(category.data!.segments.map(s => s.tone), ["main", "soft"]);
  assert.deepEqual(category.data!.tick, { legend: "October" });
  const food = rows.find(row => row.key === "food")!, other = rows.find(row => row.key === "other")!;
  assert.equal(food.total, 10_700);
  assert.deepEqual(food.children!.map(c => [c.label, c.total]), [["Coffee", 1_880], ["Everything else in Food", 8_820]]);
  assert.equal(other.total, 48_900);
  assert.ok(other.children!.some(c => c.label === "Gear" && c.total === 24_600));
  for (const row of rows) assert.equal(row.parts[0] + row.parts[1], row.total);
  assert.ok(rows.every(row => row.tick !== null && row.tickLabel !== null));
});

check("The table has the old columns with children indented, and the line is the old sentence", () => {
  const table = category.table!;
  assert.deepEqual(table.head, ["Category", "Spent", "Still to come", "November", "October"]);
  assert.equal(table.rows.filter(row => row.child).length, rows.reduce((n, row) => n + (row.children?.length ?? 0), 0));
  assert.equal(table.caption, "Where November goes, by category");
  assert.match(category.line!, /^November so far ¥[\d,]+ spent, ¥[\d,]+ still to come: ¥152,230 for the month, against ¥[\d,]+ in October\.$/);
  assert.equal(category.title, "Where this month goes");
});

check("month 2026-10 total 132,060, nothing still to come, titled for the past", () => {
  const october = resolve({ month: "2026-10" });
  assert.equal(fact(october.facts, "month_total")!.value, 132_060);
  assert.equal(fact(october.facts, "month_still_to_come")!.value, 0);
  assert.equal(october.title, "Where October went");
  assert.match(october.line!, /^October: ¥132,060 spent, against /);
  assert.deepEqual(october.args, { month: "2026-10" });
});

check("open names the row opened first; an unknown or childless row opens nothing", () => {
  assert.equal(resolve({ open: "food" }).data!.open, "food");
  assert.equal(resolve({ open: "travel" }).data!.open, undefined);
  assert.equal(resolve({ by: "business", open: "food" }).data!.open, undefined);
  assert.equal(category.data!.open, undefined);
});

const two: MoneyState = {
  ...benMoney,
  split: { ...benMoney.split, members: [...benMoney.split.members, { id: "m-mio", name: "Mio", shareBp: 0 }] },
  cards: benMoney.cards.map(card => card.id === "card-b" ? { ...card, ownerId: "m-mio" } : card),
};

check("Person: a row per member then Shared with two people; a ViewError in words with one", () => {
  const person = resolve({ by: "person" }, { state: two, spending: two });
  assert.deepEqual(person.data!.rows.map(row => row.label), ["Ben", "Mio", "Shared"].filter(label => person.data!.rows.some(row => row.label === label)));
  assert.ok(person.data!.rows.some(row => row.label === "Mio"));
  assert.equal(person.data!.rows.reduce((sum, row) => sum + row.total, 0), fact(person.facts, "month_total")!.value);
  assert.equal(person.table!.head[0], "Person");
  assert.throws(() => resolve({ by: "person" }), error => error instanceof ViewError && /two or more people/.test(error.message));
});

check("A month outside the last twelve is a ViewError; nothing spent is an empty view that offers Add a bill", () => {
  assert.throws(() => resolve({ month: "2025-01" }), ViewError);
  assert.throws(() => resolve({ month: "2027-01" }), ViewError);
  const none = { ...benMoney, bills: [], charges: [] };
  const empty = resolve({}, { state: none, spending: none });
  assert.equal(empty.data, null);
  assert.deepEqual(empty.empty, { words: "Nothing spent in November yet. Add a bill or a card charge and it shows here.", add: "bill", addLabel: "Add a bill" });
  assert.equal(resolve({ month: "2026-10" }, { state: none, spending: none }).empty!.add, null);
});

check("Figures are integers and confirm every amount the line says; the card carries aria and the form draws it", () => {
  for (const by of ["category", "business"] as const) {
    const result = resolve({ by });
    for (const item of result.facts) if (item.unit === "money") assert.ok(Number.isInteger(item.value), item.name);
    assert.deepEqual(unconfirmedNumbers(result.line ?? "", result.facts, benMoney.today), []);
    assert.ok(result.aria.length > 0);
  }
  const html = renderToStaticMarkup(createElement(RankedBars, { result: resolve({ open: "food" }) }));
  assert.match(html, /aria-label="Where this month goes/);
  assert.match(html, /Spent so far/);
  assert.match(html, /Still to come \(bills and statements you know of\)/);
  assert.match(html, /<i class="rb-key-tick"><\/i>October/);
  assert.match(html, /aria-expanded="true"/); // Food opened
  assert.match(html, /Coffee/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(RankedBars, { result: category })), /Coffee/);
});

check("month_by_category: every fact is a term and the line has no number a fact does not confirm", () => {
  for (const r of [category, resolve({ month: "2026-10" }), resolve({ by: "business" })]) {
    assert.ok(r.facts && r.facts.length > 0);
    assert.ok(r.facts.every(f => TERMS.some(t => t.name === f.name)));
    assert.deepEqual(unconfirmedNumbers(r.line ?? "", r.facts as Parameters<typeof unconfirmedNumbers>[1], benMoney.today), []);
  }
});

check("month_by_category: the facts carry each category's change from last month, biggest first, and the total's change", () => {
  const changes = category.facts!.filter(f => f.name === "change_from_last_month" && f.about);
  assert.equal(changes.length, rows.length);
  for (const row of rows) assert.equal(changes.find(f => f.about!.id === row.key)!.value, row.total - row.tick!);
  const sizes = changes.map(f => Math.abs(f.value as number));
  assert.deepEqual(sizes, [...sizes].sort((a, b) => b - a));
  const whole = category.facts!.find(f => f.name === "change_from_last_month" && !f.about)!;
  assert.equal(whole.value, 152_230 - 132_060);
  assert.ok(category.facts!.some(f => f.name === "change_from_last_month_percent" && !f.about));
});

console.log(`month-by-category: ${passed} checks passed`);
