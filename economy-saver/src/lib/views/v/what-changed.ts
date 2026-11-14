// What did this change (D77): the picture without an item and with it. The two sides are worked out by `whatChanged`; this draws them in words.
import { engineFact, type Fact } from "@/lib/money/facts";
import { WhatChangedError, whatChanged } from "@/lib/money/what-changed";
import { WINDOW_DAYS } from "@/lib/money/runway";
import { VIEW_META } from "../catalogue";
import { ViewError, type Resolver, type TableTwin, type ViewResult } from "../types";

export const whatChangedView: Resolver<"what_changed"> = (args, ctx): ViewResult => {
  const { state, spending } = ctx;
  if (!spending) throw new ViewError("Spending is not loaded for this view.");
  const meta = VIEW_META.what_changed, currency = state.homeCurrency;
  let result;
  try { result = whatChanged({ state, spending }, { itemId: args.itemId }); } catch (error) { if (error instanceof WhatChangedError) throw new ViewError(error.message); throw error; }
  const pending = result.when === "pending", heads = pending ? ["Now", "If you confirm"] : ["Without it", "With it"];
  const table: TableTwin = {
    caption: pending ? `What ${result.name} changes` : `What ${result.name} changed`, head: ["", ...heads, "Change"], foot: null, align: ["end", "end", "end"],
    rows: result.rows.map(row => ({ key: row.key, cells: [row.label, row.before, row.after, row.change ?? (row.key === "low" ? "No change" : "")] })),
  };
  const sentence = result.sentence;
  const line = sentence.changed ? `${pending ? `Now: ${sentence.before} If you confirm it, your sentence becomes: ${sentence.after}` : `Without it: ${sentence.before} Because of it, your sentence reads: ${sentence.after}`}` : `Your sentence is unchanged: ${sentence.after}`;
  const side = (before: boolean, late: number, usual: number, safe: number) => [
    engineFact(before ? "low_point_before_change" : "low_point_after_change", late, { from: "what_changed", currency, case: "late" }),
    engineFact(before ? "low_point_before_change" : "low_point_after_change", usual, { from: "what_changed", currency, case: "as_usual" }),
    engineFact(before ? "safe_to_spend_before_change" : "safe_to_spend_after_change", safe, { from: "what_changed", currency }),
  ];
  const facts: Fact[] = [
    ...side(true, result.lowLateMinor.before, result.lowUsualMinor.before, result.safeMinor.before),
    ...side(false, result.lowLateMinor.after, result.lowUsualMinor.after, result.safeMinor.after),
    engineFact("low_point_change", result.lowLateMinor.after - result.lowLateMinor.before, { from: "what_changed", currency, case: "late" }),
    engineFact("low_point_change", result.lowUsualMinor.after - result.lowUsualMinor.before, { from: "what_changed", currency, case: "as_usual" }),
    engineFact("days_shown", WINDOW_DAYS, { from: "what_changed" }),
    ...(sentence.day.after ? [engineFact("sentence_day", sentence.day.after, { from: "what_changed" })] : []),
  ];
  return {
    view: "what_changed", args: { ...args }, form: "before_after", title: pending ? `If you confirm ${result.name}` : `What ${result.name} changed`, question: meta.question, hint: meta.hint, home: meta.home, currency,
    data: { pending, rows: result.rows }, table, empty: null, line, strip: null, facts,
    aria: `${pending ? `What ${result.name} changes if you confirm it` : `What ${result.name} changed`}: ${result.rows.filter(row => row.key !== "sentence").map(row => `${row.label} ${row.before}, then ${row.after}`).join("; ")}. ${line}`,
    source: pending ? "Your money now, against the same money with it confirmed. Nothing is added until you confirm." : "Your money without it, against your money now.",
  };
};
