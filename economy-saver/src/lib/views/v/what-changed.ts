// What did this change (D77): the picture without an item and with it. The two sides are worked out by `whatChanged`; this draws them in words.
import { WhatChangedError, whatChanged } from "@/lib/money/what-changed";
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
  const line = sentence.changed ? `${pending ? "If you confirm it, your sentence becomes" : "Because of it, your sentence reads"}: ${sentence.after}` : `Your sentence is unchanged: ${sentence.after}`;
  const moved = result.rows.filter(row => row.key !== "low" && row.key !== "sentence").length;
  return {
    view: "what_changed", args: { ...args }, form: "before_after", title: pending ? `If you confirm ${result.name}` : `What ${result.name} changed`, question: meta.question, hint: meta.hint, home: meta.home, currency,
    data: { rows: result.rows }, table, empty: null, line, strip: null,
    aria: `${pending ? `What ${result.name} changes if you confirm it` : `What ${result.name} changed`}: ${result.rows.filter(row => row.key !== "sentence").map(row => `${row.label} ${row.before}, then ${row.after}`).join("; ")}. ${line}`,
    source: pending ? "Your money now, against the same money with it confirmed. Nothing is added until you confirm." : "Your money without it, against your money now.",
    figures: { status: result.when, kind: result.kind, changedRows: moved, lowLateBeforeMinor: result.lowLateMinor.before, lowLateAfterMinor: result.lowLateMinor.after, lowUsualBeforeMinor: result.lowUsualMinor.before, lowUsualAfterMinor: result.lowUsualMinor.after, safeBeforeMinor: result.safeMinor.before, safeAfterMinor: result.safeMinor.after },
  };
};
