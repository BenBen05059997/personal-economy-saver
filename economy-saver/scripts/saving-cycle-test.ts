// The whole cycle of "What we made" (D81), end to end on one household: a client payment fills pots, a saving is found and kept, a
// choice is said in Ask and confirmed, a purchase is paid from a pot, money moves between pots, the pictures read the same sums as
// the engine, a withdrawn choice leaves the medals' dates alone, and a fresh Try it stays quiet. PGlite and the fake model transport;
// no network, no credentials. Every step runs on the same household, in order, and every step ends by checking that each pot's
// confirmed moves add up to what it holds.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/saving-cycle-test.ts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { anthropicReply } from "./ai-fake";
import { createChecks, openDb, saveEnv } from "./fixtures/harness";
import * as schema from "@/db/schema";
import { aiConnection } from "@/db/ai-key";
import { chargeInput, insertCharge } from "@/db/charges";
import { loadChoices, keepFoundWin, removePendingChoice, withdrawChoice } from "@/db/choices";
import { confirmPending } from "@/db/confirm";
import { DEMO_DATE } from "@/db/clock";
import { loadMoneyState } from "@/db/household";
import { markPaidOutside } from "@/db/invoice-paid";
import { loadPotMoves } from "@/db/pot-moves";
import { markPotDone, movePot, savePot } from "@/db/pots";
import { addMember } from "@/db/people";
import { rulesFor } from "@/db/rules";
import { seedBen } from "@/db/seed";
import { dismiss, openSuggestions, runPass } from "@/db/suggestions";
import { loadSpending } from "@/db/spending";
import { AgentError, runAgent } from "@/lib/agent/run";
import { tools } from "@/lib/agent/tools";
import type { Fact } from "@/lib/money/facts";
import { goalPace } from "@/lib/money/goals";
import { toMinor } from "@/lib/money/format";
import { foundWins, medals, milestones, monthWins, potStory, setAside } from "@/lib/money/saving";
import { safeToSpend } from "@/lib/money/runway";
import { HISTORY_MONTHS, monthBounds, monthsBack, spendingItems } from "@/lib/money/spending";
import { taxAhead } from "@/lib/money/tax-ahead";
import type { MoneyState } from "@/lib/money/types";

type Block = Record<string, unknown>;
const KEY = "sk-ant-fictional-" + "a".repeat(40);
const APP = new URL("http://127.0.0.1:3123");
const OWN = { madeBy: "form" } as const;
const AI_NAMES = ["AI_PROTOCOL", "AI_BASE_URL", "AI_API_KEY", "AI_TEXT_MODEL", "ASK_BUDGET_MS"];
const text = (value: string): Block => ({ type: "text", text: value });
const toolUse = (id: string, name: string, input: unknown): Block => ({ type: "tool_use", id, name, input });
const reply = (stop: string, content: Block[]) => anthropicReply(stop, content);

/** A scripted model: each request gets the next response. */
function transport(script: (() => Response)[]) {
  let calls = 0;
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    assert.equal(new URL(request.url).host, "api.anthropic.com");
    assert.equal(request.headers.get("x-api-key"), KEY);
    await request.json();
    const next = script[calls++];
    assert.ok(next, "unexpected extra model call");
    return next();
  }) as typeof globalThis.fetch;
  return { fetch, calls: () => calls };
}

async function main() {
  const { pg, db } = await openDb();
  const restoreEnv = saveEnv(AI_NAMES);
  const { check, tally } = createChecks();
  try {
    process.env.AI_PROTOCOL = "anthropic";
    process.env.AI_API_KEY = KEY;
    process.env.AI_TEXT_MODEL = "fixture-text";
    delete process.env.ASK_BUDGET_MS;

    // ------------------------------------------------------------ the household: Ben and Rin, three pots, a fixed today
    const hid = await seedBen(db, { isDemo: true });
    const ben = (await db.select().from(schema.members).where(and(eq(schema.members.householdId, hid), eq(schema.members.displayName, "Ben"))))[0].id;
    const rin = await addMember(db, hid, { name: "Rin" });
    const potIds = { hakone: randomUUID(), tax: randomUUID(), rainy: randomUUID(), laptop: randomUUID() };
    const setToday = (day: string) => db.update(schema.households).set({ fixedToday: day }).where(eq(schema.households.id, hid));
    const todayOf = async () => (await db.select().from(schema.households).where(eq(schema.households.id, hid)))[0].fixedToday!;
    const stateOf = async (): Promise<MoneyState> => loadMoneyState(db, hid, await todayOf());
    const record = async () => ({ moves: await loadPotMoves(db, hid), choices: await loadChoices(db, hid) });
    const bank = async () => (await db.select().from(schema.households).where(eq(schema.households.id, hid)))[0].bankBalanceMinor;
    const card = async () => (await stateOf()).cards[0].id;

    await savePot(db, hid, { id: potIds.hakone, name: "Hakone weekend", target: "80000", targetDate: null, saved: "40000", fillPct: "10", memberId: null, category: "travel" }, "confirmed", OWN);
    await savePot(db, hid, { id: potIds.tax, name: "Tax for March", target: null, targetDate: null, saved: "0", fillPct: "10", memberId: null, category: "government_tax" }, "confirmed", OWN);
    await savePot(db, hid, { id: potIds.rainy, name: "Rainy day", target: null, targetDate: null, saved: "2000", fillPct: null, memberId: null, category: null }, "confirmed", OWN);

    /** Every pot's confirmed moves add up to what it holds, in the table and in the engine's story. */
    const sums = async () => {
      const pots = await db.select().from(schema.pots).where(and(eq(schema.pots.householdId, hid), eq(schema.pots.status, "confirmed")));
      const moves = await db.select().from(schema.potMoves).where(and(eq(schema.potMoves.householdId, hid), eq(schema.potMoves.status, "confirmed")));
      for (const pot of pots) assert.equal(moves.filter(move => move.potId === pot.id).reduce((total, move) => total + move.amountMinor, 0), pot.savedMinor, `${pot.name}: its moves add up to what it holds`);
      const state = await stateOf(), rec = await record();
      for (const pot of state.pots) potStory(rec, pot, "JPY"); // throws, naming the pot, when a story does not sum
      return pots.length;
    };

    // The pictures through the same `show` tool Ask uses; the facts come back as the run would add them to its answer.
    const show = async (view: string, args: Record<string, unknown> | null) => {
      const tool = tools.find(t => t.name === "show")!;
      let got: { facts: Fact[]; sentence: string | null } | undefined;
      const ctx = { madeBy: "mcp" as const, db, householdId: hid, state: stateOf, appUrl: APP, requestId: randomUUID(), onView: (view: { facts: Fact[]; sentence: string | null }) => { got = view; } };
      await tool.run(ctx as never, tool.input.parse({ view, args: args ? JSON.stringify(args) : null }) as never);
      assert.ok(got, `${view} drew`);
      return got;
    };
    const factsNamed = (facts: Fact[], name: string) => facts.filter(item => item.name === name);
    const only = (facts: Fact[], name: string, about?: string) => {
      const found = factsNamed(facts, name).filter(item => about === undefined ? item.about === undefined : item.about?.id === about);
      assert.equal(found.length, 1, `exactly one ${name}${about ? ` about ${about}` : ""}, not ${found.length}`);
      return found[0];
    };

    // Ask as a person: a scripted model over the fake transport.
    const ask = (question: string, fetch: typeof globalThis.fetch, memberId: string | null) =>
      runAgent({ db, householdId: hid, question, askId: randomUUID(), appUrl: APP, connection: () => aiConnection(db, hid, "text"), fetch, memberId });
    const oneTool = (name: string, input: unknown, final: string) => transport([() => reply("tool_use", [toolUse("t", name, input)]), () => reply("end_turn", [text(final)])]);

    // What the engine itself says: the fresh found wins of a month, from the same reads the keep uses.
    const engineFound = async (month: string) => {
      const state = await stateOf(), current = state.today.slice(0, 7);
      const range = { from: monthBounds(monthsBack(current, HISTORY_MONTHS)).first, to: monthBounds(current).last };
      return foundWins(spendingItems(await loadSpending(db, hid, range), range.from, range.to), "JPY", month, await record(), state.today);
    };
    const suggestionRows = (kind: string) => db.select().from(schema.suggestions).where(and(eq(schema.suggestions.householdId, hid), eq(schema.suggestions.kind, kind as never))).orderBy(asc(schema.suggestions.key));
    const openOf = async (kind: string) => (await suggestionRows(kind)).filter(row => row.status === "open");
    const charge = async (merchant: string, amount: string, date: string, category: "food" | "travel") => {
      const id = randomUUID();
      await insertCharge(db, hid, chargeInput.parse({ id, cardId: await card(), merchant, amount, date, category }), "confirmed", "manual", OWN);
      return id;
    };
    const invoiceId = async (number: string) => (await db.select().from(schema.invoices).where(and(eq(schema.invoices.householdId, hid), eq(schema.invoices.number, number))))[0].id;

    let acmeInvoice = "", fillMinor = 0, osakaChoice = "", winsTotalBefore = 0, medalsBefore: (string | null)[] = [];

    // ============================================================ 1. a client payment fills the pots
    await check("1. markPaidOutside fills Hakone and Tax, each linked to the invoice: set aside for goals and ready for tax equal the fills, only Tax has a tax ahead, every pot sums", async () => {
      acmeInvoice = await invoiceId("1042");
      const before = await bank();
      assert.equal(await markPaidOutside(db, hid, acmeInvoice, DEMO_DATE), true);
      const credit = (await bank()) - before;
      assert.equal(credit, 180_000, "$1,200 at ¥150");
      fillMinor = Math.round(credit * 10 / 100);
      assert.equal(fillMinor, 18_000);

      const fills = (await loadPotMoves(db, hid)).filter(move => move.kind === "fill");
      assert.deepEqual(fills.map(move => [move.potId, move.minor, move.invoiceId, move.on]).sort(), [[potIds.hakone, fillMinor, acmeInvoice, DEMO_DATE], [potIds.tax, fillMinor, acmeInvoice, DEMO_DATE]].sort());
      assert.equal(fills.filter(move => move.potId === potIds.rainy).length, 0, "a pot with no rule is not filled");
      const state = await stateOf();
      assert.deepEqual(state.pots.map(pot => [pot.name, toMinor(pot.saved, "JPY")]), [["Hakone weekend", 40_000 + fillMinor], ["Tax for March", fillMinor], ["Rainy day", 2_000]]);

      const aside = setAside((await record()).moves, DEMO_DATE.slice(0, 7));
      assert.deepEqual([aside.forGoalsMinor, aside.forTaxMinor, aside.totalMinor], [fillMinor, fillMinor, 2 * fillMinor], "the start of a pot is not set aside");
      const flow = await show("money_flow", { month: DEMO_DATE.slice(0, 7) });
      assert.equal(only(flow.facts, "set_aside_for_goals", potIds.hakone).value, fillMinor);
      assert.equal(only(flow.facts, "ready_for_tax", potIds.tax).value, fillMinor);
      assert.equal(factsNamed(flow.facts, "set_aside_for_goals").length, 1);
      assert.equal(factsNamed(flow.facts, "ready_for_tax").length, 1);
      assert.equal(only(flow.facts, "money_set_aside").value, aside.totalMinor);

      assert.ok(taxAhead(state, potIds.tax, 90), "the tax pot has a tax ahead");
      assert.equal(taxAhead(state, potIds.hakone, 90), null, "Hakone has none");
      assert.equal(taxAhead(state, potIds.rainy, 90), null, "Rainy day has none");
      assert.equal(await sums(), 3);
    });

    // ============================================================ 2. a saving is found and kept
    let foundKey = "";
    await check("2. Food ¥50,000 / ¥48,000 / ¥52,000, then ¥42,000: one ¥8,000 found saving asks 'Put it in a pot?'; keep it into Rainy day; a second pass adds nothing; a month later a new win names Rainy day", async () => {
      // A different shop each month, so none is a regular cost; the seed's own food items are regular costs and the groups leave them out.
      for (const [merchant, amount, date] of [["Harbor Grocer", "FOOD_JUL", "2026-07-10"], ["Pine Market", "FOOD_AUG", "2026-08-10"], ["Lotus Deli", "FOOD_SEP", "2026-09-10"], ["Maple Grocer", "FOOD_OCT", "2026-10-10"]] as const) {
        await charge(merchant, FOOD[amount], date, "food");
      }
      const wins = await engineFound("2026-10");
      const food = wins.find(win => win.key === "2026-10:cat:food")!;
      assert.deepEqual([food.winMinor, food.baselineMinor, food.monthMinor, food.kind], [8_000, 50_000, 42_000, "under_usual"], "the plan's numbers, from the engine");

      await runPass(db, hid);
      const [found] = await openOf("found_saving");
      assert.equal((await openOf("found_saving")).length, 1);
      assert.deepEqual([found.key, found.refId, found.action], ["found:2026-10", "2026-10:cat:food", "keep_win"]);
      assert.match(found.title, /came in ¥8,000 under your usual/);
      assert.match(found.reason, /Put it in a pot\?$/, "two open saving pots, so no pot is named");
      assert.equal(only(found.facts, "found_win", food.key).value, food.winMinor);
      foundKey = food.key;
      await sums();

      // Keep into Rainy day: the found choice and the add that names it.
      const choiceId = await keepFoundWin(db, hid, { foundKey, potId: potIds.rainy }, OWN);
      const rec = await record();
      const kept = rec.choices.filter(choice => choice.id === choiceId);
      assert.deepEqual(kept.map(choice => [choice.source, choice.foundKey, choice.minor, choice.happenedOn, choice.confirmedOn]), [["found", foundKey, 8_000, "2026-10-31", DEMO_DATE]]);
      assert.deepEqual(rec.moves.filter(move => move.choiceId === choiceId).map(move => [move.potId, move.kind, move.minor]), [[potIds.rainy, "add", 8_000]]);
      assert.equal(toMinor((await stateOf()).pots.find(pot => pot.id === potIds.rainy)!.saved, "JPY"), 10_000);
      await assert.rejects(keepFoundWin(db, hid, { foundKey, potId: null }, OWN), /already kept/);

      // A second pass adds nothing: the found row closes and no other row appears.
      const rows = async () => (await db.select().from(schema.suggestions).where(eq(schema.suggestions.householdId, hid))).map(row => [row.key, row.status]).sort();
      const events = async () => (await db.select().from(schema.events).where(and(eq(schema.events.householdId, hid), eq(schema.events.kind, "suggestion_made")))).length;
      const [rowsBefore, eventsBefore] = [await rows(), await events()];
      assert.equal((await openOf("found_saving")).length, 0, "the kept one is not offered again");
      await runPass(db, hid);
      assert.deepEqual(await rows(), rowsBefore, "a second pass changes no row");
      assert.equal(await events(), eventsBefore, "and makes no notification");
      await sums();

      // A month later: November has closed, and the new win names the pot the last one went into.
      await setToday("2026-12-03");
      for (const [merchant, amount, date] of [["Cedar Grocer", "FOOD_NOV", "2026-11-20"]] as const) await charge(merchant, FOOD[amount], date, "food");
      const november = (await engineFound("2026-11")).find(win => win.key === "2026-11:cat:food")!;
      assert.deepEqual([november.winMinor, november.baselineMinor, november.monthMinor], [12_000, 48_000, 36_000]);
      await runPass(db, hid);
      const [next] = await openOf("found_saving");
      assert.equal((await openOf("found_saving")).length, 1);
      assert.equal(next.key, "found:2026-11");
      assert.equal(only(next.facts, "pot", potIds.rainy).about!.name, "Rainy day");
      assert.match(next.reason, /Put ¥12,000 in Rainy day\?/);
      assert.equal(factsNamed(next.facts, "pot").length, 1);
      await sums();
    });

    // ============================================================ 3. a choice is said in Ask, confirmed, and counts
    await check("3. Ask: 'economy to Osaka instead of business, about ¥150,000 less' is a pending choice and ¥164,000 is refused; Confirm and wins returns it as an engine fact; a later Ask quoting it passes; Bronze and Silver are earned and the pass shows Silver", async () => {
      const said = "I took economy to Osaka instead of business, about ¥150,000 less";
      const win = { what: "Economy to Osaka instead of business", amount: "150000", instead: null, paid: null, on: null, category: "travel", who: null };
      const drafted = await ask(said, oneTool("add_win", win, "It is in To check.").fetch, rin);
      assert.equal(drafted.pending, true);
      const [pending] = await db.select().from(schema.choices).where(and(eq(schema.choices.householdId, hid), eq(schema.choices.status, "pending")));
      assert.deepEqual([pending.aboutMinor, pending.source, pending.memberId, pending.madeBy, pending.category, pending.happenedOn], [150_000, "said", rin, "ask", "travel", "2026-12-03"]);
      osakaChoice = pending.id;

      // An invented amount is refused: a draft whose answer says ¥164,000, which nobody typed and no tool returned, is not shown.
      const invented = oneTool("add_win", { ...win, what: "Another Osaka choice" }, "That is about ¥164,000 less.");
      await assert.rejects(ask(said, invented.fetch, rin),
        (error: unknown) => error instanceof AgentError && error.outcome === "unconfirmed_amount");
      const strays = (await db.select().from(schema.choices).where(and(eq(schema.choices.householdId, hid), eq(schema.choices.status, "pending")))).filter(row => row.id !== osakaChoice);
      assert.equal(strays.length, 1, "the refused draft's own row waits in To check, never confirmed");
      assert.equal(await removePendingChoice(db, hid, strays[0].id), true);
      assert.equal((await db.select().from(schema.choices).where(eq(schema.choices.householdId, hid))).length, 2, "the found choice and Osaka");

      // While pending it is not an engine fact: wins has no ¥150,000, and a model quoting it later is not shown.
      assert.deepEqual((await show("wins", null)).facts.filter(item => item.value === 150_000), []);
      const quote = () => transport([() => reply("tool_use", [toolUse("w", "show", { view: "wins", args: null })]), () => reply("end_turn", [text("About ¥150,000 of it was your Osaka choice.")])]);
      const early = await ask("What did my choices save?", quote().fetch, ben);
      assert.equal(early.wording, "code", "the model's words are replaced by the reading");
      assert.doesNotMatch(early.answer, /150,000/);
      assert.equal((await openOf("medal")).length, 0, "nothing pending earns a medal");

      assert.equal(await confirmPending(db, hid, "choice", osakaChoice), true);
      const wins = await show("wins", null);
      const osaka = only(wins.facts, "said_win", osakaChoice);
      assert.deepEqual([osaka.value, osaka.about!.name], [150_000, "Economy to Osaka instead of business"]);
      const answer = await ask("What did my choices save?", quote().fetch, ben);
      assert.deepEqual([answer.wording, /¥150,000/.test(answer.answer)], ["model", true], "a later Ask quoting the confirmed number passes the check");

      const rec = await record(), state = await stateOf();
      assert.equal(rec.choices.find(choice => choice.id === osakaChoice)!.memberId, rin, "the choice names who said it");
      const choiceMedals = medals(rec, state.pots).filter(medal => medal.kind === "choices");
      assert.deepEqual(choiceMedals.map(medal => [medal.name, medal.earnedOn]), [["Bronze", "2026-12-03"], ["Silver", "2026-12-03"], ["Gold", null], ["Platinum", null]], "8,000 + 150,000 crosses 10,000 and 100,000 the same day");
      const shown = await openOf("medal");
      assert.deepEqual(shown.map(row => [row.key, row.title, row.reason]), [["medal:choices:1", "New medal: Silver for what your choices saved", "¥100,000; earned Dec 3."]], "one medal shown, the newest level of the day");
      assert.ok(!JSON.stringify(wins.facts).includes("per_person"), "no total per person");
      await sums();
    });

    // ============================================================ 4. a purchase may have come from a pot
    let hotel = "", safeBefore = 0;
    await check("4. A travel charge of ¥48,600: pot_match asks Hakone once, never Tax; paid from Hakone and done, safe to spend rises by exactly ¥48,600 and goals reached is 1; a dismissed second match never returns", async () => {
      hotel = await charge("Hakone Ryokan Mizuki", "48600", "2026-12-03", "travel");
      await runPass(db, hid);
      await runPass(db, hid);
      const [match] = await openOf("pot_match");
      assert.equal((await openOf("pot_match")).length, 1, "asked once");
      assert.deepEqual([match.key, match.refId, match.title], [`match:charge:${hotel}`, `charge:${hotel}`, "From your Hakone weekend?"]);
      assert.deepEqual(factsNamed(match.facts, "pot").map(item => item.about!.id), [potIds.hakone], "never the tax pot");
      assert.equal(only(match.facts, "charge_amount", hotel).value, 48_600);

      // A second purchase of the same category is its own question; dismissing it is final.
      const ropeway = await charge("Hakone Ropeway", "12000", "2026-12-03", "travel");
      await runPass(db, hid);
      assert.deepEqual((await openOf("pot_match")).map(row => row.key), [`match:charge:${hotel}`, `match:charge:${ropeway}`].sort());
      const second = (await openOf("pot_match")).find(row => row.key === `match:charge:${ropeway}`)!;
      assert.equal(await dismiss(db, hid, second.id), true);
      await runPass(db, hid);
      await runPass(db, hid);
      assert.deepEqual((await openOf("pot_match")).map(row => row.key), [`match:charge:${hotel}`], "a dismissed match does not come back");
      assert.equal((await suggestionRows("pot_match")).find(row => row.key === second.key)!.status, "dismissed");
      assert.equal((await openSuggestions(db, hid)).filter(row => row.kind === "pot_match").length, 1);

      // Pay the hotel from Hakone and mark the pot done in the same move.
      const state = await stateOf();
      safeBefore = toMinor(safeToSpend(state).amount, "JPY");
      await movePot(db, hid, { id: randomUUID(), potId: potIds.hakone, kind: "spend", amountMinor: null, toPotId: null, purchase: { kind: "charge", id: hotel, on: null }, choiceId: null, reason: null, memberId: ben, done: true }, "confirmed", OWN);
      const after = await stateOf();
      assert.equal(toMinor(safeToSpend(after).amount, "JPY") - safeBefore, 48_600, "the money in the pot is spendable again by exactly what the pot paid");
      const hakone = after.pots.find(pot => pot.id === potIds.hakone)!;
      assert.deepEqual([hakone.doneOn, hakone.became, toMinor(hakone.saved, "JPY")], ["2026-12-03", 48_600, 58_000 - 48_600]);
      assert.equal((await openOf("pot_match")).length, 0, "the match closes once the purchase came from the pot");
      assert.equal(only((await show("wins", null)).facts, "goals_reached").value, 1);
      assert.equal(milestones(await record(), after.pots).goalDays.length, 1);
      assert.equal(medals(await record(), after.pots).find(medal => medal.kind === "goals" && medal.level === 0)!.earnedOn, "2026-12-03");
      assert.equal(await markPotDone(db, hid, potIds.hakone), false, "done is set once");
      await sums();
    });

    // ============================================================ 5. money moves between pots, with its story
    await check("5. Carry ¥10,000 from Rainy day to a new Laptop pot: Laptop's story shows the carry and its choices", async () => {
      await savePot(db, hid, { id: potIds.laptop, name: "Laptop", target: "200000", targetDate: "2027-03-31", saved: "0", fillPct: null, memberId: null, category: null }, "confirmed", OWN);
      const move = { pot: "Rainy day", kind: "move_to", to_pot: "Laptop", amount: "10000", purchase: null, purchase_on: null, words: null, who: null };
      const drafted = await ask("Move ¥10,000 from Rainy day to Laptop", oneTool("pot_move", move, "It is in To check.").fetch, ben);
      assert.equal(drafted.pending, true);
      const pending = await db.select().from(schema.potMoves).where(and(eq(schema.potMoves.householdId, hid), eq(schema.potMoves.status, "pending")));
      assert.deepEqual(pending.map(row => [row.potId, row.kind, row.amountMinor]).sort(), [[potIds.laptop, "carry", 10_000], [potIds.rainy, "carry", -10_000]].sort());
      assert.equal((await stateOf()).pots.find(pot => pot.id === potIds.laptop)!.saved, 0, "a pending move changes nothing");
      await sums();
      assert.equal(await confirmPending(db, hid, "move", pending.find(row => row.amountMinor < 0)!.id), true);
      const state = await stateOf(), rec = await record();
      assert.deepEqual(state.pots.filter(pot => pot.id === potIds.rainy || pot.id === potIds.laptop).map(pot => [pot.name, toMinor(pot.saved, "JPY")]), [["Rainy day", 0], ["Laptop", 10_000]]);

      const story = potStory(rec, state.pots.find(pot => pot.id === potIds.laptop)!, "JPY");
      assert.deepEqual([story.carriedInMinor, story.wentInMinor, story.savedMinor], [10_000, 10_000, 10_000]);
      assert.deepEqual(story.carriedFrom, [{ potId: potIds.rainy, potName: "Rainy day", minor: 10_000 }]);
      const view = await show("pot_story", { pot: "Laptop" });
      assert.equal(only(view.facts, "pot_carried_in", potIds.laptop).value, 10_000);
      assert.equal(only(view.facts, "pot_carried_in", potIds.rainy).value, 10_000);
      assert.equal(only(view.facts, "win_count", potIds.laptop).value, 1, "Rainy day ended empty, so its kept saving comes along");
      assert.equal(only(view.facts, "pot", potIds.laptop).value, 10_000);
      assert.match(view.sentence ?? "", /¥10,000 went in .*moved in from Rainy day/);
      await sums();
    });

    // ============================================================ 6. every picture reads the engine's sums
    await check("6. show money_flow, wins, pot_story and goal_pace: every fact equals the engine's sum", async () => {
      const state = await stateOf(), rec = await record();
      const month = (name: string) => ({ from: `${name}-01`, to: monthBounds(name).last });
      const period = (fact: Fact) => JSON.stringify(fact.period);

      // Where each payment went, November and December.
      for (const name of ["2026-11", "2026-12"]) {
        const flow = await show("money_flow", { month: name });
        const aside = setAside(rec.moves, name);
        assert.equal(only(flow.facts, "money_set_aside").value, aside.totalMinor, name);
        assert.deepEqual(factsNamed(flow.facts, "set_aside_for_goals").map(item => [item.about!.id, item.value]).sort(), aside.byPot.filter(row => !row.tax).map(row => [row.potId, row.minor]).sort(), name);
        assert.deepEqual(factsNamed(flow.facts, "ready_for_tax").map(item => [item.about!.id, item.value]), aside.byPot.filter(row => row.tax).map(row => [row.potId, row.minor]), name);
        assert.deepEqual(factsNamed(flow.facts, "from_pot").filter(item => item.about).map(item => [item.about!.id, item.value]).sort(), aside.fromPots.map(row => [row.potId, row.minor]).sort(), name);
      }
      assert.deepEqual(setAside(rec.moves, "2026-12").fromPots.map(row => [row.potId, row.minor]), [[potIds.hakone, 48_600]], "the hotel came out of Hakone");

      // What our choices saved: each month's engine sum, then the span.
      const wins = await show("wins", null);
      let spanTotal = 0;
      for (const name of ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"].filter(m => m >= monthsBack("2026-12", 6))) {
        const found = name < "2026-12" ? await engineFound(name) : [];
        const engine = monthWins(rec, found, name);
        spanTotal += engine.totalMinor;
        if (engine.count === 0) continue;
        const sumFact = wins.facts.find(item => item.name === "choices_saved" && item.about === undefined && period(item) === JSON.stringify(month(name)));
        assert.equal(sumFact?.value, engine.totalMinor, `${name}: what choices saved`);
        assert.equal(wins.facts.find(item => item.name === "found_win" && item.about === undefined && period(item) === JSON.stringify(month(name)))?.value, engine.foundMinor, `${name}: found`);
        assert.equal(wins.facts.find(item => item.name === "said_win" && item.about === undefined && period(item) === JSON.stringify(month(name)))?.value, engine.saidMinor, `${name}: said`);
      }
      const novemberFresh = (await engineFound("2026-11")).reduce((total, win) => total + win.winMinor, 0);
      assert.ok(novemberFresh >= 12_000, "November's food is among its fresh wins");
      assert.equal(spanTotal, 8_000 + novemberFresh + 150_000 + (await engineFound("2026-10")).filter(win => win.key !== foundKey).reduce((total, win) => total + win.winMinor, 0),
        "October's kept saving (and any other October win not kept), November's fresh wins and December's said choice");
      winsTotalBefore = Number(wins.facts.filter(item => item.name === "choices_saved" && item.about === undefined).at(-1)!.value);
      assert.equal(winsTotalBefore, spanTotal, "the span's total is the months' sum");
      const earned = medals(rec, state.pots);
      for (const medal of earned.filter(row => row.earnedOn !== null)) {
        const fact = wins.facts.find(item => item.name === "medal_earned_on" && item.about?.id === `${medal.kind}:${medal.level}`);
        assert.equal(fact?.value, medal.earnedOn, `${medal.name} ${medal.kind}`);
      }
      medalsBefore = earned.map(medal => medal.earnedOn);
      const { goalDays, monthDays } = milestones(rec, state.pots);
      assert.equal(only(wins.facts, "goals_reached").value, goalDays.length);
      assert.equal(only(wins.facts, "months_set_aside").value, monthDays.length);

      // A pot's story.
      for (const pot of state.pots) {
        const story = potStory(rec, pot, "JPY"), view = await show("pot_story", { pot: pot.name });
        assert.equal(only(view.facts, "went_in", pot.id).value, story.wentInMinor, pot.name);
        assert.equal(only(view.facts, "pot", pot.id).value, story.savedMinor, pot.name);
        assert.equal(factsNamed(view.facts, "pot_became").reduce((total, item) => total + Number(item.value), 0), story.becameMinor, pot.name);
        if (story.fromPaymentsMinor > 0) assert.equal(only(view.facts, "pot_from_payments", pot.id).value, story.fromPaymentsMinor, pot.name);
        if (story.fromChoicesMinor > 0) assert.equal(only(view.facts, "pot_from_choices", pot.id).value, story.fromChoicesMinor, pot.name);
        assert.ok(!(story.tax && /saved/i.test(view.sentence ?? "")), "the tax pot is never called saved");
      }

      // A goal's pace: Laptop has one, done Hakone has none.
      const laptop = state.pots.find(pot => pot.id === potIds.laptop)!, pace = goalPace(laptop, state)!;
      const pacing = await show("goal_pace", { pot: "Laptop" });
      assert.deepEqual([only(pacing.facts, "pot", laptop.id).value, only(pacing.facts, "goal_target", laptop.id).value, only(pacing.facts, "goal_expected_by_today", laptop.id).value, only(pacing.facts, "goal_pace", laptop.id).value],
        [pace.savedMinor, pace.targetMinor, pace.expectedMinor, pace.deltaMinor]);
      assert.equal(only(pacing.facts, "goal_still_to_set_aside", laptop.id).value, pace.neededMinor);
      assert.equal(goalPace(state.pots.find(pot => pot.id === potIds.hakone)!, state), null);
      const done = await show("goal_pace", { pot: "Hakone weekend" });
      assert.equal(only(done.facts, "pot_done_on", potIds.hakone).value, "2026-12-03");
      assert.equal(only(done.facts, "pot", potIds.hakone).value, toMinor(state.pots.find(pot => pot.id === potIds.hakone)!.saved, "JPY"));
      assert.match(done.sentence ?? "", /^Bought on Dec 3\.$/);
      await sums();
    });

    // ============================================================ 7. withdrawing a choice
    await check("7. Withdraw Osaka: the medals' dates hold and what choices saved drops by ¥150,000", async () => {
      await setToday("2026-12-05");
      assert.equal(await withdrawChoice(db, hid, osakaChoice), true);
      assert.equal(await withdrawChoice(db, hid, osakaChoice), false, "a second withdrawal is nothing");
      const rec = await record(), state = await stateOf();
      const withdrawn = rec.choices.find(choice => choice.id === osakaChoice)!;
      assert.deepEqual([withdrawn.minor, withdrawn.confirmedOn, withdrawn.withdrawnOn], [150_000, "2026-12-03", "2026-12-05"], "the row stays on the record");
      assert.deepEqual(medals(rec, state.pots).map(medal => medal.earnedOn), medalsBefore, "every medal keeps the day it was earned");
      const wins = await show("wins", null);
      assert.ok(!wins.facts.some(item => item.about?.id === osakaChoice), "no fact about the withdrawn choice");
      assert.equal(Number(wins.facts.filter(item => item.name === "choices_saved" && item.about === undefined).at(-1)!.value), winsTotalBefore - 150_000);
      assert.equal(only(wins.facts, "medal_earned_on", "choices:1").value, "2026-12-03");
      await sums();
    });

    // ============================================================ 8. a fresh Try it stays quiet
    await check("8. A fresh Try it with the rule on: after a pass, no moves, no choices and none of the three kinds", async () => {
      const fresh = await seedBen(db, { isDemo: true });
      assert.equal((await rulesFor(db, fresh)).saving_wins.enabled, true);
      await runPass(db, fresh);
      assert.deepEqual(await db.select().from(schema.potMoves).where(eq(schema.potMoves.householdId, fresh)), []);
      assert.deepEqual(await db.select().from(schema.choices).where(eq(schema.choices.householdId, fresh)), []);
      assert.deepEqual(await db.select().from(schema.pots).where(eq(schema.pots.householdId, fresh)), []);
      const kinds = (await db.select().from(schema.suggestions).where(eq(schema.suggestions.householdId, fresh))).map(row => row.kind);
      for (const kind of ["found_saving", "pot_match", "medal"]) assert.ok(!kinds.includes(kind as never), `no ${kind}`);
      // And the household of the cycle is untouched by it.
      assert.equal(await sums(), 4);
    });

    console.log(`Saving cycle checks passed (${tally.passed}).`);
  } finally {
    restoreEnv();
    await pg.close();
  }
}

// The plan's food months. The seed's own food items are regular costs (the same shops every month), which the groups leave out.
const FOOD = { FOOD_JUL: "50000", FOOD_AUG: "48000", FOOD_SEP: "52000", FOOD_OCT: "42000", FOOD_NOV: "36000" } as const;

main().catch(error => { console.error("Saving cycle checks failed", error instanceof Error ? error.stack?.split("\n").slice(0, 10).join("\n") : error); process.exitCode = 1; });
