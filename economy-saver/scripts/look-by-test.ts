// Home's Categories view looked at three ways (D74): the category, business and person rows, the remembered choice.
// Pure, no database. Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/look-by-test.ts
import assert from "node:assert/strict";
import { formatHomeView, lookBy, parseHomeView } from "@/lib/money/look-by";
import { monthByCategory } from "@/lib/money/month";
import { monthBounds, monthsBack, spendingItems } from "@/lib/money/spending";
import type { MoneyState } from "@/lib/money/types";
import { benMoney } from "@/lib/sample/ben";

let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`✓ ${name}`); }

const ben = benMoney;
const today = ben.today;
const members = ben.split.members.map(m => ({ id: m.id, name: m.name }));

// What Home's spendingRows gave before D74, kept here as the reference the Category rows must equal.
function oldRows(input: MoneyState) {
  const month = today.slice(0, 7), previous = monthsBack(month, 2);
  const current = monthByCategory(input, today, month), last = monthByCategory(input, today, previous);
  const { first, last: end } = monthBounds(month);
  const items = spendingItems(input, first, end);
  return current.categories.map(category => {
    const matches = items.filter(item => item.category === category.category);
    const spent = matches.filter(item => item.date <= today).reduce((sum, item) => sum + item.amountMinor, 0);
    const coming = matches.filter(item => item.date > today && item.kind === "bill").reduce((sum, item) => sum + item.amountMinor, 0);
    const previousAmount = last.categories.find(item => item.category === category.category)?.totalMinor ?? 0;
    const unknown = matches.some(item => item.uncounted);
    return { key: category.category, label: category.label, note: unknown ? "an amount is not known" : `${matches.length} ${matches.length === 1 ? "item" : "items"}`, spent, coming, total: spent + coming, previous: previousAmount, unknown };
  }).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

// A second member: card B and every bill with no owner stay as they are; card B's owner becomes m-mio, one bill gets her id.
const two: MoneyState = {
  ...ben,
  split: { ...ben.split, members: [...ben.split.members, { id: "m-mio", name: "Mio", shareBp: 0 }] },
  cards: ben.cards.map(card => card.id === "card-b" ? { ...card, ownerId: "m-mio" } : card),
  charges: ben.charges.map(charge => charge.id === "ch-a3" ? { ...charge, shared: true as const } : charge),
};
const twoMembers = two.split.members.map(m => ({ id: m.id, name: m.name }));

check("Category rows equal what Home's spendingRows gave: same categories, order, amounts and notes", () => {
  const view = lookBy(ben, today, "category", members);
  assert.equal(view.by, "category");
  const old = oldRows(ben);
  assert.deepEqual(view.rows.map(({ business, personal, children, ...row }) => { void business; void personal; void children; return row; }), old);
  assert.equal(view.spent, old.reduce((s, r) => s + r.spent, 0));
  assert.equal(view.coming, old.reduce((s, r) => s + r.coming, 0));
  assert.equal(view.total, view.spent + view.coming);
  assert.equal(view.name, "November");
  assert.equal(view.lastName, "October");
});

check("Own categories (D75): Food and Other open into children that add up to the parent in both months", () => {
  const view = lookBy(ben, today, "category", members);
  const food = view.rows.find(r => r.key === "food")!, other = view.rows.find(r => r.key === "other")!;
  assert.equal(food.total, 10_700);
  assert.deepEqual(food.children!.map(c => [c.label, c.total]), [["Coffee", 1_880], ["Everything else in Food", 8_820]]);
  assert.equal(other.total, 48_900);
  assert.deepEqual(other.children!.map(c => [c.label, c.total, c.previous]), [["Gear", 24_600, 0], ["Books & films", 0, 7_480], ["Everything else in Other", 24_300, other.previous - 7_480]]);
  for (const parent of [food, other]) for (const field of ["spent", "coming", "total", "previous", "business", "personal"] as const)
    assert.equal(parent.children!.reduce((s, c) => s + c[field], 0), parent[field], `${parent.key} ${field}`);
  assert.equal(other.children!.find(c => c.label === "Books & films")!.spent, 0);
  for (const row of view.rows.filter(r => r.key !== "food" && r.key !== "other")) assert.equal(row.children, undefined, row.key);
  assert.equal(other.children![other.children!.length - 1].label, "Everything else in Other");
});

check("Own categories: the Business and Person rows have no children", () => {
  assert.ok(lookBy(ben, today, "business", members).rows.every(r => r.children === undefined));
  assert.ok(lookBy(two, today, "person", twoMembers).rows.every(r => r.children === undefined));
});

check("Business: ¥32,830 business, ¥119,400 personal, ¥152,230 total, and the sentence", () => {
  const view = lookBy(ben, today, "business", members);
  assert.equal(view.by, "business");
  assert.equal(view.businessMinor, 32_830);
  assert.equal(view.personalMinor, 119_400);
  assert.equal(view.total, 152_230);
  assert.equal(view.businessLine, "Business ¥32,830 of ¥152,230 this month");
  assert.deepEqual(view.rows.map(r => r.key), oldRows(ben).map(r => r.key));
  for (const row of view.rows) assert.equal(row.business + row.personal, row.total, row.key);
  assert.equal(view.rows.reduce((s, r) => s + r.business, 0), 32_830);
  assert.equal(view.rows.reduce((s, r) => s + r.personal, 0), 119_400);
});

check("Person: rows follow member order, then Shared, and add up to the month", () => {
  const view = lookBy(two, today, "person", twoMembers);
  assert.equal(view.by, "person");
  assert.deepEqual(view.rows.map(r => r.label), ["Ben", "Mio", "Shared"]);
  assert.equal(view.rows.reduce((s, r) => s + r.total, 0), 152_230);
  assert.equal(view.total, 152_230);
  assert.ok(view.rows.every(r => r.total > 0));
  assert.equal(view.rows.find(r => r.key === "m-mio")!.total, 24_300 + 7_420 + 1_400 + 1_880);
  assert.equal(view.rows.reduce((s, r) => s + r.previous, 0), view.lastTotal);
  for (const row of view.rows) assert.equal(row.business + row.personal, row.total, row.key);
});

check("Person: a row with nothing in both months is left out", () => {
  const view = lookBy({ ...two, charges: two.charges.filter(c => c.id !== "ch-a3") }, today, "person", twoMembers);
  assert.ok(!view.rows.some(r => r.key === "shared" && r.total === 0 && r.previous === 0));
  const alone = lookBy({ ...two, cards: two.cards.map(c => ({ ...c, ownerId: "m-ben" })) }, today, "person", twoMembers);
  assert.ok(!alone.rows.some(r => r.key === "m-mio"), "Mio has nothing in either month");
});

check("Person with one member gives the category rows", () => {
  const view = lookBy(ben, today, "person", members);
  assert.equal(view.by, "category");
  assert.deepEqual(view.rows, lookBy(ben, today, "category", members).rows);
});

check("The three choices have the same month total", () => {
  const totals = (["category", "business", "person"] as const).map(by => lookBy(two, today, by, twoMembers).total);
  assert.deepEqual(totals, [152_230, 152_230, 152_230]);
  assert.equal(lookBy(ben, today, "business", members).businessMinor + lookBy(ben, today, "business", members).personalMinor, 152_230);
});

check("Every amount is an integer", () => {
  for (const by of ["category", "business", "person"] as const) for (const r of lookBy(two, today, by, twoMembers).rows)
    for (const v of [r.spent, r.coming, r.total, r.previous, r.business, r.personal]) assert.ok(Number.isInteger(v));
});

check("The remembered choice: two parts read as Category; three parts round-trip; Person needs two people", () => {
  assert.deepEqual(parseHomeView("categories|chart", 1), { view: "categories", mode: "chart", by: "category" });
  assert.deepEqual(parseHomeView("categories|table|business", 1), { view: "categories", mode: "table", by: "business" });
  assert.equal(formatHomeView("categories", "table", "business"), "categories|table|business");
  assert.deepEqual(parseHomeView("categories|chart|person", 1), { view: "categories", mode: "chart", by: "category" });
  assert.deepEqual(parseHomeView("categories|chart|person", 2), { view: "categories", mode: "chart", by: "person" });
  assert.deepEqual(parseHomeView("forecast|chart", 1), { view: "forecast", mode: "chart", by: "category" });
  assert.deepEqual(parseHomeView("junk", 1), { view: "forecast", mode: "chart", by: "category" });
  const { view, mode, by } = parseHomeView("trend|table|person", 3);
  assert.equal(parseHomeView(formatHomeView(view, mode, by), 3).by, "person");
});

console.log(`\n${passed} checks passed`);
