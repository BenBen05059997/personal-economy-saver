import assert from "node:assert/strict";
import { benMoney } from "@/lib/sample/ben";
import { forecastCosts } from "@/lib/money/forecast-causes";
import { low, series, timeline } from "@/lib/money/runway";

const events = timeline(benMoney, "worst"), day = low(series(benMoney, "worst")).date;
const costs = forecastCosts(events, day);
assert.deepEqual(costs.map(event => [event.kind, event.date, event.amount]), [
  ["statement", "2026-11-26", -58000], ["bill", "2026-11-27", -82000],
]);
assert(!costs.some(event => event.pending));
const arrival = events.find(event => event.kind === "arrival")!;
const replenished = [...events, { ...arrival, date: "2026-11-27" }].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "arrival" ? -1 : 1));
assert.deepEqual(forecastCosts(replenished, day).map(event => event.kind), ["bill"]);
console.log("forecast causes: confirmed statement and low-day costs; omit pending and replenished statement");
