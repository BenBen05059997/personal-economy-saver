// Checks qa/scenarios/*.json and summarises qa/results.json (see qa/README.md).
//   node scripts/qa-report.mjs             check, then counts and failures
//   node scripts/qa-report.mjs --check     check the scenario files only
//   node scripts/qa-report.mjs --failures  failing and blocked entries as JSON
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const qaDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "qa");
const scenarioDir = join(qaDir, "scenarios");
const resultsPath = join(qaDir, "results.json");

const TYPES = ["happy", "negative", "edge", "security", "agent"];
const PRIORITIES = ["P1", "P2", "P3"];
const NEEDS = ["none", "model", "deploy", "paypal_webhook", "email", "microphone", "owner"];
const HOWS = ["browser", "http", "suite", "eval"];
const STATUSES = ["pass", "fail", "blocked", "skipped"];
const WIDTHS = ["375", "1440", "both", "n/a"];
const ID = /^[A-Z]+-\d{3}$/;

const args = new Set(process.argv.slice(2));
const problems = [];

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    problems.push(`${path}: not valid JSON (${error.message})`);
    return null;
  }
}

function strings(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim() !== "");
}

const scenarios = new Map();
const files = existsSync(scenarioDir) ? readdirSync(scenarioDir).filter((name) => name.endsWith(".json")).sort() : [];
if (files.length === 0) problems.push("qa/scenarios has no .json files");

for (const file of files) {
  const list = readJson(join(scenarioDir, file));
  if (list === null) continue;
  if (!Array.isArray(list)) {
    problems.push(`${file}: must be a JSON array`);
    continue;
  }
  list.forEach((s, index) => {
    const where = `${file}[${index}]${s && s.id ? ` ${s.id}` : ""}`;
    if (!s || typeof s !== "object") return problems.push(`${where}: not an object`);
    if (!ID.test(s.id ?? "")) problems.push(`${where}: id must look like ASK-004`);
    else if (scenarios.has(s.id)) problems.push(`${where}: id also in ${scenarios.get(s.id).file}`);
    for (const key of ["area", "action", "user_goal"]) {
      if (typeof s[key] !== "string" || s[key].trim() === "") problems.push(`${where}: ${key} missing`);
    }
    if (!TYPES.includes(s.type)) problems.push(`${where}: type must be one of ${TYPES.join(", ")}`);
    if (!PRIORITIES.includes(s.priority)) problems.push(`${where}: priority must be one of ${PRIORITIES.join(", ")}`);
    if (!strings(s.needs) || !s.needs.every((n) => NEEDS.includes(n))) problems.push(`${where}: needs must list ${NEEDS.join(", ")}`);
    else if (s.needs.includes("none") && s.needs.length > 1) problems.push(`${where}: needs "none" stands alone`);
    if (!HOWS.includes(s.how)) problems.push(`${where}: how must be one of ${HOWS.join(", ")}`);
    for (const key of ["preconditions", "steps", "expected"]) {
      if (!strings(s[key])) problems.push(`${where}: ${key} must be a non-empty list of sentences`);
    }
    if (s.refs !== undefined && !Array.isArray(s.refs)) problems.push(`${where}: refs must be a list`);
    if (s.how === "suite" && !(s.refs ?? []).some((r) => /^db:|^npm run|frontend-check/.test(r))) {
      problems.push(`${where}: a suite scenario names its suite in refs`);
    }
    const known = new Set(["id", "area", "action", "user_goal", "type", "priority", "needs", "how", "preconditions", "steps", "expected", "refs"]);
    for (const key of Object.keys(s)) if (!known.has(key)) problems.push(`${where}: unknown field ${key}`);
    if (ID.test(s.id ?? "") && !scenarios.has(s.id)) scenarios.set(s.id, { ...s, file });
  });
}

let results = [];
if (!args.has("--check")) {
  const data = existsSync(resultsPath) ? readJson(resultsPath) : null;
  if (data && !Array.isArray(data.results)) problems.push("results.json: results must be a list");
  results = Array.isArray(data?.results) ? data.results : [];
  const seen = new Set();
  results.forEach((r, index) => {
    const where = `results.json[${index}]${r?.id ? ` ${r.id}` : ""}`;
    if (!scenarios.has(r?.id)) problems.push(`${where}: no scenario with this id`);
    if (seen.has(r?.id)) problems.push(`${where}: recorded twice`);
    seen.add(r?.id);
    if (!STATUSES.includes(r?.status)) problems.push(`${where}: status must be one of ${STATUSES.join(", ")}`);
    if (r?.width !== undefined && !WIDTHS.includes(String(r.width))) problems.push(`${where}: width must be one of ${WIDTHS.join(", ")}`);
    if (r?.status !== "pass" && !(typeof r?.actual === "string" && r.actual.trim())) problems.push(`${where}: a ${r?.status} entry says what happened in actual`);
  });
}

if (problems.length > 0) {
  console.error(`${problems.length} problem(s):`);
  for (const p of problems) console.error(`- ${p}`);
  process.exit(1);
}

if (args.has("--check")) {
  const byNeed = {};
  for (const s of scenarios.values()) for (const n of s.needs) byNeed[n] = (byNeed[n] ?? 0) + 1;
  console.log(`${scenarios.size} scenarios in ${files.length} files. By need: ${Object.entries(byNeed).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  process.exit(0);
}

if (args.has("--failures")) {
  const out = results
    .filter((r) => r.status === "fail" || r.status === "blocked")
    .map((r) => {
      const s = scenarios.get(r.id);
      return { ...r, area: s.area, action: s.action, priority: s.priority, needs: s.needs, how: s.how, steps: s.steps, expected: s.expected, refs: s.refs ?? [], file: s.file };
    })
    .sort((a, b) => a.priority.localeCompare(b.priority) || a.id.localeCompare(b.id));
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

const count = { pass: 0, fail: 0, blocked: 0, skipped: 0 };
for (const r of results) count[r.status] += 1;
const notRun = [...scenarios.keys()].filter((id) => !results.some((r) => r.id === id));
console.log(`${scenarios.size} scenarios: ${count.pass} pass, ${count.fail} fail, ${count.blocked} blocked, ${count.skipped} skipped, ${notRun.length} not run.`);
const areas = {};
for (const s of scenarios.values()) {
  const a = (areas[s.area] ??= { total: 0, pass: 0, fail: 0, blocked: 0, skipped: 0 });
  a.total += 1;
  const r = results.find((x) => x.id === s.id);
  if (r) a[r.status] += 1;
}
for (const [area, a] of Object.entries(areas)) {
  console.log(`  ${area}: ${a.total} (${a.pass} pass, ${a.fail} fail, ${a.blocked} blocked)`);
}
const failing = results.filter((r) => r.status === "fail").sort((a, b) => scenarios.get(a.id).priority.localeCompare(scenarios.get(b.id).priority));
if (failing.length > 0) {
  console.log("\nFailing:");
  for (const r of failing) {
    const s = scenarios.get(r.id);
    console.log(`  ${r.id} [${s.priority}] ${s.action}: ${r.actual}`);
  }
}
