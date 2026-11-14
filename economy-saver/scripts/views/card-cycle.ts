// The card cycle view and the tracks form (D77), on Ben's sample: Card A and Card B.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { unconfirmedNumbers } from "@/lib/ai/number-check";
import { fact, type Fact } from "@/lib/money/facts";
import { TERMS } from "@/lib/money/terms";
import { roomOnCard } from "@/lib/money/runway";
import { benMoney } from "@/lib/sample/ben";
import { ViewFigure } from "@/components/views/ViewFigure";
import { resolveView } from "@/lib/views/resolve";
import { ViewError, type ViewResult } from "@/lib/views/types";

let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`✓ ${name}`); }
const ctx = { state: benMoney };
/** The facts as the number check reads them: a one-day period becomes its date. */
const checkable = (facts: readonly Fact[]) => facts.map(item => ({ ...item, period: item.period && "on" in item.period ? item.period.on : item.period }));
const card = (cardId: string, amountMinor?: number) => resolveView("card_cycle", { cardId, ...(amountMinor === undefined ? {} : { amountMinor }) }, ctx) as ViewResult<"tracks">;
const track = (result: ViewResult<"tracks">, key: string) => result.data!.tracks.find(t => t.key === key)!;

check("Card A closes Nov 30, its ¥58,000 statement due Nov 26 is covered from cash and the next is due Dec 26", () => {
  const a = card("card-a");
  assert.equal(fact(a.facts, "closes_on")!.value, "2026-11-30");
  assert.equal(fact(a.facts, "due")!.value, "2026-12-26");
  assert.equal(fact(a.facts, "statement_closed")!.value, 58000);
  assert.equal(fact(a.facts, "closed_statement_due")!.value, "2026-11-26");
  const pay = track(a, "pay").events;
  assert.deepEqual(pay.map(e => [e.date, e.amountLabel]), [["2026-11-26", "¥58,000"], ["2026-12-26", `¥${(fact(a.facts, "statement_open")!.value as number).toLocaleString("en-US")}`]]);
  assert.deepEqual(track(a, "cover").events.map(e => [e.date, e.label]), [["2026-11-26", "Cash on hand"]]);
  assert.match(a.line!, /covered by cash on hand/);
  assert.deepEqual(a.data!.tracks.map(t => t.key), ["cycle", "pay", "cover"]);
});

check("an amount lands on the statement due Dec 26 and is drawn as the purchase with an arrow", () => {
  const a = card("card-a", 40000);
  assert.equal(fact(a.facts, "due")!.value, "2026-12-26");
  assert.deepEqual(a.data!.arrows.map(x => [x.from, x.to]), [["2026-11-14", "2026-12-26"]]);
  const purchase = track(a, "purchase").events;
  assert.deepEqual(purchase.map(e => [e.date, e.kind, e.tone]), [["2026-11-14", "dot", "main"]]);
  assert.match(a.line!, /lands on the statement that closes Nov 30 and is paid Dec 26/);
  assert.equal(/It fits:/.test(a.line!), 40000 <= (fact(a.facts, "card_room", "late")!.value as number));
});

check("the amount tested is a person fact, and the room after it is the engine's: ¥173,770 before and ¥133,770 after ¥40,000 on Card A", () => {
  const a = card("card-a", 40000), facts = a.facts!;
  const tested = fact(facts, "amount_tested")!;
  assert.deepEqual([tested.value, tested.by, tested.currency], [40000, "person", "JPY"]);
  const before = Math.round(roomOnCard(benMoney, "card-a").room), after = Math.round(roomOnCard(benMoney, "card-a", 40000).room);
  assert.equal(fact(facts, "card_room", "late")!.value, before);
  assert.equal(before, 173_770);
  assert.equal(fact(facts, "card_room_after", "late")!.value, after);
  assert.equal(after, 133_770);
  assert.ok(after === before - 40000 || after === Math.round(card("card-a").facts!.find(item => item.name === "limit_left")!.value as number) - 40000, "room less the purchase, or the limit-capped value");
  assert.ok(fact(card("card-a").facts!, "card_room_after") === null, "no amount, no room after");
  assert.equal(unconfirmedNumbers("¥40,000", checkable(facts), { today: benMoney.today }).length, 0, "the person's amount may be quoted back as theirs");
  assert.equal(unconfirmedNumbers("¥41,000", checkable(facts), { today: benMoney.today }).length, 1, "a number near it confirms nothing");
  assert.deepEqual(a.facts.filter(item => item.value === 40000).map(item => item.name), ["amount_tested"], "the amount is repeated as no other fact");
});

check("every card's line is built from its facts, on both cards, with and without an amount, and every fact name is a term", () => {
  for (const id of ["card-a", "card-b"]) for (const amount of [undefined, 40000, 900000]) {
    const view = card(id, amount);
    assert.deepEqual(unconfirmedNumbers(view.line!, checkable(view.facts!), { today: benMoney.today }), [], `${id} ${amount}`);
    assert.ok(view.facts!.every(item => TERMS.some(term => term.name === item.name) && item.from === "card_cycle"));
  }
  const a = card("card-a").facts!;
  assert.deepEqual([fact(a, "closes_on")!.value, fact(a, "due")!.value, fact(a, "statement_closed")!.value, fact(a, "closed_statement_due")!.value], ["2026-11-30", "2026-12-26", 58000, "2026-11-26"]);
});

check("Card B closes Nov 15, today's cycle, and its ¥61,000 is due Dec 10", () => {
  const b = card("card-b");
  assert.equal(fact(b.facts, "closes_on")!.value, "2026-11-15");
  assert.equal(fact(b.facts, "due")!.value, "2026-12-10");
  assert.equal(fact(b.facts, "statement_open")!.value, 61000);
  assert.equal(fact(b.facts, "statement_closed"), null);
  assert.deepEqual(track(b, "pay").events.map(e => [e.date, e.amountLabel]), [["2026-12-10", "¥61,000"]]);
});

check("the room equals roomOnCard and a purchase beyond it does not fit", () => {
  for (const id of ["card-a", "card-b"]) {
    const result = card(id), room = Math.round(roomOnCard(benMoney, id).room);
    assert.equal(fact(result.facts, "card_room", "late")!.value, room);
    const big = card(id, room + 1);
    assert.doesNotMatch(big.line!, /It fits:/);
    assert.match(big.line!, /does not fit/);
    if (room > 0) assert.match(card(id, room).line!, /It fits:/);
  }
});

check("an unknown card is refused in words, and an extra key is refused", () => {
  assert.throws(() => resolveView("card_cycle", { cardId: "card-nope" }, ctx), (error: unknown) => error instanceof ViewError && /couldn't find that card/.test(error.message));
  assert.throws(() => resolveView("card_cycle", { cardId: "card-a", days: 3 }, ctx), /does not take "days"/);
});

check("the table twin lists the days in order and the figure draws every label", () => {
  const a = card("card-a", 40000);
  const days = a.table!.rows.map(row => row.cells[0]);
  assert.equal(days[0], "Nov 14");
  assert.ok(a.table!.rows.some(row => row.cells[1] === "This purchase"));
  const html = renderToStaticMarkup(createElement(ViewFigure, { result: a }));
  for (const word of ["This cycle", "You pay", "Covered by", "This purchase, today", "Closes", "Building", "Dec 26", "Nov 26", "Today"]) assert.ok(html.includes(word), word);
});
console.log(`card cycle: ${passed} checks passed`);
