// The list of money terms (D78) and the fact record (D79). Pure, no database.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/facts-test.ts
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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
check("forModel keeps each term's meaning once, by name, and the person's number marked", () => {
  const out = forModel([engineFact("safe_to_spend", 18000, { from: "forecast", currency: "JPY", period: { from: "2026-11-14", to: "2026-12-13" } }), engineFact("safe_to_spend", 9000, { from: "forecast", currency: "JPY" }), personFact("cash", 40000, { from: "card_cycle" })]);
  assert.equal(out.facts[0].value, 18000);
  assert.equal(out.meanings.safe_to_spend, termOf("safe_to_spend").meaning);
  assert.equal(out.meanings.cash, termOf("cash").meaning);
  assert.deepEqual(Object.keys(out.meanings), ["safe_to_spend", "cash"]);
  assert.ok(out.facts.every(item => !("meaning" in item)));
  assert.equal(out.facts[0].case, "late");
  assert.equal(out.facts[2].by, "person");
  assert.equal("case" in out.facts[2], false);
});

// D78: the app says "if clients pay late" (the case) and "overdue" (an invoice past its day); never "on time", and "late" nowhere else.
// The scan reads the words people see (quoted strings and JSX text) in every component, view and canvas file; comments and code names are not words.
const WORD_DIRS = ["src/components", "src/lib/views", "src/lib/canvas"];
/** The only places "late" may stand: the case's own phrases and the word as a code key or name inside a string. */
const LATE_ALLOWED: RegExp[] = [
  /\bclients? (?:pay|pays|paying) late\b/gi, // "if clients pay late", "clients paying late"
  /\blater than usual\b/gi, // "pays later than usual", "days later than usual"
  /\bif late\b/gi, // the short chart label of the case: "If late" beside "If as usual"
  /^late$/g, // the case key as a string
  /\blate: /g, // the case key named as a value in a description: "usual: … late: …"
  /[\w-]late\b|\blate[-_]\w+/g, // names inside strings: client_late, what-if-late, st-open-late
];
/** The words in a source file: each quoted string, each template's text (its ${...} parts are code, read on their own) and JSX text. Comments are skipped. */
function wordsIn(source: string): string[] {
  const words: string[] = [];
  let i = 0;
  const template = () => { // i is just after the opening backtick
    let text = "";
    while (i < source.length && source[i] !== "`") {
      if (source[i] === "\\") { i += 2; continue; }
      if (source[i] === "$" && source[i + 1] === "{") { i += 2; words.push(text); text = ""; code(1); continue; }
      text += source[i++];
    }
    i++; words.push(text);
  };
  const code = (depth: number) => { // reads code until the brace that closes `depth` open braces (0: to the end)
    while (i < source.length) {
      const c = source[i];
      if (c === "/" && source[i + 1] === "/") { while (i < source.length && source[i] !== "\n") i++; continue; }
      if (c === "/" && source[i + 1] === "*") { i = source.indexOf("*/", i + 2) + 2 || source.length; continue; }
      if (c === '"' || c === "'") { const quote = c; let text = ""; i++; while (i < source.length && source[i] !== quote && source[i] !== "\n") { if (source[i] === "\\") i++; text += source[i++]; } i++; words.push(text); continue; }
      if (c === "`") { i++; template(); continue; }
      if (c === "{") { depth++; i++; continue; }
      if (c === "}") { i++; if (depth > 0 && --depth === 0) return; continue; }
      i++;
    }
  };
  code(0);
  const plain = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  return [...words, ...[...plain.matchAll(/>([^<>{}=;]*[A-Za-z][^<>{}=;]*)</g)].map(m => m[1])];
}
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? filesUnder(path) : /\.tsx?$/.test(name) ? [path] : []; });
}
check("the words people see never say \"on time\" and say \"late\" only as the case's own phrases", () => {
  const bad: string[] = [];
  for (const file of WORD_DIRS.flatMap(filesUnder)) {
    for (const words of wordsIn(readFileSync(file, "utf8"))) {
      if (/\bon[- ]time\b/i.test(words)) bad.push(`${file}: "${words.trim().slice(0, 80)}" says on time`);
      const rest = LATE_ALLOWED.reduce((text, allowed) => text.replace(allowed, " "), words.trim());
      if (/\blate(?:r|ly)?\b/i.test(rest)) bad.push(`${file}: "${words.trim().slice(0, 80)}" says late`);
    }
  }
  assert.deepEqual(bad, []);
});

console.log(`\n${passed} checks passed`);
