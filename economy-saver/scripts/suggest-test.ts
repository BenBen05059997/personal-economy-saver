import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { and, eq } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/pglite";
import { billEditInput, insertBill, updateBill } from "@/db/bills";
import { chargeInput, insertCharge } from "@/db/charges";
import { confirmPending } from "@/db/confirm";
import { resetDemoHousehold } from "@/db/demo";
import { markPaidOutside } from "@/db/invoice-paid";
import { potInput, savePot } from "@/db/pots";
import { changeStandingRule, defaultRules, rulesFor, setStandingRule } from "@/db/rules";
import * as schema from "@/db/schema";
import { seedBen } from "@/db/seed";
import { createSpace, deleteSpace, generalSpace, renameSpace } from "@/db/spaces";
import { closeByRef, dismiss, notNow, openSuggestions, runPass } from "@/db/suggestions";
import { applyVerifiedDelivery } from "@/lib/events";
import { readRule, ruleWords } from "@/lib/money/rules";
import { fundingOptions } from "@/lib/money/options";
import { arrivals, daysBetween, expectedPayBasis, expectedPayOn } from "@/lib/money/runway";
import { findSuggestions } from "@/lib/money/suggest";
import { resolveBills } from "@/lib/money/repeat";
import type { Fact } from "@/lib/money/facts";
import { resolveView } from "@/lib/views/resolve";
import type { ViewResult } from "@/lib/views/types";
import { FINDING_RULE, findingAction, findingsBySpace, type Finding } from "@/lib/money/suggestion-types";
import { benMoney } from "@/lib/sample/ben";
import type { Bill, MoneyState } from "@/lib/money/types";

const day = (date: string) => new Date(date + "T00:00:00Z");
const today = "2026-11-14";
const sampleBill = { id: "fictional-bill", status: "pending", biller: "Kumo Water", due: "2026-11-17", amount: 2_500,
  category: "utilities", businessBp: 0 } satisfies Bill;

async function main() {
  const pg = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(pg, { schema });
  let passed = 0;
  async function check(name: string, run: () => Promise<void> | void) { await run(); passed++; console.log("✓ " + name); }

  try {
    const steps = readMigrationFiles({ migrationsFolder: "./drizzle" });
    for (const migration of steps.slice(0, 28)) await pg.transaction(async tx => {
      for (const sql of migration.sql) await tx.exec(sql);
    });
    const legacy = crypto.randomUUID(), legacyOff = crypto.randomUUID();
    await pg.query("insert into households (id, name, home_currency, nudge_after_days) values ($1, 'Fictional 60', 'JPY', 60), ($2, 'Fictional off', 'USD', null)", [legacy, legacyOff]);
    await pg.query("insert into rules (household_id, match_biller, patch) values ($1, 'bill:kumo water', $2::jsonb)", [legacy, JSON.stringify({ category: "utilities" })]);
    const correctionsBefore = (await pg.query("select * from rules where household_id = $1", [legacy])).rows;
    const migration = steps[28];
    await pg.transaction(async tx => { for (const sql of migration.sql) await tx.exec(sql); });
    for (const next of steps.slice(29)) await pg.transaction(async tx => {
      for (const sql of next.sql) await tx.exec(sql);
    });

    await check("0028 copies both old nudge settings, adds the other defaults and preserves reader corrections", async () => {
      assert.deepEqual((await rulesFor(db, legacy)).nudge_after, { enabled: true, threshold: 60, currency: null });
      assert.deepEqual((await rulesFor(db, legacyOff)).nudge_after, { enabled: false, threshold: null, currency: null });
      assert.deepEqual(await rulesFor(db, legacy), {
        ...defaultRules(), nudge_after: { enabled: true, threshold: 60, currency: null },
      });
      for (const hid of [legacy, legacyOff]) {
        assert.equal((await db.select().from(schema.standingRules).where(eq(schema.standingRules.householdId, hid))).length, 6);
      }
      assert.deepEqual((await pg.query("select * from rules where household_id = $1", [legacy])).rows, correctionsBefore,
        "the original reader correction row and its table shape are preserved");
      await pg.query("update households set nudge_after_days = 2 where id = $1", [legacy]);
      assert.equal((await rulesFor(db, legacy)).nudge_after.threshold, 60, "the legacy column is no longer read");
    });

    await check("a household made by older code initializes its rules once, and a partial set names the missing kind", async () => {
      const [{ id: hid }] = await db.insert(schema.households).values({ name: "Fictional legacy writer", homeCurrency: "JPY" })
        .returning({ id: schema.households.id });
      const reads = await Promise.all([rulesFor(db, hid), rulesFor(db, hid)]);
      assert.deepEqual(reads, [defaultRules(), defaultRules()]);
      const audit = await db.select().from(schema.events)
        .where(and(eq(schema.events.householdId, hid), eq(schema.events.kind, "rules_initialized")));
      assert.deepEqual(audit.map(row => row.title), ["Default standing rules added"]);
      assert.equal((await db.select().from(schema.standingRules).where(eq(schema.standingRules.householdId, hid))).length, 6);

      await db.delete(schema.standingRules)
        .where(and(eq(schema.standingRules.householdId, hid), eq(schema.standingRules.kind, "safe_below")));
      await assert.rejects(rulesFor(db, hid), /Missing standing rule: safe_below/);
      assert.equal((await db.select().from(schema.standingRules).where(eq(schema.standingRules.householdId, hid))).length, 5);
    });

    await check("new rule edits validate days, percent, currency and money limits in the same parser as Ask", () => {
      for (const kind of ["nudge_after", "bill_ahead", "statement_ahead"] as const) {
        for (const value of ["0", "31", "2.5", "1e1", "-1"]) assert.ok("problem" in readRule(kind, true, value, "JPY"), kind + " " + value);
        assert.deepEqual(readRule(kind, true, "30", "JPY"), { enabled: true, threshold: 30, currency: null });
      }
      assert.ok("problem" in readRule("cost_up", true, "101", "JPY"));
      assert.deepEqual(readRule("cost_up", true, "100", "JPY"), { enabled: true, threshold: 100, currency: null });
      assert.ok("problem" in readRule("goal_behind", true, "1", "JPY"));
      assert.deepEqual(readRule("goal_behind", true, null, "JPY"), { enabled: true, threshold: null, currency: null });
      for (const value of ["¥100,000,001", "0", "$5", "-100"]) assert.ok("problem" in readRule("safe_below", true, value, "JPY"), value);
      assert.deepEqual(readRule("safe_below", true, "¥100,000,000", "JPY"), { enabled: true, threshold: 100_000_000, currency: "JPY" });
      assert.deepEqual(readRule("safe_below", true, "12.34", "USD"), { enabled: true, threshold: 1_234, currency: "USD" });
    });

    await check("a migrated 60-day rule can be turned off as it stands, and turning it on requires a valid number", async () => {
      assert.equal(await changeStandingRule(db, legacy, { ruleKind: "nudge_after", enabled: false, value: "60" }), true);
      const off = (await rulesFor(db, legacy)).nudge_after;
      assert.deepEqual(off, { enabled: false, threshold: 60, currency: null });
      assert.equal(ruleWords("nudge_after", off), "Suggest sending a client the link again 60 days after their usual pay day (off)");
      await assert.rejects(changeStandingRule(db, legacy, { ruleKind: "nudge_after", enabled: true, value: "60" }), /1 to 30/);
      assert.equal(await changeStandingRule(db, legacy, { ruleKind: "nudge_after", enabled: true, value: "1" }), true);
      assert.equal(ruleWords("nudge_after", (await rulesFor(db, legacy)).nudge_after), "Suggest sending a client the link again 1 day after their usual pay day");
      assert.equal((await rulesFor(db, legacyOff)).nudge_after.enabled, false);
    });

    const quiet: MoneyState = { ...benMoney, bills: [], storedBills: [], invoices: [], statements: [], charges: [], pots: [] };
    const find = (state: MoneyState, rules = defaultRules()) => findSuggestions(state, rules);
    const kinds = (state: MoneyState, rules = defaultRules()) => find(state, rules).map(row => row.kind);
    await check("a sent invoice is late once the forecast's own expected pay day is the rule's days behind, with one finding and exact day boundaries", () => {
      const client = { ...benMoney.clients[0], daysToPay: [], termsDays: 0 };
      const invoice = { ...benMoney.invoices[0], clientId: client.id, sentOn: "2026-10-30", dueOn: "2026-11-10" };
      const state = { ...quiet, clients: [client], invoices: [invoice] };
      assert.equal(daysBetween(invoice.dueOn, state.today), 4, "the rule is 3 days: 4 days past is late");
      assert.deepEqual(kinds(state), ["invoice_nudge"]);
      assert.deepEqual(kinds({ ...state, invoices: [{ ...invoice, dueOn: "2026-11-11" }] }), [], "exactly the rule's days is not yet late");
      assert.deepEqual(kinds({ ...state, invoices: [{ ...invoice, hasLink: false }] }), [], "no payment link, no nudge");
      assert.deepEqual(kinds({ ...state, invoices: [{ ...invoice, status: "paid" }] }), []);
      const rules = defaultRules();
      rules.nudge_after.enabled = false;
      assert.deepEqual(kinds(state, rules), []);
    });

    await check("late follows the client's usual days to pay, and the reason says the usual-day fact", () => {
      const client = { ...benMoney.clients[0], daysToPay: [9, 9, 9], termsDays: 0 };
      const invoice = { ...benMoney.invoices[0], clientId: client.id, sentOn: "2026-11-02", dueOn: "2026-11-03" };
      const at = (today: string) => ({ ...quiet, today, clients: [client], invoices: [invoice] });
      assert.deepEqual(kinds(at("2026-11-14")), [], "usual pay day Nov 11, exactly 3 days past: not yet");
      const [nudge] = find(at("2026-11-15"));
      assert.deepEqual([nudge.kind, nudge.title, nudge.reason], ["invoice_nudge", "Send " + client.name + " the link again",
        client.name + " usually pays in 9 days; it is 4 days overdue, and it has been 13 days since the link was made."]);
    });

    await check("the reason quotes the value the trigger used: the due date with no history, the terms with neither", () => {
      const client = { ...benMoney.clients[0], daysToPay: [], termsDays: 14 };
      const base = { ...benMoney.invoices[0], clientId: client.id, sentOn: "2026-10-20" };
      const at = (invoice: typeof base) => ({ ...quiet, today: "2026-11-14", clients: [client], invoices: [invoice] });
      const due = { ...base, dueOn: "2026-11-05" };
      assert.equal(find(at(due))[0].reason, client.name + "'s invoice was due Nov 5; it is 9 days overdue, and it has been 25 days since the link was made.");
      assert.equal(expectedPayBasis(at(due), due).on, "2026-11-05");
      const bare = { ...due, dueOn: undefined };
      assert.equal(find(at(bare))[0].reason, client.name + "'s terms are 14 days; it is 11 days overdue, and it has been 25 days since the link was made.");
      assert.deepEqual(expectedPayBasis(at(bare), bare), { on: "2026-11-03", basis: "terms", days: 14 });
      assert.equal(expectedPayOn(at(bare), bare), "2026-11-03");
    });

    await check("Copy link again picks the earliest-expected sent invoice that has a link, and none when none has one", () => {
      const state = { ...benMoney, bank: 0, bills: [{ ...sampleBill, status: "confirmed", due: "2026-11-20", amount: 400_000 } satisfies Bill] };
      const sent = arrivals(state).sort((a, b) => a.expectedOn < b.expectedOn ? -1 : 1);
      assert.ok(sent.length >= 2 && sent[0].expectedOn !== sent[1].expectedOn, "the fixture has two sent invoices expected on different days");
      const remind = (linked: string[]) => fundingOptions({ ...state, invoices: state.invoices.map(i => ({ ...i, hasLink: linked.includes(i.id) })) }).rows.find(row => row.id === "remind");
      assert.equal(remind(sent.map(a => a.invoiceId))?.href, "/invoices/" + sent[0].invoiceId);
      assert.equal(remind([sent[1].invoiceId])?.href, "/invoices/" + sent[1].invoiceId, "the earlier one has no link, so it is skipped");
      assert.equal(remind([])?.href, undefined);
    });

    await check("bill and statement use their own windows, pending bills link to To check, and coverage uses the runway", () => {
      const statement = { ...benMoney.statements[0], dueOn: "2026-11-16" };
      const state = { ...quiet, bills: [sampleBill], statements: [statement] };
      const findings = find(state);
      assert.deepEqual(findings.map(row => row.kind), ["statement_due", "bill_due"]);
      assert.equal(findings[0].reason, "¥58,000, covered even if clients pay late.");
      assert.equal(findings[1].reason, "¥2,500, covered even if clients pay late.");
      assert.equal(findings[1].action, "check_bill");
      assert.equal(find({ ...state, bank: 0, paypal: 0 })[0].reason, "¥58,000, short even if clients pay as usual.");
      const rules = defaultRules();
      rules.statement_ahead.threshold = 1;
      rules.bill_ahead.threshold = 2;
      assert.deepEqual(kinds(state, rules), []);
      assert.deepEqual(kinds({ ...quiet, bills: [{ ...sampleBill, dueUnknown: true }] }), []);
    });

    await check("a 30-day rule includes a bill exactly 30 days ahead without extending the Home runway", () => {
      const storedBill = { ...sampleBill, due: "2026-12-14", status: "confirmed" as const };
      const state = { ...quiet, cards: [], storedBills: [storedBill] };
      const rules = defaultRules();
      rules.bill_ahead.threshold = 30;
      assert.deepEqual(kinds(state, rules), ["bill_due"]);
      rules.bill_ahead.threshold = 29;
      assert.deepEqual(kinds(state, rules), []);
      assert.deepEqual(state.bills, []);
    });

    await check("regular cost increases use last month and exceed the percent strictly", () => {
      const october = { ...sampleBill, status: "confirmed" as const, id: "oct", due: "2026-10-18", amount: 2_000 };
      const november = { ...sampleBill, status: "confirmed" as const, id: "nov", due: "2026-11-18", amount: 2_500 };
      const state = { ...quiet, storedBills: [october, november] };
      const rules = defaultRules();
      assert.deepEqual(kinds(state, rules), []);
      rules.cost_up = { enabled: true, threshold: 25, currency: null };
      assert.deepEqual(kinds(state, rules), []);
      rules.cost_up.threshold = 24;
      assert.deepEqual(kinds(state, rules), ["cost_up"]);
      assert.equal(find(state, rules)[0].reason, "¥500 more than last month.");
      assert.deepEqual(kinds({ ...quiet, storedBills: [october] }, rules), []);
    });

    await check("cancel-by has a three-day window and must have a renewal after it", () => {
      const renewal = { ...sampleBill, status: "confirmed" as const, due: "2026-11-20", cancelBy: "2026-11-17", repeatUnit: "month" as const, repeatDay: 20 };
      assert.deepEqual(kinds({ ...quiet, storedBills: [renewal] }), ["cancel_by"]);
      assert.equal(find({ ...quiet, storedBills: [renewal] })[0].reason, "It renews Nov 20 (¥2,500).");
      assert.deepEqual(kinds({ ...quiet, storedBills: [{ ...renewal, cancelBy: "2026-11-18" }] }), []);
      assert.deepEqual(kinds({ ...quiet, storedBills: [{ ...renewal, due: "2026-10-20", repeatUntil: "2026-10-20" }] }), []);
    });

    await check("only dated incomplete goals can fall behind, and the low-spend rule uses matching currency and a strict minimum", () => {
      const pot = { id: "camera", name: "Camera", saved: 100, target: 2_100, startedOn: "2026-10-15", targetDate: "2026-12-14" };
      assert.deepEqual(kinds({ ...quiet, pots: [pot] }), ["goal_behind"]);
      assert.deepEqual(kinds({ ...quiet, pots: [{ ...pot, targetDate: undefined }] }), []);
      assert.deepEqual(kinds({ ...quiet, pots: [{ ...pot, saved: pot.target }] }), []);
      const rules = defaultRules();
      rules.goal_behind.enabled = false;
      rules.safe_below = { enabled: true, threshold: 128_001, currency: "JPY" };
      assert.deepEqual(kinds(quiet, rules), ["safe_below"]);
      assert.deepEqual(kinds({ ...quiet, pots: [pot] }, rules), ["safe_below"]);
      rules.safe_below.threshold = 128_000;
      assert.deepEqual(kinds(quiet, rules), []);
      rules.safe_below = { enabled: true, threshold: 129_000, currency: "USD" };
      assert.deepEqual(kinds(quiet, rules), []);
    });

    // A finding's facts are its picture's facts for the same subject: each named fact equals the picture's, apart from which face made it.
    const strip = (item: Fact) => ({ ...item, from: "" });
    const sameFacts = (finding: Finding, picture: ViewResult, names: string[]) => {
      const mine = finding.facts.filter(item => names.includes(item.name));
      assert.deepEqual(mine.map(item => item.name).sort(), [...names].sort(), finding.kind + " carries " + names.join(", "));
      for (const item of mine) assert.deepEqual(picture.facts!.filter(other => other.name === item.name && other.about?.id === item.about?.id).map(strip), [strip(item)], finding.kind + ": " + item.name + " matches the picture");
    };

    await check("invoice_nudge carries the days overdue and the amount, and its days overdue equal client_pace's for that invoice", () => {
      const client = { ...benMoney.clients[0], daysToPay: [9, 9, 9], termsDays: 0 };
      const invoice = { ...benMoney.invoices[0], clientId: client.id, sentOn: "2026-11-02", dueOn: "2026-11-03" };
      const state = { ...quiet, today: "2026-11-15", clients: [client], invoices: [invoice] };
      const [nudge] = find(state);
      sameFacts(nudge, resolveView("client_pace", {}, { state }), ["days_overdue"]);
      const pays = nudge.facts.find(item => item.name === "client_pays")!;
      assert.deepEqual([pays.case, pays.about!.id, pays.period], ["as_usual", invoice.id, { on: arrivals(state)[0].expectedOn }]);
      assert.equal(pays.value, Math.round(arrivals(state)[0].amountHome));
    });

    await check("statement_due and bill_due carry the due date and the amount; an unknown amount is not_counted, never 0", () => {
      const rules = defaultRules();
      rules.bill_ahead.threshold = 10;
      const bill = { ...sampleBill, status: "confirmed" as const };
      const [found] = find({ ...quiet, bills: [bill], storedBills: [] }, rules);
      assert.deepEqual(found.facts.map(item => [item.name, item.value, item.about!.id]), [["due", "2026-11-17", bill.id], ["bill_amount", 2_500, bill.id]]);
      const unknown = find({ ...quiet, bills: [{ ...bill, uncounted: true }], storedBills: [] }, rules)[0];
      assert.deepEqual(unknown.facts.map(item => item.name), ["due", "not_counted"]);
      const card = benMoney.statements.length ? benMoney : null;
      assert.ok(card, "Ben has a card statement");
      rules.statement_ahead = { enabled: true, threshold: 30, currency: null };
      const statements = find({ ...benMoney, invoices: [] }, rules).filter(row => row.kind === "statement_due");
      assert.ok(statements.length > 0, "a statement falls due in 30 days");
      for (const row of statements) {
        const picture = resolveView("card_cycle", { cardId: row.refId! }, { state: { ...benMoney, invoices: [] } });
        const closed = row.facts.some(item => item.name === "statement_closed");
        const mine = (name: string) => row.facts.find(item => item.name === name)!;
        const theirs = (name: string) => picture.facts!.find(item => item.name === name)!;
        assert.deepEqual([mine("due").value, mine(closed ? "statement_closed" : "statement_open").value], [theirs(closed ? "closed_statement_due" : "due").value, theirs(closed ? "statement_closed" : "statement_open").value], "the due day and the amount are the card cycle's");
      }
    });

    await check("cost_up carries the change in amount and equals fixed_costs' change for that cost", () => {
      const october = { ...sampleBill, status: "confirmed" as const, id: "oct", due: "2026-10-18", amount: 2_000 };
      const november = { ...sampleBill, status: "confirmed" as const, id: "nov", due: "2026-11-18", amount: 2_500 };
      const state = { ...quiet, storedBills: [october, november] };
      const rules = defaultRules();
      rules.cost_up = { enabled: true, threshold: 24, currency: null };
      const [up] = find(state, rules);
      assert.equal(up.kind, "cost_up");
      const spending = { ...state, bills: resolveBills(state.storedBills, today, "JPY") };
      sameFacts(up, resolveView("fixed_costs", {}, { state, spending }), ["change_from_last_month"]);
      assert.equal(up.facts[0].value, 500);
    });

    await check("cancel_by carries the renewal day and its amount", () => {
      const renewal = { ...sampleBill, status: "confirmed" as const, due: "2026-11-20", cancelBy: "2026-11-17", repeatUnit: "month" as const, repeatDay: 20 };
      const [notice] = find({ ...quiet, storedBills: [renewal] });
      assert.deepEqual(notice.facts.map(item => [item.name, item.value]), [["due", "2026-11-20"], ["bill_amount", 2_500], ["cancel_by", "2026-11-17"]]);
    });

    await check("goal_behind carries the pace, the day and what is still to set aside, equal to goal_pace's", () => {
      const pot = { id: "camera", name: "Camera", saved: 100, target: 2_100, startedOn: "2026-10-15", targetDate: "2026-12-14" };
      const state = { ...quiet, pots: [pot] };
      const [goal] = find(state);
      assert.equal(goal.kind, "goal_behind");
      sameFacts(goal, resolveView("goal_pace", { potId: "camera" }, { state }), ["goal_pace", "goal_target_date", "goal_monthly_needed", "goal_still_to_set_aside"]);
    });

    await check("tax_short is a goal_behind finding: it carries the short amount, the day and the bill due, equal to tax_ahead's, and the switch silences it", () => {
      const tax = { id: "pot-tax", name: "Tax", saved: 10_000, fillPct: 20 };
      const taxBill = { id: "tax-1", biller: "Resident tax", amount: 100_000, due: "2026-12-20", category: "government_tax", businessBp: 0, status: "confirmed" } satisfies Bill;
      const state: MoneyState = { ...benMoney, bills: [taxBill], storedBills: [], statements: [], charges: [], pots: [tax] };
      const found = find(state).filter(row => row.kind === "tax_short");
      assert.equal(found.length, 1);
      assert.equal(FINDING_RULE.tax_short, "goal_behind");
      sameFacts(found[0], resolveView("tax_ahead", { potId: "pot-tax" }, { state }), ["tax_ahead", "tax_short_on", "bill_amount", "due"]);
      assert.deepEqual(found[0].facts.slice(0, 2).map(item => item.value), [30_000, "2026-12-20"]);
      assert.deepEqual([found[0].title, found[0].reason, found[0].action, found[0].refId], ["Tax falls short of the tax bills", "¥30,000 short on Dec 20, when Resident tax ¥100,000 is due.", "pot", "pot-tax"]);
      const rules = defaultRules();
      rules.goal_behind.enabled = false;
      assert.deepEqual(find(state, rules).filter(row => row.kind === "tax_short"), []);
      assert.deepEqual(find({ ...state, bills: [{ ...taxBill, amount: 40_000 }] }).filter(row => row.kind === "tax_short"), [], "a covered pot says nothing");
    });

    await check("safe_below carries safe to spend, equal to the forecast's", () => {
      const rules = defaultRules();
      rules.safe_below = { enabled: true, threshold: 99_999_999, currency: "JPY" };
      const below = find(benMoney, rules).find(row => row.kind === "safe_below")!;
      assert.ok(below, "Ben is under a huge minimum");
      sameFacts(below, resolveView("forecast", {}, { state: benMoney }), ["safe_to_spend"]);
    });

    await check("findingAction names the one button each action offers", () => {
      assert.deepEqual(findingAction({ action: "regular", refId: null }), { label: "Review regular costs", href: "/spending/over-time#regular-costs" });
      assert.equal(findingAction({ action: "pot", refId: "p" }).label, "Review pot");
      assert.throws(() => findingAction({ action: "pot", refId: null }), /reference/);
    });

    const demo = await seedBen(db, { isDemo: true });
    const other = await seedBen(db, { isDemo: true });
    const history = (id: string) => db.select().from(schema.suggestions).where(eq(schema.suggestions.householdId, id));
    const events = (id: string, kind: string) => db.select().from(schema.events).where(and(eq(schema.events.householdId, id), eq(schema.events.kind, kind)));
    const pending = async (id: string, name = sampleBill.biller) => (await db.insert(schema.bills).values({
      householdId: id, biller: name, amountMinor: 2_500, currency: "JPY", due: "2026-11-17", category: "utilities", status: "pending",
    }).returning())[0];
    const run = (id = demo, date = today) => runPass(db, id, day(date));
    const moveDemoDay = (id: string, date: string) => db.update(schema.households).set({ fixedToday: date }).where(eq(schema.households.id, id));

    await check("fresh Try it on Nov 14 and Reset have no suggestions and use the documented rule defaults", async () => {
      assert.deepEqual(await rulesFor(db, demo), defaultRules());
      assert.deepEqual(await openSuggestions(db, demo), []);
      const old = await seedBen(db, { isDemo: true });
      await pending(old);
      await run(old);
      assert.equal((await openSuggestions(db, old)).length, 1);
      const reset = await resetDemoHousehold(db, old);
      assert.ok(reset);
      assert.deepEqual(await openSuggestions(db, reset), []);
      assert.deepEqual(await history(old), []);
    });

    const bill = await pending(demo);
    await check("the pending-bill browser fixture has one suggestion, even across concurrent passes", async () => {
      await Promise.all([run(), run()]);
      const [row] = await openSuggestions(db, demo);
      assert.deepEqual([row.kind, row.title, row.reason, row.action, row.refId], [
        "bill_due", "Kumo Water due Nov 17", "¥2,500, covered even if clients pay late.", "check_bill", bill.id,
      ]);
      assert.equal((await history(demo)).length, 1);
      assert.equal((await events(demo, "suggestion_made")).length, 1);
    });

    await check("a canonical rule can move into a space without duplicating a finding, and Home groups by its current scope", async () => {
      const hid = await seedBen(db, { isDemo: true });
      const utilities = await createSpace(db, hid, "Fictional utilities review");
      const cash = await createSpace(db, hid, "Fictional runway review");
      const foreign = await createSpace(db, other, "Fictional foreign space");
      const general = await generalSpace(db, hid);
      await pending(hid);
      await run(hid);
      const [original] = await openSuggestions(db, hid);
      assert.equal(original.spaceId, null);

      const change = { ruleKind: "bill_ahead", enabled: true, value: "3" } as const;
      await assert.rejects(changeStandingRule(db, hid, { ...change, spaceId: foreign.id }), /Choose an open space/);
      assert.equal(await changeStandingRule(db, hid, { ...change, spaceId: utilities.id }), true, "same settings, newly linked");
      assert.equal(await changeStandingRule(db, hid, { ...change, spaceId: utilities.id }), false, "same link is a no-op");
      assert.equal(await changeStandingRule(db, hid, { ...change, enabled: false, value: null }), true);
      assert.deepEqual((await rulesFor(db, hid)).bill_ahead, { enabled: false, threshold: 3, currency: null, spaceId: utilities.id });
      assert.equal(await changeStandingRule(db, hid, change), true);
      assert.deepEqual((await rulesFor(db, hid)).bill_ahead, { enabled: true, threshold: 3, currency: null, spaceId: utilities.id });
      const [linked] = await openSuggestions(db, hid);
      assert.deepEqual([linked.id, linked.reason, linked.spaceName], [original.id, original.reason, utilities.name]);
      await changeStandingRule(db, hid, { ruleKind: "safe_below", enabled: true, value: "20000", spaceId: cash.id });
      await run(hid);
      const grouped = findingsBySpace(await openSuggestions(db, hid));
      assert.deepEqual(grouped.map(group => [group.name, group.rows.map(row => row.kind)]), [
        [cash.name, ["safe_below"]], [utilities.name, ["bill_due"]],
      ]);
      assert.deepEqual(findingsBySpace([original, { ...linked, spaceId: general.id, spaceName: general.name }]).map(group => group.name), ["General"]);

      await renameSpace(db, hid, utilities.id, "Fictional water review");
      assert.equal((await openSuggestions(db, hid)).find(row => row.id === original.id)?.spaceName, "Fictional water review");
      await deleteSpace(db, hid, utilities.id);
      assert.equal((await openSuggestions(db, hid)).find(row => row.id === original.id)?.spaceName, null);
      assert.equal((await rulesFor(db, hid)).bill_ahead.spaceId, undefined);
      assert.equal((await history(hid)).filter(row => row.kind === "bill_due").length, 1);
    });

    await check("Not now hides the suggestion through the same day and brings back the same row the next day", async () => {
      const [row] = await openSuggestions(db, demo);
      assert.equal(await notNow(db, demo, row.id, day(today)), true);
      await run();
      assert.deepEqual(await openSuggestions(db, demo), []);
      await setStandingRule(db, demo, "bill_ahead", { enabled: true, threshold: 2, currency: null });
      await moveDemoDay(demo, "2026-11-15");
      await run(demo, "2026-11-15");
      assert.equal((await openSuggestions(db, demo))[0].id, row.id);
      assert.equal((await events(demo, "suggestion_made")).length, 1);
    });

    await check("confirming the pending bill closes the same suggestion as approved in its transaction", async () => {
      assert.equal((await openSuggestions(db, demo)).length, 1);
      assert.equal(await confirmPending(db, demo, "bill", bill.id), true);
      assert.deepEqual(await openSuggestions(db, demo), []);
      assert.equal((await history(demo))[0].status, "approved");
      assert.equal((await events(demo, "suggestion_approved")).length, 1);
      await run(demo, "2026-11-15");
      assert.equal((await history(demo)).length, 1);
    });

    await check("dismissal survives a new day and 90-day pruning without reissuing the same finding", async () => {
      await pending(other);
      await run(other);
      const [row] = await openSuggestions(db, other);
      assert.equal(await dismiss(db, other, row.id, day(today)), true);
      await setStandingRule(db, other, "bill_ahead", { enabled: true, threshold: 2, currency: null });
      await moveDemoDay(other, "2026-11-15");
      await run(other, "2026-11-15");
      assert.deepEqual(await openSuggestions(db, other), []);
      assert.equal((await history(other))[0].status, "dismissed");
      assert.equal((await events(other, "suggestion_dismissed")).length, 1);
      await run(other, "2027-03-01");
      assert.deepEqual(await history(other), []);
      assert.equal((await events(other, "suggestion_made")).length, 1);
    });

    await check("a finding no longer true resolves even while deferred", async () => {
      const item = await pending(other, "Fictional change");
      await run(other);
      const [row] = await openSuggestions(db, other);
      await notNow(db, other, row.id, day(today));
      await db.update(schema.bills).set({ due: "2026-12-17" }).where(and(eq(schema.bills.householdId, other), eq(schema.bills.id, item.id)));
      await run(other);
      assert.deepEqual(await openSuggestions(db, other), []);
      assert.equal((await history(other)).find(saved => saved.id === row.id)?.status, "resolved");
    });

    await check("a late invoice with a payment link suggests sending the link again; only that set is remindable, and offering it closes the suggestion", async () => {
      const hid = await seedBen(db, { isDemo: true });
      const [invoice] = await db.update(schema.invoices).set({ sentOn: "2026-10-26", payToken: "tok-" + crypto.randomUUID() })
        .where(and(eq(schema.invoices.householdId, hid), eq(schema.invoices.number, "1042"))).returning();
      await setStandingRule(db, hid, "nudge_after", { enabled: true, threshold: 4, currency: null });
      await run(hid);
      const [nudge] = await openSuggestions(db, hid);
      assert.deepEqual([nudge.kind, nudge.action, nudge.refId, nudge.title], ["invoice_nudge", "remind", invoice.id, "Send Acme Corp the link again"]);
      assert.match(nudge.reason, /since the link was made/);
      // Without a link or not yet late, nothing is remindable.
      for (const change of [{ payToken: null }, { sentOn: "2026-11-05" }]) {
        const other = await seedBen(db, { isDemo: true });
        await setStandingRule(db, other, "nudge_after", { enabled: true, threshold: 4, currency: null });
        await db.update(schema.invoices).set({ sentOn: "2026-10-26", payToken: "tok-" + crypto.randomUUID(), ...change })
          .where(and(eq(schema.invoices.householdId, other), eq(schema.invoices.number, "1042")));
        await run(other);
        assert.ok(!(await openSuggestions(db, other)).some(row => row.kind === "invoice_nudge"), JSON.stringify(change));
      }
      await db.transaction(tx => closeByRef(tx, hid, invoice.id, ["remind"]));
      assert.ok(!(await openSuggestions(db, hid)).some(row => row.kind === "invoice_nudge"));
      assert.equal((await history(hid)).find(row => row.id === nudge.id)?.status, "approved");
      await run(hid);
      assert.ok(!(await openSuggestions(db, hid)).some(row => row.kind === "invoice_nudge"), "the nudge fires once per invoice");
    });

    await check("an old late_client row resolves on the next pass", async () => {
      const hid = await seedBen(db, { isDemo: true });
      await db.insert(schema.suggestions).values({ householdId: hid, kind: "late_client" as never, key: "late:old", title: "Acme Corp is past their usual payment day",
        reason: "Old.", action: "invoice" as never, refId: null, urgency: 2, createdOn: today });
      await run(hid);
      const [old] = await db.select().from(schema.suggestions).where(and(eq(schema.suggestions.householdId, hid), eq(schema.suggestions.key, "late:old")));
      assert.equal(old.status, "resolved");
    });
    const form = { madeBy: "form" } as const;
    const noCapture = async () => { throw new Error("A completed capture takes no payment"); };
    const capturePayment = (id: string, orderId: string, invoice: { id: string; amountMinor: number }) => ({ id, event_type: "PAYMENT.CAPTURE.COMPLETED",
      create_time: "2026-11-14T03:00:00Z", resource: { id: "CAP-" + id, status: "COMPLETED", custom_id: invoice.id,
        amount: { currency_code: "USD", value: (invoice.amountMinor / 100).toFixed(2) }, supplementary_data: { related_ids: { order_id: orderId } } } });
    const ask = () => ({ madeBy: "ask" as const, askId: crypto.randomUUID() });
    const lateInvoice = async (hid: string, paypalOrderId: string | null = null) => {
      const [row] = await db.update(schema.invoices).set({ sentOn: "2026-10-26", dueOn: "2026-11-10", paypalOrderId, payToken: "tok-" + crypto.randomUUID() })
        .where(and(eq(schema.invoices.householdId, hid), eq(schema.invoices.number, "1042"))).returning();
      return row;
    };

    await check("a confirmed bill or edit is noticed in the same request, while an Ask bill waits for confirmation", async () => {
      const hid = await seedBen(db, { isDemo: true });
      const draft = { id: crypto.randomUUID(), biller: "Kumo Water", due: "2026-11-17", amount: "2500", category: "utilities" } as const;
      await insertBill(db, hid, draft, "pending", ask());
      assert.deepEqual(await openSuggestions(db, hid), []);
      assert.equal(await confirmPending(db, hid, "bill", draft.id), true);
      const [noticed] = await openSuggestions(db, hid);
      assert.deepEqual([noticed.refId, noticed.action, noticed.reason], [draft.id, "bill", "¥2,500, covered even if clients pay late."]);

      const typed = { ...draft, id: crypto.randomUUID(), biller: "Fictional Landline", due: "2026-11-16" };
      await insertBill(db, hid, typed, "confirmed", form);
      assert.ok((await openSuggestions(db, hid)).some(row => row.refId === typed.id && row.title === "Fictional Landline due Nov 16"));

      const moved = { ...draft, id: crypto.randomUUID(), biller: "Fictional Heating", due: "2026-12-15" };
      await insertBill(db, hid, moved, "confirmed", form);
      assert.ok(!(await openSuggestions(db, hid)).some(row => row.refId === moved.id));
      assert.equal(await updateBill(db, hid, billEditInput.parse({ ...moved, due: "2026-11-15" }), form), true);
      assert.ok((await openSuggestions(db, hid)).some(row => row.refId === moved.id && row.title === "Fictional Heating due Nov 15"));
    });

    await check("confirming a repeating bill approves its existing due occurrence without opening a duplicate", async () => {
      const hid = await seedBen(db, { isDemo: true });
      const draft = { id: crypto.randomUUID(), biller: "Fictional Recurring Water", due: "2026-11-17", amount: "2500", category: "utilities", repeat: "month" } as const;
      await insertBill(db, hid, draft, "pending", ask());
      await run(hid); // A scheduled pass can already have flagged this pending occurrence.
      const [suggested] = await openSuggestions(db, hid);
      assert.deepEqual([suggested.refId, suggested.action], [draft.id, "check_bill"]);
      assert.equal(await confirmPending(db, hid, "bill", draft.id), true);
      assert.deepEqual(await openSuggestions(db, hid), []);
      assert.deepEqual((await history(hid)).map(row => [row.id, row.key, row.status]), [[suggested.id, "bill:" + draft.id + ":2026-11-17", "approved"]]);
      assert.equal((await events(hid, "suggestion_made")).length, 1);
      assert.equal((await events(hid, "suggestion_approved")).length, 1);
    });

    await check("a typed charge and a separately confirmed draft both flag a regular cost increase immediately", async () => {
      const hid = await seedBen(db, { isDemo: true });
      const [card] = await db.select({ id: schema.cards.id }).from(schema.cards)
        .where(and(eq(schema.cards.householdId, hid), eq(schema.cards.label, "Card A")));
      const names = ["Fictional Fabric", "Fictional Studio Supplies"];
      await db.insert(schema.charges).values(names.map(merchant => ({
        householdId: hid, cardId: card.id, merchant, date: "2026-10-07", amountMinor: 2_000, currency: "JPY",
        category: "business_tools", source: "manual" as const,
      })));
      await setStandingRule(db, hid, "cost_up", { enabled: true, threshold: 24, currency: null });
      const newCharge = (merchant: string) => chargeInput.parse({
        id: crypto.randomUUID(), cardId: card.id, merchant, date: "2026-11-07", amount: "2500", category: "business_tools",
      });
      const draft = newCharge(names[1]);
      await insertCharge(db, hid, draft, "pending", "manual", ask());
      assert.deepEqual(await openSuggestions(db, hid), []);
      await insertCharge(db, hid, newCharge(names[0]), "confirmed", "manual", form);
      assert.deepEqual((await openSuggestions(db, hid)).map(row => [row.kind, row.title, row.reason]), [
        ["cost_up", names[0] + " costs more this month", "¥500 more than last month so far."],
      ]);
      assert.equal(await confirmPending(db, hid, "charge", draft.id), true);
      assert.deepEqual((await openSuggestions(db, hid)).map(row => row.title), names.map(name => name + " costs more this month"));
    });

    await check("confirming a pot flags low safe to spend and editing it resolves the finding immediately", async () => {
      const hid = await seedBen(db, { isDemo: true });
      await db.update(schema.households).set({ bankBalanceMinor: 107_000 }).where(eq(schema.households.id, hid));
      await setStandingRule(db, hid, "safe_below", { enabled: true, threshold: 15_000, currency: "JPY" });
      const pot = potInput.parse({ id: crypto.randomUUID(), name: "Camera", saved: "10000" });
      await savePot(db, hid, pot, "pending", ask());
      assert.deepEqual(await openSuggestions(db, hid), []);
      assert.equal(await confirmPending(db, hid, "pot", pot.id), true);
      const [low] = await openSuggestions(db, hid);
      assert.deepEqual([low.kind, low.reason], ["safe_below", "¥11,220 safe to spend, below ¥15,000."]);
      await savePot(db, hid, { ...pot, saved: "0" }, "confirmed", form);
      assert.deepEqual(await openSuggestions(db, hid), []);
      assert.deepEqual((await history(hid)).map(row => [row.id, row.status]), [[low.id, "resolved"]]);
    });

    await check("a full verified PayPal payment resolves its late invoice immediately and a partial payment does not", async () => {
      const hid = await seedBen(db, { isDemo: true });
      const remote = "ORDER-FICTIONAL-NOTICING";
      const invoice = await lateInvoice(hid, remote);
      await run(hid);
      const before = await openSuggestions(db, hid);
      assert.deepEqual(before.map(row => [row.kind, row.refId]), [["invoice_nudge", invoice.id]]);
      const payment = capturePayment("WH-FICTIONAL-NOTICING", remote, invoice);
      await applyVerifiedDelivery(db, { ...payment, id: payment.id + "-PARTIAL", resource: { ...payment.resource, status: "PENDING" } }, noCapture);
      assert.deepEqual(await openSuggestions(db, hid), before);
      await applyVerifiedDelivery(db, payment, noCapture);
      await applyVerifiedDelivery(db, payment, noCapture);
      assert.deepEqual(await openSuggestions(db, hid), []);
      const rows = await history(hid);
      assert.deepEqual(rows.map(row => row.id).sort(), before.map(row => row.id).sort());
      assert.ok(rows.every(row => row.status === "resolved"));
    });

    await check("a failed suggestion pass preserves Try it, Reset, a confirmation and a verified payment", async () => {
      const hid = await seedBen(db, { isDemo: true });
      const resetFrom = await seedBen(db, { isDemo: true });
      const remote = "ORDER-FICTIONAL-PASS-FAILURE";
      const invoice = await lateInvoice(hid, remote);
      await run(hid);
      assert.ok((await openSuggestions(db, hid)).some(row => row.refId === invoice.id));
      const potId = await savePot(db, hid, potInput.parse({ id: crypto.randomUUID(), name: "Fictional camera", saved: "0", memberId: null }), "pending", ask());
      const payment = capturePayment("WH-FICTIONAL-PASS-FAILURE", remote, invoice);
      await pg.exec(`
        create function fail_pass() returns trigger language plpgsql as $$
        begin raise exception 'Forced suggestion pass failure'; end $$;
        create trigger fail_pass before update on suggestions for each statement execute function fail_pass();
      `);
      const logs: string[] = [];
      const original = console.error;
      let demoId: string, resetId: string | null;
      try {
        console.error = (message: string) => logs.push(message);
        demoId = await seedBen(db, { isDemo: true });
        resetId = await resetDemoHousehold(db, resetFrom);
        assert.equal(await confirmPending(db, hid, "pot", potId), true);
        await applyVerifiedDelivery(db, payment, noCapture);
        await applyVerifiedDelivery(db, payment, noCapture);
      } finally {
        console.error = original;
        await pg.exec("drop trigger fail_pass on suggestions; drop function fail_pass()");
      }
      assert.ok(resetId);
      assert.deepEqual(logs.map(line => JSON.parse(line)), [
        [demoId, "seedBen"], [resetId, "resetDemoHousehold"], [hid, "confirmPending"], [hid, "applyVerifiedDelivery"],
      ].map(([householdId, callSite]) => ({ at: "suggestion_pass", householdId, callSite, name: "Error", message: "Database query failed" })));
      for (const id of [demoId, resetId]) {
        const [household] = await db.select().from(schema.households).where(eq(schema.households.id, id));
        assert.equal(household.fixedToday, today);
        assert.deepEqual(await rulesFor(db, id), defaultRules());
        assert.ok((await db.select().from(schema.bills).where(eq(schema.bills.householdId, id))).length);
      }
      assert.deepEqual(await db.select().from(schema.households).where(eq(schema.households.id, resetFrom)), []);
      const [pot] = await db.select().from(schema.pots).where(and(eq(schema.pots.householdId, hid), eq(schema.pots.id, potId)));
      assert.equal(pot.status, "confirmed");
      const [paid] = await db.select().from(schema.invoices).where(and(eq(schema.invoices.householdId, hid), eq(schema.invoices.id, invoice.id)));
      assert.equal(paid.status, "paid");
      assert.equal((await events(hid, "invoice_paid")).length, 1);
      const [delivery] = await db.select().from(schema.webhookDeliveries)
        .where(and(eq(schema.webhookDeliveries.householdId, hid), eq(schema.webhookDeliveries.paypalEventId, payment.id)));
      assert.equal(delivery.verified, true);
      assert.ok((await openSuggestions(db, hid)).some(row => row.refId === invoice.id));
      await run(hid);
      assert.ok(!(await openSuggestions(db, hid)).some(row => row.refId === invoice.id));
    });

    await check("mark paid outside PayPal resolves its late invoice finding", async () => {
      const hid = await seedBen(db, { isDemo: true });
      const invoice = await lateInvoice(hid);
      await run(hid);
      const [late] = await openSuggestions(db, hid);
      assert.deepEqual([late.kind, late.refId], ["invoice_nudge", invoice.id]);
      assert.deepEqual(await openSuggestions(db, hid), [late]);
      assert.equal(await markPaidOutside(db, hid, invoice.id, today), true);
      assert.equal(await markPaidOutside(db, hid, invoice.id, today), false);
      assert.deepEqual(await openSuggestions(db, hid), []);
      assert.deepEqual((await history(hid)).map(row => [row.id, row.status]), [[late.id, "resolved"]]);
    });
  } finally {
    await pg.close();
  }
  console.log("suggestions: " + passed + " passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
