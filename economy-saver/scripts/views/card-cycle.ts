// The card cycle view and the tracks form (D77), on Ben's sample: Card A and Card B.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { unconfirmedAmounts } from "@/lib/ai/number-check";
import { roomOnCard } from "@/lib/money/runway";
import { benMoney } from "@/lib/sample/ben";
import { ViewFigure } from "@/components/views/ViewFigure";
import { resolveView } from "@/lib/views/resolve";
import { ViewError, type ViewResult } from "@/lib/views/types";

let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`✓ ${name}`); }
const ctx = { state: benMoney };
const card = (cardId: string, amountMinor?: number) => resolveView("card_cycle", { cardId, ...(amountMinor === undefined ? {} : { amountMinor }) }, ctx) as ViewResult<"tracks">;
const track = (result: ViewResult<"tracks">, key: string) => result.data!.tracks.find(t => t.key === key)!;

check("Card A closes Nov 30, its ¥58,000 statement due Nov 26 is covered from cash and the next is due Dec 26", () => {
  const a = card("card-a");
  assert.equal(a.figures.closesOn, "2026-11-30");
  assert.equal(a.figures.dueOn, "2026-12-26");
  assert.equal(a.figures.closedMinor, 58000);
  assert.equal(a.figures.paybackMinor, 58000);
  assert.equal(a.figures.paidFrom, "bank");
  const pay = track(a, "pay").events;
  assert.deepEqual(pay.map(e => [e.date, e.amountLabel]), [["2026-11-26", "¥58,000"], ["2026-12-26", `¥${(a.figures.openMinor as number).toLocaleString("en-US")}`]]);
  assert.deepEqual(track(a, "cover").events.map(e => [e.date, e.label]), [["2026-11-26", "Cash on hand"]]);
  assert.match(a.line!, /covered by cash on hand/);
  assert.deepEqual(a.data!.tracks.map(t => t.key), ["cycle", "pay", "cover"]);
});

check("an amount lands on the statement due Dec 26 and is drawn as the purchase with an arrow", () => {
  const a = card("card-a", 40000);
  assert.equal(a.figures.landsOn, "2026-12-26");
  assert.deepEqual(a.data!.arrows.map(x => [x.from, x.to]), [["2026-11-14", "2026-12-26"]]);
  const purchase = track(a, "purchase").events;
  assert.deepEqual(purchase.map(e => [e.date, e.kind, e.tone]), [["2026-11-14", "dot", "main"]]);
  assert.match(a.line!, /lands on the statement that closes Nov 30 and is paid Dec 26/);
  assert.equal(a.figures.fitsRoom, (40000 <= (a.figures.roomMinor as number)) ? "yes" : "no");
});

check("the amount the agent passes is in neither the line nor the figures, so the reply's amount must come from the question", () => {
  const a = card("card-a", 40000);
  assert.ok(!JSON.stringify(a.figures).includes("40000"));
  assert.ok(!a.line!.includes("40,000"));
  assert.deepEqual(unconfirmedAmounts("¥40,000", ["If I put ¥40,000 on Card A today", JSON.stringify(a.figures)]), []);
  assert.equal(unconfirmedAmounts("¥40,000", [JSON.stringify(a.figures), a.line ?? ""]).length, 1);
});

check("Card B closes Nov 15, today's cycle, and its ¥61,000 is due Dec 10", () => {
  const b = card("card-b");
  assert.equal(b.figures.closesOn, "2026-11-15");
  assert.equal(b.figures.dueOn, "2026-12-10");
  assert.equal(b.figures.openMinor, 61000);
  assert.equal(b.figures.closedMinor, null);
  assert.equal(b.figures.paybackMinor, 61000);
  assert.deepEqual(track(b, "pay").events.map(e => [e.date, e.amountLabel]), [["2026-12-10", "¥61,000"]]);
});

check("the room equals roomOnCard and a purchase beyond it does not fit", () => {
  for (const id of ["card-a", "card-b"]) {
    const result = card(id), room = Math.round(roomOnCard(benMoney, id).room);
    assert.equal(result.figures.roomMinor, room);
    const big = card(id, room + 1);
    assert.equal(big.figures.fitsRoom, "no");
    assert.match(big.line!, /does not fit/);
    if (room > 0) assert.equal(card(id, room).figures.fitsRoom, "yes");
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
