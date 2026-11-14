// The list of money terms (D78) and the fact record (D79). Pure, no database.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/facts-test.ts
import assert from "node:assert/strict";
import { engineFact, fact, forModel, personFact } from "@/lib/money/facts";
import { CASES, TERMS, termOf } from "@/lib/money/terms";

let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`✓ ${name}`); }

check("every term has a label, a meaning, a unit and a case rule", () => {
  for (const term of TERMS) {
    assert.ok(term.label.trim(), `${term.name} label`);
    assert.ok(term.meaning.trim(), `${term.name} meaning`);
    assert.ok(["late", "as_usual", "named", "none"].includes(term.case), `${term.name} case`);
    assert.ok(["money", "days", "count", "date", "percent", "text", "flag", "period"].includes(term.unit), `${term.name} unit`);
    assert.match(term.name, /^[a-z0-9]+(_[a-z0-9]+)*$/);
  }
});
check("names and labels are unique, and the two cases are defined", () => {
  assert.equal(new Set(TERMS.map(t => t.name)).size, TERMS.length);
  assert.equal(new Set(TERMS.map(t => t.label)).size, TERMS.length);
  assert.ok(CASES.as_usual.meaning && CASES.late.meaning);
});
check("safe to spend is late and safe to spend as usual carries its case", () => {
  assert.equal(termOf("safe_to_spend").case, "late");
  assert.equal(termOf("safe_to_spend_as_usual").case, "as_usual");
  assert.equal(engineFact("safe_to_spend_as_usual", 5000, { from: "forecast" }).case, "as_usual");
});
check("a constructor fills the meaning and unit, and a fixed-case term gets its case", () => {
  const f = engineFact("card_room", 120000, { from: "card_cycle", currency: "JPY", about: { type: "card", id: "c1", name: "Blue card" } });
  assert.equal(f.unit, "money");
  assert.equal(f.meaning, termOf("card_room").meaning);
  assert.equal(f.case, "late");
  assert.equal(f.by, "engine");
  assert.equal(f.period, null);
  assert.equal(engineFact("limit_left", 1, { from: "x" }).case, "none");
});
check("a named term requires the case; a fixed or no-case term refuses another", () => {
  assert.throws(() => engineFact("short", 100, { from: "forecast" }), /which case/);
  assert.equal(engineFact("short", 100, { from: "forecast", case: "late" }).case, "late");
  assert.throws(() => engineFact("card_room", 1, { from: "x", case: "as_usual" }), /always late/);
  assert.throws(() => engineFact("limit_left", 1, { from: "x", case: "late" }), /no case/);
});
check("money must be an integer; days too; percent and buffer months take one decimal", () => {
  assert.throws(() => engineFact("cash", 10.5, { from: "x" }), /decimals/);
  assert.throws(() => engineFact("days_overdue", 1.5, { from: "x" }), /decimals/);
  assert.throws(() => engineFact("cash", Number.NaN, { from: "x" }), /number/);
  assert.equal(engineFact("buffer_months", 4.3, { from: "x" }).value, 4.3);
  assert.throws(() => engineFact("buffer_months", 4.33, { from: "x" }), /decimals/);
  assert.equal(engineFact("share_of_total", 12.2, { from: "x" }).value, 12.2);
});
check("an unknown amount is not_counted with its item, never a zero fact", () => {
  assert.throws(() => engineFact("not_counted", "amount not known", { from: "x" }), /about/);
  const f = engineFact("not_counted", "amount not known", { from: "x", about: { type: "bill", id: "b1", name: "Gym" } });
  assert.equal(f.about?.name, "Gym");
});
check("the reader picks by name and case", () => {
  const facts = [
    engineFact("short", 100, { from: "x", case: "as_usual" }),
    engineFact("short", 900, { from: "x", case: "late" }),
    engineFact("cash", 5, { from: "x" }),
  ];
  assert.equal(fact(facts, "short", "late")?.value, 900);
  assert.equal(fact(facts, "short")?.value, 100);
  assert.equal(fact(facts, "cash")?.value, 5);
  assert.equal(fact(facts, "pot"), null);
  assert.equal(fact(facts, "short", "none"), null);
});
check("forModel keeps the meaning beside the value and the person's number marked", () => {
  const out = forModel([engineFact("safe_to_spend", 18000, { from: "forecast", currency: "JPY", period: { from: "2026-11-14", to: "2026-12-13" } }), personFact("cash", 40000, { from: "card_cycle" })]);
  assert.equal(out[0].value, 18000);
  assert.equal(out[0].meaning, termOf("safe_to_spend").meaning);
  assert.equal(out[0].case, "late");
  assert.equal(out[1].by, "person");
  assert.equal("case" in out[1], false);
});

console.log(`\n${passed} checks passed`);
