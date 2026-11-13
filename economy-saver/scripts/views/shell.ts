// The views shell: strict arguments, the stored block, the table, the card and the panel.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { VIEW_ARGS, viewBlockSchema } from "@/lib/views/args";
import { VIEW_META } from "@/lib/views/catalogue";
import type { TableTwin, ViewId, ViewResult } from "@/lib/views/types";
import { ViewCard } from "@/components/views/ViewCard";
import { ViewPanel } from "@/components/views/ViewPanel";
import { ViewTable } from "@/components/views/ViewTable";

let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`✓ ${name}`); }
const ids = Object.keys(VIEW_ARGS) as ViewId[];
const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
const render = (element: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router as never }, element));

const table: TableTwin = { caption: "Spending by group", head: ["Group", "Spent"], rows: [{ key: "a", cells: ["Food", "¥1,000"] }, { key: "b", cells: ["Eating out", "¥400"], child: true }], foot: ["Total", "¥1,000"] };
const base: ViewResult = { view: "month_by_category", args: {}, form: "ranked_bars", title: "Where the month goes", question: "Where does the month go?", hint: "hint", home: null, currency: "JPY", data: null, table, empty: null, line: "One sentence.", strip: null, aria: "", source: "", figures: {} };
const empty: ViewResult = { ...base, table: null, empty: { words: "Nothing spent yet.", add: "bill", addLabel: "Add a bill" } };

check("every view has arguments and metadata, strict and at most three keys", () => {
  assert.deepEqual(ids.sort(), Object.keys(VIEW_META).sort());
  assert.ok(!ids.includes("payoff_order" as ViewId));
  for (const id of ids) {
    assert.ok(Object.keys(VIEW_ARGS[id].shape).length <= 3, id);
    assert.equal(VIEW_ARGS[id].safeParse({ nonsense: 1 }).success, false, id);
  }
});

check("viewBlockSchema refuses an unknown view, an extra key and an amount on a view that tests none", () => {
  const schema = viewBlockSchema(["forecast", "card_cycle"]);
  assert.ok(schema.safeParse({ type: "view", view: "forecast", args: { days: 30 } }).success);
  assert.ok(schema.safeParse({ type: "view", view: "card_cycle", args: { cardId: "card-mio", amountMinor: 3000 } }).success);
  assert.equal(schema.safeParse({ type: "view", view: "position", args: {} }).success, false); // not live
  assert.equal(schema.safeParse({ type: "view", view: "nope", args: {} }).success, false);
  assert.equal(schema.safeParse({ type: "view", view: "forecast", args: {}, extra: 1 }).success, false);
  assert.equal(schema.safeParse({ type: "view", view: "forecast", args: { amountMinor: 100 } }).success, false);
  assert.equal(schema.safeParse({ type: "view", view: "card_cycle", args: { cardId: "card-mio", amountMinor: 12.5 } }).success, false);
});

check("ViewTable draws its caption, column scopes and indented child rows", () => {
  const html = render(createElement(ViewTable, { table }));
  assert.match(html, /<caption>Spending by group<\/caption>/);
  assert.match(html, /<th scope="col">Group<\/th>/);
  assert.match(html, /<th scope="row">Food<\/th>/);
  assert.match(html, /view-child/);
  assert.match(html, /<tfoot>/);
});

check("ViewCard draws the figure, the line and the empty state with its Add button", () => {
  const html = render(createElement(ViewCard, { result: base, figure: createElement("svg", { id: "fig" }) }));
  assert.match(html, /id="fig"/);
  assert.match(html, /One sentence\./);
  const blank = render(createElement(ViewCard, { result: empty, figure: createElement("svg", { id: "fig" }) }));
  assert.match(blank, /Nothing spent yet\./);
  assert.match(blank, /Add a bill/);
  assert.doesNotMatch(blank, /id="fig"/);
});

check("ViewPanel has Ask about this and Pin to Home, and neither when read only", () => {
  const questions = [{ key: "q", label: "Q", result: base, figure: createElement("svg") }];
  const open = render(createElement(ViewPanel, { id: "spending-month", questions }));
  assert.match(open, /Ask about this/);
  assert.match(open, /Pin to Home/);
  const closed = render(createElement(ViewPanel, { id: "spending-month", questions, readOnly: true }));
  assert.doesNotMatch(closed, /Ask about this/);
  assert.doesNotMatch(closed, /Pin to Home/);
});

console.log(`\n${passed} checks passed`);
