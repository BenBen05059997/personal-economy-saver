"use client";

import type { ViewResult } from "@/lib/views/types";
import { StackedColumns } from "@/components/views/forms/StackedColumns";
import { ViewPanel } from "@/components/views/ViewPanel";
import "@/components/home/home-views.css";
import "./spending.css";

/** Spending → Over time (D73): the months as stacked columns or a table, drawn from the month_trend view; the sentence under it names the highest past month. */
export function OverTimePanel({ result, device }: { result: ViewResult<"stacked_columns">; device?: { householdId: string } }) {
  const unknown = Number(result.figures.unknownMonths ?? 0) > 0;
  return <ViewPanel id="month_trend" questions={[{ key: "months", label: "Months", result, figure: <StackedColumns result={result} /> }]}
    notes={unknown ? ["Some amounts are not known and are not included in these totals."] : undefined} device={device} />;
}
