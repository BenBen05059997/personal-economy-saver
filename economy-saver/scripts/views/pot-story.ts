// A pot's story (D81, D77): where the money came from and what it became, the tax pot's words, carried choices and the empty page. Pure; fictional data only.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Sankey } from "@/components/views/forms/Sankey";
import { fact } from "@/lib/money/facts";
import { potStory } from "@/lib/money/saving";
import type { Choice, MoneyState, MoveKind, Pot, PotMove } from "@/lib/money/types";
import { benMoney } from "@/lib/sample/ben";
import { resolveView } from "@/lib/views/resolve";
import { ViewError, type ViewContext, type ViewResult } from "@/lib/views/types";
import { reads } from "../fixtures/view-reads";
import { createSyncChecks } from "../fixtures/harness";

const { check, tally } = createSyncChecks();
let seq = 0;
const move = (potId: string, kind: MoveKind, minor: number, on: string, over: Partial<PotMove> = {}): PotMove => ({
  id: `m${++seq}`, potId, potName: ({ cam: "Camera", tax: "Tax pot", trip: "Hakone trip" } as Record<string, string>)[potId] ?? potId, potCategory: potId === "tax" ? "government_tax" : null,
  kind, minor, on, memberId: null, reason: null, invoiceId: null, purchase: null, choiceId: null, pairId: null, ...over,
});
const choice = (id: string, minor: number, on: string, over: Partial<Choice> = {}): Choice =>
  ({ id, source: "said", happenedOn: on, minor, words: "Took the train", category: null, foundKey: null, memberId: null, confirmedOn: on, withdrawnOn: null, ...over });
const pot = (id: string, saved: number, over: Partial<Pot> = {}): Pot => ({ id, name: ({ cam: "Camera", tax: "Tax pot", trip: "Hakone trip" } as Record<string, string>)[id] ?? id, saved, ...over });
const ctxOf = (pots: Pot[], moves: PotMove[], choices: Choice[] = []): ViewContext => ({ state: { ...benMoney, pots } as MoneyState, moves, choices });
const draw = (potId: string, ctx: ViewContext) => resolveView("pot_story", { potId }, ctx) as ViewResult<"sankey">;
const today = benMoney.today;
const purchase = { kind: "charge" as const, id: "ch-x", on: null, label: "Mirrorless body" };

check("a pot's story: what went in, the purchase it became and what is still in it, in the plan's words", () => {
  const moves = [move("cam", "fill", 3000, "2026-10-05"), move("cam", "add", 2000, "2026-10-08"), move("cam", "add", 1000, "2026-10-09", { choiceId: "c1" }), move("cam", "spend", -4000, "2026-10-20", { purchase })];
  const view = draw("cam", ctxOf([pot("cam", 2000)], moves, [choice("c1", 1000, "2026-10-09")]));
  assert.equal(view.line, "Camera: ¥6,000 went in since Oct 5: ¥3,000 from client payments, ¥2,000 put in by hand and ¥1,000 from your choices. It became Mirrorless body ¥4,000; ¥2,000 is still in it.");
  reads(view, today);
  const story = potStory({ moves, choices: [choice("c1", 1000, "2026-10-09")] }, pot("cam", 2000), "JPY");
  assert.deepEqual([fact(view.facts, "went_in")!.value, fact(view.facts, "pot")!.value, fact(view.facts, "pot_from_payments")!.value, fact(view.facts, "pot_from_choices")!.value], [story.wentInMinor, story.savedMinor, story.fromPaymentsMinor, story.fromChoicesMinor]);
  const became = fact(view.facts, "pot_became")!;
  assert.deepEqual([became.value, became.about!.name], [4000, "Mirrorless body"]);
  assert.equal(fact(view.facts, "win_count")!.value, 1);
});

check("the picture balances at every node: ways in, the pot, what it became", () => {
  const moves = [move("cam", "adjust", 500, "2026-10-01"), move("cam", "fill", 3000, "2026-10-05"), move("cam", "take_out", -700, "2026-10-12"), move("cam", "spend", -2000, "2026-10-20", { purchase })];
  const view = draw("cam", ctxOf([pot("cam", 800)], moves));
  const { nodes, links } = view.data!;
  for (const node of nodes) {
    const into = links.filter(link => link.to === node.id).reduce((sum, link) => sum + link.minor, 0), out = links.filter(link => link.from === node.id).reduce((sum, link) => sum + link.minor, 0);
    if (node.column === 1) { assert.equal(into, node.minor); assert.equal(out, node.minor); } else if (node.column === 0) assert.equal(out, node.minor); else assert.equal(into, node.minor);
  }
  assert.deepEqual(nodes.filter(node => node.column === 0).map(node => node.label), ["Client payments", "Start"]);
  assert.deepEqual(nodes.filter(node => node.column === 2).map(node => [node.label, node.minor]), [["Mirrorless body", 2000], ["Taken out", 700], ["Still in it", 800]]);
  const html = renderToStaticMarkup(createElement(Sankey, { result: view }));
  assert.ok(html.includes("Camera") && html.includes("sk-in"));
  assert.equal(view.table!.foot![2], "¥3,500");
});

check("the tax pot is ready for tax, never saved", () => {
  const moves = [move("tax", "fill", 6000, "2026-10-05"), move("tax", "take_out", -1000, "2026-10-25")];
  const view = draw("tax", ctxOf([pot("tax", 5000, { category: "government_tax" })], moves));
  assert.equal(view.line, "Tax pot: ¥6,000 went in since Oct 5, all from client payments. ¥1,000 was taken out; ¥5,000 is ready for tax.");
  assert.doesNotMatch(JSON.stringify([view.line, view.aria, view.table, view.data]), /saved/i);
  assert.ok(view.data!.nodes.some(node => node.label === "Ready for tax" && node.minor === 5000));
  reads(view, today);
});

check("a carry from a pot that ended empty brings that pot's choices along; one that still holds money does not", () => {
  const pair = (potMoney: number) => [move("trip", "carry", -2000, "2026-10-10", { pairId: "p1" }), move("cam", "carry", 2000, "2026-10-10", { pairId: "p1" }), move("trip", "add", 2000 + potMoney, "2026-09-01", { choiceId: "c2" })];
  const emptied = draw("cam", ctxOf([pot("cam", 3000), pot("trip", 0)], [...pair(0), move("cam", "fill", 1000, "2026-10-12")], [choice("c2", 2000, "2026-09-01")]));
  assert.equal(fact(emptied.facts, "win_count")!.value, 1);
  assert.equal(fact(emptied.facts, "pot_carried_in")!.value, 2000);
  assert.equal(emptied.facts.find(item => item.name === "pot_carried_in" && item.about?.id === "trip")!.value, 2000);
  assert.match(emptied.line!, /¥2,000 moved in from Hakone trip/);
  const kept = draw("cam", ctxOf([pot("cam", 3000), pot("trip", 500)], [...pair(500), move("cam", "fill", 1000, "2026-10-12")], [choice("c2", 2500, "2026-09-01")]));
  assert.equal(fact(kept.facts, "win_count"), null);
});

check("a pot with no move says its story starts with its first move; an unknown pot is refused in words", () => {
  const view = draw("cam", ctxOf([pot("cam", 0)], []));
  assert.deepEqual([view.data, view.line, view.facts, view.empty!.words], [null, null, [], "This pot's story starts with its first move."]);
  assert.throws(() => draw("nope", ctxOf([], [])), (error: unknown) => error instanceof ViewError && /find that pot/.test(error.message));
  assert.throws(() => resolveView("pot_story", {}, ctxOf([], [])), /potId/);
});

check("a story that does not sum is refused, naming the pot", () => {
  assert.throws(() => draw("cam", ctxOf([pot("cam", 900)], [move("cam", "fill", 1000, "2026-10-05")])), /Camera/);
});

console.log(`\n${tally.passed} checks passed`);
