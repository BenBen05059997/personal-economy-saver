// The views shell: strict arguments, the stored block, the table, the card and the panel.
import assert from "node:assert/strict";
import { createElement } from "react";
import { VIEW_ARGS, viewBlockSchema } from "@/lib/views/args";
import { VIEW_META } from "@/lib/views/catalogue";
import type { TableTwin, ViewId, ViewResult } from "@/lib/views/types";
import { ViewCard } from "@/components/views/ViewCard";
import { ViewPanel } from "@/components/views/ViewPanel";
import { ViewTable } from "@/components/views/ViewTable";
import { renderWithRouter } from "../fixtures/harness";
import { createSyncChecks } from "../fixtures/harness";

const { check, tally } = createSyncChecks();
const ids = Object.keys(VIEW_ARGS) as ViewId[];

const table: TableTwin = { caption: "Spending by group", head: ["Group", "Spent"], rows: [{ key: "a", cells: ["Food", "¥1,000"] }, { key: "b", cells: ["Eating out", "¥400"], child: true }], foot: ["Total", "¥1,000"] };
const base: ViewResult = { view: "month_by_category", args: {}, form: "ranked_bars", title: "Where the month goes", question: "Where does the month go?", hint: "hint", currency: "JPY", data: null, table, empty: null, line: "One sentence.", strip: null, aria: "", source: "", facts: [] };
const empty: ViewResult = { ...base, table: null, empty: { words: "Nothing spent yet.", add: "bill", addLabel: "Add a bill" } };

check("every view has arguments and metadata, strict and at most three keys", () => {
  assert.deepEqual(ids.sort(), Object.keys(VIEW_META).sort());
  for (const id of ids) {
    assert.ok(Object.keys(VIEW_ARGS[id].shape).length <= 3, id);
    assert.equal(VIEW_ARGS[id].safeParse({ nonsense: 1 }).success, false, id);
  }
});

check("viewBlockSchema refuses an unknown view, an extra key and an amount on a view that tests none", () => {
  const schema = viewBlockSchema();
  assert.ok(schema.safeParse({ type: "view", view: "forecast", args: { days: 30 } }).success);
  assert.ok(schema.safeParse({ type: "view", view: "card_cycle", args: { cardId: "card-mio", amountMinor: 3000 } }).success);
  assert.ok(schema.safeParse({ type: "view", view: "position", args: {} }).success);
  assert.equal(schema.safeParse({ type: "view", view: "nope", args: {} }).success, false);
  assert.equal(schema.safeParse({ type: "view", view: "forecast", args: {}, extra: 1 }).success, false);
  assert.equal(schema.safeParse({ type: "view", view: "forecast", args: { amountMinor: 100 } }).success, false);
  assert.equal(schema.safeParse({ type: "view", view: "card_cycle", args: { cardId: "card-mio", amountMinor: 12.5 } }).success, false);
});

check("ViewTable draws its caption, column scopes and indented child rows", () => {
  const html = renderWithRouter(createElement(ViewTable, { table }));
  assert.match(html, /<caption>Spending by group<\/caption>/);
  assert.match(html, /<th scope="col">Group<\/th>/);
  assert.match(html, /<th scope="row">Food<\/th>/);
  assert.match(html, /view-child/);
  assert.match(html, /<tfoot>/);
});

check("ViewCard draws the figure, the line and the empty state with its Add button", () => {
  const html = renderWithRouter(createElement(ViewCard, { result: base, figure: createElement("svg", { id: "fig" }) }));
  assert.match(html, /id="fig"/);
  assert.match(html, /One sentence\./);
  const blank = renderWithRouter(createElement(ViewCard, { result: empty, figure: createElement("svg", { id: "fig" }) }));
  assert.match(blank, /Nothing spent yet\./);
  assert.match(blank, /Add a bill/);
  assert.doesNotMatch(blank, /id="fig"/);
});

check("ViewPanel has Ask about this and Pin to Home, and neither when read only", () => {
  const questions = [{ key: "q", label: "Q", result: base, figure: createElement("svg") }];
  const open = renderWithRouter(createElement(ViewPanel, { id: "spending-month", questions }));
  assert.match(open, /Ask about this/);
  assert.match(open, /Pin to Home/);
  const closed = renderWithRouter(createElement(ViewPanel, { id: "spending-month", questions, readOnly: true }));
  assert.doesNotMatch(closed, /Ask about this/);
  assert.doesNotMatch(closed, /Pin to Home/);
});

console.log(`\n${tally.passed} checks passed`);
