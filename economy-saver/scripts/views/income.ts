// Money in (D77): income_months and client_pace on a fixture household and on Ben's sample, and the strip form. Fictional data only; PGlite, no credentials.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { loadMoneyState } from "@/db/household";
import { loadIncome } from "@/db/income";
import { seedBen } from "@/db/seed";
import { unconfirmedNumbers } from "@/lib/ai/number-check";
import { fact } from "@/lib/money/facts";
import { termOf } from "@/lib/money/terms";
import { incomeByMonth } from "@/lib/money/income";
import { paceDots } from "@/lib/money/pace";
import { overdue } from "@/lib/money/runway";
import { resolveView } from "@/lib/views/resolve";
import { ViewError, type ViewResult } from "@/lib/views/types";
import { StackedColumns } from "@/components/views/forms/StackedColumns";
import { Strip } from "@/components/views/forms/Strip";
import { clientPaceView, incomeMonthsView } from "@/lib/views/v/income";

let passed = 0;
const reads = (view: ViewResult, today: string) => {
  assert.ok(view.facts && view.facts.length > 0, `${view.view} carries facts`);
  assert.deepEqual(unconfirmedNumbers(view.line ?? "", view.facts, today), [], `${view.view}: every number in the line is one of its facts`);
  for (const item of view.facts) assert.doesNotThrow(() => termOf(item.name), `${item.name} is a term`);
};
async function check(name: string, run: () => void | Promise<void>) { await run(); passed++; console.log(`✓ ${name}`); }
const TODAY = "2026-11-14", RANGE = { from: "2026-06-01", to: "2026-11-30" };

async function main() {
  const pg = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(pg, { schema });
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });

    // A fixture household: two clients; USD invoices with and without a rate, a yen one, a member's request and a payment read from a connected PayPal.
    const [house] = await db.insert(schema.households).values({ name: "Fixture", homeCurrency: "JPY" }).returning();
    const hid = house.id;
    const [alpha, bravo] = await db.insert(schema.clients).values([{ householdId: hid, name: "Alpha Studio", email: "ap@alpha.example" }, { householdId: hid, name: "Bravo Co", email: "ap@bravo.example" }]).returning();
    const [member] = await db.insert(schema.members).values({ householdId: hid, displayName: "Wife", shareBp: 10_000 }).returning();
    const paid = { householdId: hid, status: "paid" as const };
    await db.insert(schema.invoices).values([
      { ...paid, clientId: alpha.id, item: "Logo", amountMinor: 100_000, currency: "USD", fxRateMicro: 150_000_000, sentOn: "2026-09-01", paidOn: "2026-09-10" },
      { ...paid, clientId: alpha.id, item: "Poster", amountMinor: 50_000, currency: "USD", fxRateMicro: 160_000_000, sentOn: "2026-10-01", paidOn: "2026-10-05" },
      { ...paid, clientId: bravo.id, item: "Icons", amountMinor: 20_000, currency: "USD", sentOn: "2026-10-01", paidOn: "2026-10-07" },
      { ...paid, clientId: bravo.id, item: "Web", amountMinor: 30_000, currency: "JPY", sentOn: "2026-10-10", paidOn: "2026-10-20" },
      { ...paid, clientId: null, payerMemberId: member.id, owedMinor: 15_000, item: "Wife's share", amountMinor: 10_000, currency: "USD", fxRateMicro: 150_000_000, sentOn: "2026-10-10", paidOn: "2026-10-12" },
      { ...paid, clientId: alpha.id, item: "Read from PayPal", amountMinor: 20_000, currency: "USD", fxRateMicro: 150_000_000, sentOn: null, paidOn: "2026-11-03", madeBy: "paypal" },
    ]);
    const rows = await loadIncome(db, hid, RANGE);

    await check("the fixture: the request is left out, the unrated one has no value, the PayPal-read one is counted with no sent day", () => {
      assert.equal(rows.length, 5);
      assert.ok(!rows.some(row => row.clientId === null));
      assert.equal(rows.find(row => row.clientName === "Bravo Co" && row.homeMinor === null)?.paidOn, "2026-10-07");
      const read = rows.find(row => row.paidOn === "2026-11-03")!;
      assert.deepEqual([read.sentOn, read.homeMinor], [null, 30_000]);
    });

    await check("per-month totals per client; average and lowest over the completed months; the unrated client named and not counted", () => {
      const found = incomeByMonth(rows, TODAY, 3);
      assert.deepEqual(found.months.map(m => [m.month, m.total, m.current]), [["2026-09", 150_000, false], ["2026-10", 110_000, false], ["2026-11", 30_000, true]]);
      assert.deepEqual(found.months[1].byClient, { [alpha.id]: 80_000, [bravo.id]: 30_000 });
      assert.deepEqual(found.clients.map(c => [c.name, c.total]), [["Alpha Studio", 260_000], ["Bravo Co", 30_000]]);
      assert.equal(found.averageMinor, 130_000);
      assert.deepEqual(found.lowest, { month: "2026-10", name: "October", minor: 110_000 });
      assert.deepEqual(found.unrated, ["Bravo Co"]);
    });

    await check("the view stacks by client with Average and Lowest month lines, a table, and says the unrated payment is not counted", () => {
      const result = incomeMonthsView({ months: 3 }, { state: { today: TODAY, homeCurrency: "JPY", clients: [{ id: alpha.id }, { id: bravo.id }] } as never, income: rows }) as ViewResult<"stacked_columns">;
      assert.deepEqual(result.data!.segments.map(s => s.legend), ["Alpha Studio", "Bravo Co"]);
      assert.deepEqual(result.data!.refs, [{ label: "Average", minor: 130_000 }, { label: "Lowest month", minor: 110_000 }]);
      assert.deepEqual(result.data!.columns.map(c => c.parts), [[150_000, 0], [80_000, 30_000], [30_000, 0]]);
      assert.deepEqual(result.table!.head, ["Month", "Alpha Studio", "Bravo Co", "Total"]);
      assert.match(result.line!, /Bravo Co paid at a rate that is not known, so that payment is not counted\./);
      assert.deepEqual(unconfirmedNumbers(result.line ?? "", result.facts, TODAY), []);
    });

    // Ben's sample.
    const ben = await seedBen(db, { isDemo: true });
    const state = await loadMoneyState(db, ben, TODAY);
    const income = await loadIncome(db, ben, RANGE);
    const ctx = { state, income };
    const result = resolveView("income_months", {}, ctx) as ViewResult<"stacked_columns">;
    const data = result.data!;

    await check("Ben: six columns June to November, stacked by his three clients, averaging the five completed months", () => {
      assert.deepEqual(data.columns.map(c => c.key), ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
      assert.equal(data.columns.filter(c => c.current).length, 1);
      assert.deepEqual(data.segments.map(s => s.legend).sort(), ["Acme Corp", "Beacon Studio", "Northwind"]);
      assert.equal(data.columns.reduce((sum, c) => sum + c.total, 0), 1_590_000);
      for (const c of data.columns) assert.equal(c.parts.reduce((a, b) => a + b, 0), c.total);
      assert.deepEqual(data.columns.map(c => c.total), [307_500, 457_500, 210_000, 255_000, 202_500, 157_500]);
      const completed = data.columns.slice(0, 5);
      const average = Math.round(completed.reduce((sum, c) => sum + c.total, 0) / 5), lowest = Math.min(...completed.map(c => c.total));
      assert.equal(average, 286_500);
      assert.equal(lowest, 202_500, "the sample's months differ: the lowest sits well under the average");
      assert.deepEqual(data.refs, [{ label: "Average", minor: average }, { label: "Lowest month", minor: lowest }]);
      assert.equal(fact(result.facts, "income_a_month")!.value, average);
      assert.deepEqual(unconfirmedNumbers(result.line ?? "", result.facts, TODAY), []);
    });

    await check("Ben's pace: Acme usual 14, slowest 25, open 6 days; Northwind 12 / 16, open 1 day; Beacon 2 / 3", () => {
      const dots = paceDots(state), by = (name: string) => dots.find(d => d.name.startsWith(name))!;
      assert.deepEqual([by("Acme").usual, by("Acme").slowest, by("Acme").open.map(o => o.days)], [14, 25, [6]]);
      assert.deepEqual([by("Northwind").usual, by("Northwind").slowest, by("Northwind").open.map(o => o.days)], [12, 16, [1]]);
      assert.deepEqual([by("Beacon").usual, by("Beacon").slowest, by("Beacon").open.length], [2, 3, 0]);
      assert.ok(dots.every(d => d.open.every(o => !o.late)));
      const pace = resolveView("client_pace", {}, ctx) as ViewResult<"strip">;
      assert.equal(pace.data!.rows.length, 3);
      assert.equal(pace.data!.rows.find(r => r.label === "Acme Corp")!.dots.length, 5);
      assert.deepEqual(pace.table!.head, ["Client", "Usual", "Slowest", "Paid invoices", "Open now"]);
      assert.equal(pace.table!.rows.find(r => r.cells[0] === "Acme Corp")!.cells[4], "Invoice 1042: 6 days");
      assert.deepEqual(unconfirmedNumbers(pace.line ?? "", pace.facts, TODAY), []);
      assert.match(pace.line!, /^Acme Corp is the slowest to pay: 14 days usual, 25 at most\.$/);
      const one = resolveView("client_pace", { clientId: state.clients.find(c => c.name === "Northwind")!.id }, ctx) as ViewResult<"strip">;
      assert.deepEqual(one.data!.rows.map(r => r.label), ["Northwind"]);
    });

    await check("Ben: income_months and client_pace read clean; client_pace carries usual, slowest, days open and days overdue per client and invoice, and says no 'late'", () => {
      reads(result, TODAY);
      const pace = resolveView("client_pace", {}, ctx) as ViewResult<"strip">;
      reads(pace, TODAY);
      const acme = state.clients.find(c => c.name.startsWith("Acme"))!, invoice = state.invoices.find(i => i.clientId === acme.id && i.status === "sent")!;
      const factFor = (name: string, id: string) => pace.facts!.find(f => f.name === name && f.about?.id === id);
      assert.deepEqual([factFor("usual_days_to_pay", acme.id)!.value, factFor("slowest_days_to_pay", acme.id)!.value], [14, 25]);
      assert.equal(factFor("days_open", invoice.id)!.value, 6);
      assert.equal(factFor("days_overdue", invoice.id)!.value, overdue(state, invoice).daysOverdue);
      assert.equal(factFor("days_overdue", invoice.id)!.about!.type, "invoice");
      assert.ok(!/late/i.test(JSON.stringify(pace.table)), "the table says overdue or longer than the slowest, never late");
      const later = { ...state, today: "2026-12-10" }, past = clientPaceView({}, { state: later });
      reads(past, "2026-12-10");
      assert.equal(past.facts!.find(f => f.name === "days_open")!.value, 32);
      assert.ok(past.table!.rows[0].cells[4].includes("longer than the slowest"));
    });

    await check("an open invoice past the slowest is late; an unknown client is refused in words; extra keys are refused", () => {
      const late = { ...state, today: "2026-12-10" }, acme = paceDots(late).find(d => d.name.startsWith("Acme"))!;
      assert.deepEqual(acme.open.map(o => [o.days, o.late]), [[32, true]]);
      assert.match((clientPaceView({}, { state: late }) as ViewResult).line!, /Invoice 1042 from Acme Corp has been open 32 days, longer than any they paid in\./);
      assert.throws(() => resolveView("client_pace", { clientId: "nope" }, ctx), (e: unknown) => e instanceof ViewError && /couldn't find that client/.test(e.message));
      assert.throws(() => resolveView("client_pace", { months: 3 }, ctx), /does not take "months"/);
      assert.throws(() => resolveView("income_months", { months: 1 }, ctx), ViewError);
    });

    await check("empty: no client asks for one; clients but no payment says money in shows once one has paid", () => {
      const none = resolveView("income_months", {}, { state: { ...state, clients: [] }, income: [] });
      assert.equal(none.data, null);
      assert.deepEqual([none.empty!.words, none.empty!.add], ["Add a client who pays you, and what they pay shows here.", "client"]);
      const unpaid = resolveView("income_months", {}, { state, income: [] });
      assert.equal(unpaid.empty!.words, "Money in shows here once a client has paid you.");
      const quiet = resolveView("client_pace", {}, { state: { ...state, clients: state.clients.map(c => ({ ...c, daysToPay: [] })) } });
      assert.equal(quiet.empty!.words, "Money in shows here once a client has paid you.");
      assert.equal(resolveView("client_pace", {}, { state: { ...state, clients: [] } }).empty!.add, "client");
    });

    await check("the forms draw: a column per month with the refs; a row per client with a dot per paid invoice and a ring per open one", () => {
      const columns = renderToStaticMarkup(createElement(StackedColumns, { result }));
      assert.equal((columns.match(/class="sc-col/g) ?? []).length, 6);
      assert.ok(columns.includes("Average"));
      const pace = resolveView("client_pace", {}, ctx) as ViewResult<"strip">;
      const html = renderToStaticMarkup(createElement(Strip, { result: pace }));
      assert.ok(html.includes(`aria-label="${pace.aria}"`));
      assert.equal((html.match(/class="st-row[ "]/g) ?? []).length, 3);
      assert.equal((html.match(/class="st-dot"/g) ?? []).length, 6 + 5 + 5);
      assert.equal((html.match(/class="st-open"/g) ?? []).length, 2);
      assert.equal((html.match(/st-usual/g) ?? []).length, 3);
    });
  } finally {
    await pg.close();
  }
  console.log(`\n${passed} checks passed`);
}

export const done = main();
