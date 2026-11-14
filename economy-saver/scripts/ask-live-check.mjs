// The live Ask check: runs qa/ask-live/cases.json through a running app on its real model and grades what a script can.
//   node scripts/ask-live-check.mjs <base-url> --confirm-cost [--only 14,J1,J2]
// --only runs just those case ids (in file order, each on its household's fresh Try it start) and merges their entries into the existing qa/results-ask.json.
// A case that needs an earlier case's state or conversation (a confirm after a draft) must be named together with it.
// It costs the owner real money (about $1-2 a run), so it never runs inside db:test or qa:check, only with the owner's OK.
// Each case is PASS (every machine check holds), FAIL (one does not) or REVIEW (the machine checks hold but a person must read the answer).
// Writes qa/results-ask.json (git-ignored) and prints a summary. Only starts Try it households; sends nothing to PayPal.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const qaDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "qa");
const args = process.argv.slice(2);
const confirmed = args.includes("--confirm-cost");
const onlyAt = args.indexOf("--only");
const onlyRaw = onlyAt >= 0 ? args[onlyAt + 1] : undefined;
if (onlyAt >= 0 && (!onlyRaw || onlyRaw.startsWith("--"))) { console.error("--only needs case ids, like --only 14,J1,J2."); process.exit(2); }
const only = onlyRaw ? onlyRaw.split(",").map((x) => x.trim()).filter(Boolean) : null;
const baseArg = args.find((a, i) => !a.startsWith("--") && i !== onlyAt + 1);

if (!baseArg) {
  console.error("Usage: node scripts/ask-live-check.mjs <base-url> --confirm-cost\nThe base URL is required; there is no default.");
  process.exit(2);
}
if (!confirmed) {
  console.error("Refusing to run: a live Ask check calls the real model and costs the owner about $1-2.\nRun it only with the owner's OK, adding --confirm-cost.");
  process.exit(2);
}
let base;
try {
  base = new URL(baseArg).origin;
} catch {
  console.error(`"${baseArg}" is not a URL. Give one like http://127.0.0.1:3123 or https://your-app.example.`);
  process.exit(2);
}

const { cases: allCases } = JSON.parse(readFileSync(join(qaDir, "ask-live", "cases.json"), "utf8"));
const unknown = (only ?? []).filter((id) => !allCases.some((c) => String(c.id) === id));
if (unknown.length) { console.error(`No such case: ${unknown.join(", ")}.`); process.exit(2); }
const cases = only ? allCases.filter((c) => only.includes(String(c.id))) : allCases;
const same = { Origin: base, "Sec-Fetch-Site": "same-origin" };
const households = new Map();

async function cookieFor(n) {
  if (households.has(n)) return households.get(n);
  const res = await fetch(`${base}/api/try`, { redirect: "manual", headers: same });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  if (!cookie.startsWith("household=")) throw new Error(`Try it did not give a household cookie (status ${res.status}).`);
  households.set(n, cookie);
  return cookie;
}

async function ask(cookie, conversationId, text) {
  const id = crypto.randomUUID();
  const start = performance.now();
  const res = await fetch(`${base}/api/ask`, {
    method: "POST",
    headers: { ...same, cookie, "content-type": "application/json" },
    body: JSON.stringify({ id, conversationId, text, source: "manual", canvas: null }),
  });
  const body = await res.text();
  const seconds = Math.round((performance.now() - start)) / 1000;
  const lines = body.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
  const last = lines.at(-1) ?? {};
  return { status: res.status, seconds, reply: last.reply ?? null, error: last.error ?? (res.ok ? null : body.slice(0, 300)) };
}

const viewsOf = (reply) => (reply?.canvas?.blocks ?? []).filter((b) => b.type === "view").map((b) => b.data?.view);
const kindOf = (turn) => (turn.reply ? (turn.reply.kind === "declined" ? "out_of_scope" : turn.reply.kind) : "error");
const JA = /[぀-ヿ一-鿿]/g;
const blocksOf = (reply) => (reply?.canvas?.blocks ?? []).filter((b) => b.type === "view");
/** The sentence each view in the canvas shows under its picture (written by code from the view's facts). */
const linesOf = (reply) => blocksOf(reply).map((b) => b.data?.line).filter((l) => typeof l === "string" && l);
/** Every fact the canvas's views carry (D79): the reading the person sees. */
const factsOf = (reply) => blocksOf(reply).flatMap((b) => (b.data?.facts ?? []).map((f) => ({ ...f, view: b.data?.view })));
const factNamesOf = (reply) => [...new Set(factsOf(reply).map((f) => `${f.name}${f.case && f.case !== "none" ? `:${f.case}` : ""}`))];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** How a fact's value reads to a person: money without its sign (the words carry "short"), a date as "Nov 27", a day count as the bare number. Returns the forms that count as showing it. */
function shown(fact) {
  const v = fact.value;
  switch (fact.unit) {
    case "money": {
      const abs = Math.abs(v);
      return fact.currency === "USD" ? [`$${(abs / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`, `$${(abs / 100).toLocaleString("en-US")}`] : [`¥${abs.toLocaleString("en-US")}`];
    }
    case "date": { const [, m, d] = String(v).split("-"); return [`${MONTHS[Number(m) - 1]} ${Number(d)}`]; }
    case "percent": return [`${Math.abs(v)}%`, `${Math.round(Math.abs(v))}%`];
    default: return [String(v)];
  }
}
/** A day count or a count must stand alone as a number; any other form just has to appear. */
const appears = (forms, low, unit) => forms.some((f) => (unit === "days" || unit === "count" ? new RegExp(`(^|[^\\d,.])${f.toLowerCase()}($|[^\\d,])`).test(low) : low.includes(f.toLowerCase())));
const sameValue = (want, got) => (typeof want === "number" ? want === got : String(want) === String(got));

function grade(expect, turn) {
  // `either`: alternatives for what the canvas draws (a block type or the view `show` drew); the case passes when one holds, and the rest of `expect` is graded as usual.
  if (expect.either) {
    const { either, ...rest } = expect;
    const tries = either.map((alt) => grade({ ...rest, ...alt }, turn));
    return tries.find((fails) => fails.length === 0) ?? tries[0];
  }
  const fails = [];
  fails.review = [];
  const modelText = turn.reply?.text ?? turn.error ?? "";
  // What the person sees (D79): the reply's text and each view's sentence. Code writes the sentence, so the model's text need not restate it.
  const text = [modelText, ...linesOf(turn.reply)].join("\n");
  const low = text.toLowerCase();
  const kind = kindOf(turn);
  if (expect.kind && kind !== expect.kind) fails.push(`kind ${kind}, wanted ${expect.kind}`);
  for (const s of expect.includes ?? []) if (!low.includes(s.toLowerCase())) fails.push(`missing "${s}"`);
  if (expect.includesAny?.length && !expect.includesAny.some((s) => low.includes(s.toLowerCase()))) fails.push(`none of ${JSON.stringify(expect.includesAny)}`);
  for (const s of expect.excludes ?? []) if (low.includes(s.toLowerCase())) fails.push(`forbidden "${s}"`);
  for (const r of expect.excludesRegex ?? []) if (new RegExp(r, "i").test(text)) fails.push(`forbidden pattern /${r}/`);
  if (expect.language === "ja" && (text.match(JA) ?? []).length < 5) fails.push("not Japanese");
  if (expect.view) {
    const shown = viewsOf(turn.reply);
    for (const v of expect.view) if (!shown.includes(v)) fails.push(`canvas has no ${v} view (has ${shown.join(", ") || "none"})`);
  }
  if (expect.canvas) {
    const types = (turn.reply?.canvas?.blocks ?? []).map((b) => b.type);
    for (const t of expect.canvas) if (!types.includes(t)) fails.push(`canvas has no ${t} block (has ${types.join(", ") || "none"})`);
  }
  if (expect.choices) {
    const labels = (turn.reply?.choices ?? []).map((c) => (typeof c === "string" ? c : c.text ?? c.label ?? ""));
    for (const c of expect.choices) if (!labels.includes(c)) fails.push(`no choice "${c}"`);
  }
  const facts = factsOf(turn.reply);
  for (const want of expect.facts ?? []) {
    const label = `fact ${want.name}${want.case ? ` (${want.case})` : ""} ${want.value}`;
    const got = facts.find((f) => f.name === want.name && (want.case === undefined || f.case === want.case) && sameValue(want.value, f.value) && (want.about === undefined || f.about?.name === want.about));
    if (!got) { fails.push(`no view carries ${label}${want.about ? ` about ${want.about}` : ""}`); continue; }
    if (!appears(shown(got), low, got.unit)) fails.push(`${label} is in the view but not in what the person sees (${shown(got).join(" or ")})`);
  }
  for (const no of expect.notAs ?? []) {
    const forms = facts.filter((f) => f.name === no.name && (no.case === undefined || f.case === no.case)).flatMap(shown);
    const sentences = text.split(/[.!?\n]+/).map((x) => x.toLowerCase());
    for (const form of forms) for (const sentence of sentences) {
      if (sentence.includes(form.toLowerCase()) && no.words.some((w) => sentence.includes(w.toLowerCase()))) fails.push(`${no.name} ${form} sits next to ${JSON.stringify(no.words)}: "${sentence.trim().slice(0, 100)}"`);
    }
  }
  for (const [when, then] of Object.entries(expect.ifIncludes ?? {})) {
    if (!low.includes(when.toLowerCase())) continue;
    for (const s of then.includes ?? []) if (!low.includes(s.toLowerCase())) fails.push(`with "${when}", missing "${s}"`);
    if (then.includesAny?.length && !then.includesAny.some((s) => low.includes(s.toLowerCase()))) fails.push(`with "${when}", none of ${JSON.stringify(then.includesAny)}`);
  }
  // links: each string must be in some link of the reply, in its label or its address.
  for (const s of expect.links ?? []) if (!(turn.reply?.links ?? []).some((l) => `${l.label} ${l.href}`.toLowerCase().includes(s.toLowerCase()))) fails.push(`no link with "${s}"`);
  // notLine: the model's own text must not copy the view's sentence (skipped when the reply is in code's sentence).
  if (expect.notLine && (turn.reply?.wording === undefined || turn.reply.wording === "model")) {
    for (const line of linesOf(turn.reply)) if (modelText.toLowerCase().includes(line.toLowerCase())) fails.push(`the model's text restates the view's sentence "${line.slice(0, 60)}"`);
  }
  // `wording` is absent until the reply carries it (stage 4); then a reply in code's sentence is for a person to read.
  if (expect.wording === "model" && turn.reply?.wording !== undefined && turn.reply.wording !== "model") fails.review.push("the model's words failed the check");
  if (expect.pending !== undefined && Boolean(turn.reply?.pending) !== expect.pending) fails.push(`pending ${Boolean(turn.reply?.pending)}, wanted ${expect.pending}`);
  return fails;
}

const conversations = new Map();
const results = [];
for (const c of cases) {
  const cookie = await cookieFor(c.household);
  const convKey = `${c.household}:${c.group}`;
  if (!conversations.has(convKey)) conversations.set(convKey, crypto.randomUUID());
  const conversationId = conversations.get(convKey);
  const turns = [];
  const fails = [];
  const reviews = [];
  let previous = null;
  for (const turn of c.turns) {
    let text = turn.question;
    if (turn.tap !== undefined) {
      const choices = (previous?.reply?.choices ?? []).map((x) => (typeof x === "string" ? x : x.text ?? x.label ?? ""));
      if (!choices.includes(turn.tap)) { fails.push(`no choice "${turn.tap}" to tap`); break; }
      text = turn.tap;
    }
    const got = await ask(cookie, conversationId, text);
    previous = got;
    const f = grade(turn.expect ?? {}, got);
    fails.push(...f.map((x) => `${turns.length + 1}: ${x}`));
    reviews.push(...(f.review ?? []).map((x) => `${turns.length + 1}: ${x}`));
    turns.push({ question: text, seconds: got.seconds, kind: kindOf(got), text: got.reply?.text ?? null, error: got.error, choices: got.reply?.choices ?? null, canvasBlocks: (got.reply?.canvas?.blocks ?? []).map((b) => b.type), views: viewsOf(got.reply), lines: linesOf(got.reply), facts: factNamesOf(got.reply), wording: got.reply?.wording ?? null, links: got.reply?.links ?? [], pending: Boolean(got.reply?.pending) });
  }
  const verdict = fails.length ? "FAIL" : c.judge || reviews.length ? "REVIEW" : "PASS";
  results.push({ case: c.id, group: c.group, household: c.household, refs: c.refs, verdict, why: [...fails, ...reviews].join("; "), review: c.review, seconds: turns.map((t) => t.seconds), turns });
  console.log(`${verdict.padEnd(6)} ${String(c.id).padEnd(4)} ${turns.map((t) => t.seconds.toFixed(1)).join("/")}s ${[...fails, ...reviews].join("; ")}`);
}

const resultsPath = join(qaDir, "results-ask.json");
let saved = results;
if (only) {
  let before = [];
  try { before = JSON.parse(readFileSync(resultsPath, "utf8")); } catch { /* no earlier run to merge into */ }
  const ran = new Set(results.map((r) => String(r.case)));
  saved = [...before.filter((r) => !ran.has(String(r.case))), ...results];
}
writeFileSync(resultsPath, JSON.stringify(saved, null, 1) + "\n");
const n = (v) => results.filter((r) => r.verdict === v).length;
const all = results.flatMap((r) => r.seconds);
console.log(`\n${results.length} cases: ${n("PASS")} PASS, ${n("FAIL")} FAIL, ${n("REVIEW")} REVIEW. Slowest ${Math.max(...all).toFixed(1)}s, median ${all.sort((a, b) => a - b)[Math.floor(all.length / 2)].toFixed(1)}s.`);
console.log("REVIEW cases need a person to read the answer against its `review` line in qa/results-ask.json.");
process.exit(n("FAIL") ? 1 : 0);
