// The bills calendar (D77): calendarDays on Ben's sample, the bills_calendar view and the calendar form.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { unconfirmedNumbers } from "@/lib/ai/number-check";
import { fact, type Fact } from "@/lib/money/facts";
import { TERMS } from "@/lib/money/terms";
import { calendarDays } from "@/lib/money/calendar";
import { sharedBillsComing } from "@/lib/money/family";
import { series } from "@/lib/money/runway";
import { benMoney } from "@/lib/sample/ben";
import { Calendar } from "@/components/views/forms/Calendar";
import { calendarView } from "@/lib/views/v/calendar";
import type { ViewResult } from "@/lib/views/types";

let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`✓ ${name}`); }
const ctx = { state: benMoney };
/** The facts as the number check reads them: a one-day period becomes its date. */
const checkable = (facts: readonly Fact[]) => facts.map(item => ({ ...item, period: item.period && "on" in item.period ? item.period.on : item.period }));
const rows = calendarDays(benMoney);
const day = (date: string) => rows.find(row => row.date === date)!;
const result = calendarView({}, ctx) as ViewResult<"calendar">;
const data = result.data!;

check("Ben's calendar: Nov 18 ¥1,980, Nov 20 ¥4,800, Nov 26 ¥58,000, Nov 27 ¥82,000, Dec 10 ¥61,000 go out", () => {
  assert.equal(rows.length, 30);
  assert.equal(rows[0].date, "2026-11-14");
  assert.equal(day("2026-11-18").outMinor, 1_980);
  assert.equal(day("2026-11-20").outMinor, 4_800);
  assert.equal(day("2026-11-26").outMinor, 58_000);
  assert.equal(day("2026-11-27").outMinor, 82_000);
  assert.equal(day("2026-12-10").outMinor, 61_000);
  assert.equal(rows.reduce((sum, row) => sum + row.outMinor, 0), 1_980 + 4_800 + 58_000 + 82_000 + 61_000);
});

check("Nov 22 brings Acme ($1,200 at the sample's rate) and Nov 25 Northwind ($800), on their usual days", () => {
  assert.equal(day("2026-11-22").inMinor, 180_000);
  assert.equal(day("2026-11-25").inMinor, 120_000);
  assert.deepEqual(day("2026-11-22").items.map(item => item.label), ["Acme Corp"]);
  assert.deepEqual(day("2026-11-25").items.map(item => item.label), ["Northwind"]);
  assert.equal(rows.reduce((sum, row) => sum + row.inMinor, 0), 300_000);
});

check("Hikari Denki waits in To check on Nov 27: listed, flagged and not counted", () => {
  const hikari = day("2026-11-27").items.find(item => item.label === "Hikari Denki")!;
  assert.equal(hikari.pending, true);
  assert.equal(hikari.amountMinor, 11_220);
  assert.equal(day("2026-11-27").outMinor, 82_000, "only the rent is counted");
  const cell = data.weeks.flat().find(c => c.date === "2026-11-27")!;
  assert.ok(cell.items.some(text => text === "Hikari Denki ¥11,220 waits in To check and is not counted yet"));
  assert.equal(fact(result.facts, "to_check")!.value, 1);
});

check("short marks equal the late series below zero", () => {
  const late = series(benMoney, "worst", 30);
  assert.deepEqual(rows.map(row => row.short), late.map(balance => balance < 0));
  assert.deepEqual(rows.filter(row => row.short).map(row => row.date), ["2026-11-27", "2026-11-28"]);
  assert.equal(fact(result.facts, "short_days")!.value, 2);
});

check("the grid is whole Sunday-first weeks, today and the last day in range, the rest padded", () => {
  const cells = data.weeks.flat();
  assert.ok(data.weeks.every(week => week.length === 7));
  assert.equal(new Date(`${cells[0].date}T00:00:00Z`).getUTCDay(), 0);
  assert.equal(cells.filter(cell => cell.inRange).length, 30);
  assert.deepEqual(cells.filter(cell => cell.today).map(cell => cell.date), ["2026-11-14"]);
  assert.equal(data.maxOutMinor, 82_000);
});

check("the table twin has dated rows with the words, money out and in; the line and figures agree", () => {
  assert.deepEqual(result.table!.head, ["Day", "What", "Goes out", "Comes in"]);
  assert.ok(result.table!.rows.some(row => row.cells[0] === "Fri, Nov 27" && row.tone === "short" && row.cells[3] === "–"));
  assert.deepEqual(unconfirmedNumbers(result.line ?? "", checkable(result.facts), { today: ctx.state.today }), []);
  for (const item of result.facts) if (item.unit === "money") assert.ok(Number.isInteger(item.value), item.name);
  assert.equal(fact(result.facts, "goes_out")!.value, 207_780);
  assert.equal(fact(result.facts, "comes_in")!.value, 300_000);
  assert.equal(result.title, "When bills fall");
});

check("whose: shared lists only the shared bills, with no money in", () => {
  const shared = calendarDays(benMoney, 30, "shared"), coming = sharedBillsComing(benMoney);
  assert.equal(shared.reduce((sum, row) => sum + row.outMinor, 0), coming.reduce((sum, bill) => sum + bill.amountMinor, 0));
  assert.ok(shared.every(row => row.inMinor === 0 && !row.short));
  const view = calendarView({ whose: "shared" }, ctx);
  assert.equal(view.title, "When shared bills fall");
  // The table names each bill without its amount and adds who pays it.
  const member = benMoney.split.members[0], withPayer = { ...benMoney, bills: benMoney.bills.map(bill => bill.id === coming[0]?.key && member ? { ...bill, paidBy: member.id } : bill) };
  const table = calendarView({ whose: "shared" }, { state: withPayer }).table!;
  assert.deepEqual(table.head, ["Day", "What", "Paid by", "Goes out"]);
  assert.ok(table.rows.every(row => row.cells.length === 4 && !/[¥$−]/.test(row.cells[1])), "the What column holds names only");
  if (coming[0] && member) assert.ok(table.rows.some(row => row.cells[2].includes(member.name)));
});

check("fewer days narrow the window; no bills or clients is an empty state with Add a bill", () => {
  assert.equal(calendarDays(benMoney, 7).length, 7);
  const none = calendarView({}, { state: { ...benMoney, bills: [], cards: [], invoices: [] } });
  assert.equal(none.data, null);
  assert.equal(none.empty?.add, "bill");
});

check("the form draws a labelled grid, every day, the today mark, the money-in dot and the short mark", () => {
  const html = renderToStaticMarkup(createElement(Calendar, { result }));
  assert.ok(html.includes(`aria-label="${result.aria}"`));
  assert.equal((html.match(/class="cal-cell/g) ?? []).length, data.weeks.flat().length);
  assert.equal((html.match(/cal-today/g) ?? []).length, 1);
  assert.ok(html.includes("cal-dot-in") && html.includes("cal-dot-short"));
  assert.ok(html.includes("Fri, Nov 27: Hikari Denki ¥11,220 waits in To check and is not counted yet; Rent −¥82,000"));
});

check("the facts hold the sentence's numbers and dates, and every number in the line is one of them", () => {
  const facts = result.facts!;
  assert.deepEqual([fact(facts, "goes_out")!.value, fact(facts, "comes_in")!.value, fact(facts, "days_shown")!.value, fact(facts, "heaviest_day_goes_out")!.value], [207_780, 300_000, 30, 82_000]);
  assert.deepEqual([fact(facts, "first_short_day")!.value, fact(facts, "last_short_day")!.value, fact(facts, "short_days")!.value, fact(facts, "to_check")!.value], ["2026-11-27", "2026-11-28", 2, 1]);
  for (const view of [result, calendarView({ whose: "shared" }, ctx), calendarView({ days: 7 }, ctx)]) {
    assert.deepEqual(unconfirmedNumbers(view.line!, checkable(view.facts!), { today: benMoney.today }), []);
    assert.ok(view.facts!.every(item => TERMS.some(term => term.name === item.name)));
  }
});

console.log(`calendar: ${passed} passed`);
