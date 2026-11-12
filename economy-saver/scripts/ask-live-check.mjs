// The live Ask check: runs qa/ask-live/cases.json through a running app on its real model and grades what a script can.
//   node scripts/ask-live-check.mjs <base-url> --confirm-cost
// It costs the owner real money (about $1-2 a run), so it never runs inside db:test or qa:check, only with the owner's OK.
// Each case is PASS (every machine check holds), FAIL (one does not) or REVIEW (the machine checks hold but a person must read the answer).
// Writes qa/results-ask.json (git-ignored) and prints a summary. Only starts Try it households; sends nothing to PayPal.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const qaDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "qa");
const args = process.argv.slice(2);
const confirmed = args.includes("--confirm-cost");
const baseArg = args.find((a) => !a.startsWith("--"));

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

const { cases } = JSON.parse(readFileSync(join(qaDir, "ask-live", "cases.json"), "utf8"));
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

const kindOf = (turn) => (turn.reply ? (turn.reply.kind === "declined" ? "out_of_scope" : turn.reply.kind) : "error");
const JA = /[぀-ヿ一-鿿]/g;

function grade(expect, turn) {
  const fails = [];
  const text = turn.reply?.text ?? turn.error ?? "";
  const low = text.toLowerCase();
  const kind = kindOf(turn);
  if (expect.kind && kind !== expect.kind) fails.push(`kind ${kind}, wanted ${expect.kind}`);
  for (const s of expect.includes ?? []) if (!low.includes(s.toLowerCase())) fails.push(`missing "${s}"`);
  if (expect.includesAny?.length && !expect.includesAny.some((s) => low.includes(s.toLowerCase()))) fails.push(`none of ${JSON.stringify(expect.includesAny)}`);
  for (const s of expect.excludes ?? []) if (low.includes(s.toLowerCase())) fails.push(`forbidden "${s}"`);
  for (const r of expect.excludesRegex ?? []) if (new RegExp(r, "i").test(text)) fails.push(`forbidden pattern /${r}/`);
  if (expect.language === "ja" && (text.match(JA) ?? []).length < 5) fails.push("not Japanese");
  if (expect.canvas) {
    const types = (turn.reply?.canvas?.blocks ?? []).map((b) => b.type);
    for (const t of expect.canvas) if (!types.includes(t)) fails.push(`canvas has no ${t} block (has ${types.join(", ") || "none"})`);
  }
  if (expect.choices) {
    const labels = (turn.reply?.choices ?? []).map((c) => (typeof c === "string" ? c : c.text ?? c.label ?? ""));
    for (const c of expect.choices) if (!labels.includes(c)) fails.push(`no choice "${c}"`);
  }
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
    turns.push({ question: text, seconds: got.seconds, kind: kindOf(got), text: got.reply?.text ?? null, error: got.error, choices: got.reply?.choices ?? null, canvasBlocks: (got.reply?.canvas?.blocks ?? []).map((b) => b.type), pending: Boolean(got.reply?.pending) });
  }
  const verdict = fails.length ? "FAIL" : c.judge ? "REVIEW" : "PASS";
  results.push({ case: c.id, group: c.group, household: c.household, refs: c.refs, verdict, why: fails.join("; "), review: c.review, seconds: turns.map((t) => t.seconds), turns });
  console.log(`${verdict.padEnd(6)} ${String(c.id).padEnd(4)} ${turns.map((t) => t.seconds.toFixed(1)).join("/")}s ${fails.join("; ")}`);
}

writeFileSync(join(qaDir, "results-ask.json"), JSON.stringify(results, null, 1) + "\n");
const n = (v) => results.filter((r) => r.verdict === v).length;
const all = results.flatMap((r) => r.seconds);
console.log(`\n${results.length} cases: ${n("PASS")} PASS, ${n("FAIL")} FAIL, ${n("REVIEW")} REVIEW. Slowest ${Math.max(...all).toFixed(1)}s, median ${all.sort((a, b) => a - b)[Math.floor(all.length / 2)].toFixed(1)}s.`);
console.log("REVIEW cases need a person to read the answer against its `review` line in qa/results-ask.json.");
process.exit(n("FAIL") ? 1 : 0);
