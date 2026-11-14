// Goal pace (D66) and the goal_behind suggestion. Fictional amounts, no database or credentials.
import assert from "node:assert/strict";
import { defaultRules } from "@/db/rules";
import { goalPace, goalPaces } from "@/lib/money/goals";
import { findSuggestions } from "@/lib/money/suggest";
import type { Pot } from "@/lib/money/types";
import { benMoney } from "@/lib/sample/ben";

const today = "2026-11-14";
const targetDate = "2026-12-14";
const startedOn = "2026-10-15";
const goal: Pot = { id: "camera-pot", name: "Camera", startedOn, targetDate, target: 120_000, saved: 40_000 };
const state = { ...benMoney, today };

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed++;
  console.log("✓ " + name);
}

check("a ¥120,000 goal halfway to its date needs ¥60,000 saved to be on pace", () => {
  const pace = goalPace(goal, state);
  assert.ok(pace);
  assert.deepEqual([pace.id, pace.name, pace.startedOn, pace.targetDate, pace.currency], [goal.id, goal.name, startedOn, targetDate, "JPY"]);
  assert.deepEqual(
    [pace.savedMinor, pace.targetMinor, pace.neededMinor, pace.monthlyNeededMinor, pace.expectedMinor, pace.deltaMinor, pace.reachedOn],
    [40_000, 120_000, 80_000, 80_000, 60_000, -20_000, "2027-01-13"],
  );
  assert.match(pace.summary, /¥20,000.*behind|behind.*¥20,000/i);
});

check("the Goals list includes only confirmed pots with both a target amount and a date", () => {
  const noDate: Pot = { id: "undated", name: "New furniture", saved: 10_000, target: 50_000 };
  const noTarget: Pot = { id: "no-target", name: "Tax", saved: 2_000 };
  const pending = { ...goal, id: "pending", name: "Draft camera" };
  assert.equal(goalPace(noDate, state), null);
  assert.equal(goalPace(noTarget, state), null);
  const withPots = { ...state, pots: [noDate, goal, noTarget], pendingPots: [pending] };
  assert.deepEqual(goalPaces(withPots).map(row => row.id), [goal.id]);
  assert.deepEqual(goalPaces(state), [], "Ben has no goal pots on Nov 14");
});

check("an on-pace goal reaches its target date and an ahead goal reaches it sooner", () => {
  const onPace = goalPace({ ...goal, saved: 60_000 }, state);
  const ahead = goalPace({ ...goal, saved: 75_000 }, state);
  assert.ok(onPace && ahead);
  assert.deepEqual([onPace.deltaMinor, onPace.reachedOn], [0, targetDate]);
  assert.deepEqual([ahead.deltaMinor, ahead.reachedOn], [15_000, "2026-12-02"]);
});

check("new, future and zero-saving goals cannot yet project a date from their pace", () => {
  const { startedOn: savedStart, ...withoutStart } = goal;
  const fresh = goalPace(withoutStart, state);
  const future = goalPace({ ...goal, startedOn: "2026-11-15", saved: 0 }, state);
  const empty = goalPace({ ...goal, startedOn: savedStart, saved: 0 }, state);
  assert.ok(fresh && future && empty);
  assert.deepEqual([fresh.startedOn, fresh.expectedMinor, fresh.reachedOn], [today, 0, null]);
  assert.deepEqual([future.expectedMinor, future.reachedOn], [0, null]);
  assert.deepEqual([empty.expectedMinor, empty.deltaMinor, empty.reachedOn], [60_000, -60_000, null]);
});

check("the full target is expected on and after its date, while a completed goal needs nothing more", () => {
  const due = goalPace(goal, { ...state, today: targetDate });
  const overdue = goalPace(goal, { ...state, today: "2026-12-15" });
  const completed = goalPace({ ...goal, saved: 140_000 }, state);
  assert.ok(due && overdue && completed);
  assert.deepEqual([due.expectedMinor, due.deltaMinor, overdue.expectedMinor, overdue.deltaMinor], [120_000, -80_000, 120_000, -80_000]);
  assert.deepEqual([completed.neededMinor, completed.monthlyNeededMinor, completed.reachedOn], [0, 0, today]);
});

check("a USD goal keeps cents and rounds up the required monthly amount", () => {
  const usd = { ...state, homeCurrency: "USD" as const, fxPerUsd: 1 };
  const pace = goalPace({ ...goal, target: 100.01, saved: 19.99, targetDate: "2027-02-14" }, usd);
  assert.ok(pace);
  assert.deepEqual(
    [pace.currency, pace.targetMinor, pace.savedMinor, pace.neededMinor, pace.expectedMinor, pace.deltaMinor, pace.monthlyNeededMinor, pace.reachedOn],
    ["USD", 10_001, 1_999, 8_002, 2_460, -461, 2_668, "2027-03-15"],
  );
  assert.match(pace.summary, /\$4\.61/);
});

check("the daily finding uses pace and the standing rule, with no changes to the goal or forecast state", () => {
  const rules = defaultRules();
  const frozenGoal = Object.freeze({ ...goal });
  const withGoal = Object.freeze({ ...state, pots: [frozenGoal] });
  const before = structuredClone(withGoal);
  const find = (saved: number, enabled = true) => findSuggestions(
    { ...withGoal, pots: [{ ...frozenGoal, saved }] },
    { ...rules, goal_behind: { ...rules.goal_behind, enabled } },
  ).filter(row => row.kind === "goal_behind");
  assert.deepEqual(find(40_000).map(row => [row.refId, row.action]), [[goal.id, "pot"]]);
  const [behind] = find(40_000);
  const paceNow = goalPace({ ...goal, saved: 40_000 }, withGoal)!;
  assert.deepEqual(behind.facts.map(item => [item.name, item.value]), [
    ["goal_pace", paceNow.deltaMinor], ["goal_target_date", paceNow.targetDate], ["goal_monthly_needed", paceNow.monthlyNeededMinor], ["goal_still_to_set_aside", paceNow.neededMinor]]);
  assert.deepEqual(find(60_000), []);
  assert.deepEqual(find(75_000), []);
  assert.deepEqual(find(40_000, false), []);
  goalPace(frozenGoal, withGoal);
  goalPaces(withGoal);
  findSuggestions(withGoal, rules);
  assert.deepEqual(withGoal, before);
});

console.log(String(passed) + " goal checks passed");
