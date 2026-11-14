"use client";

import { fact } from "@/lib/money/facts";
import type { ViewResult } from "@/lib/views/types";
import { PaceLines } from "@/components/views/forms/PaceLines";
import { StackedColumns } from "@/components/views/forms/StackedColumns";
import { ViewPanel } from "@/components/views/ViewPanel";
import "@/components/home/home-views.css";
import "./spending.css";

/** Spending → Over time (D73): Month by month (the months as stacked columns, the sentence under it naming the highest past month) and Day by day (this month's running total against last month's), each with Chart · Table. */
export function OverTimePanel({ result, pace, device }: { result: ViewResult<"stacked_columns">; pace: ViewResult<"pace_lines">; device?: { householdId: string } }) {
  const unknown = fact(result.facts, "not_counted") !== null;
  return <ViewPanel id="month_trend" questions={[{ key: "months", label: "Month by month", result, figure: <StackedColumns result={result} /> }, { key: "days", label: "Day by day", result: pace, figure: <PaceLines result={pace} /> }]}
    notes={unknown ? ["Some amounts are not known and are not included in these totals."] : undefined} device={device} />;
}
