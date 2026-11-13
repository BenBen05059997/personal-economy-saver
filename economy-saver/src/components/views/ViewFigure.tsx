"use client";

import type { ReactNode } from "react";
import type { ChartForm, ViewResult } from "@/lib/views/types";
import { RankedBars } from "./forms/RankedBars";
import { StackedColumns } from "./forms/StackedColumns";
import { StepLine } from "./forms/StepLine";

/** The drawing for each chart form. A form with no entry is not built yet; its view is not live either. */
const FORMS: { [F in ChartForm]?: (props: { result: ViewResult<F> }) => ReactNode } = {
  step_line: StepLine,
  ranked_bars: RankedBars,
  stacked_columns: StackedColumns,
};

/** One view's chart, by its form. Stops with an error when no form is drawn for it, so a view never shows blank. */
export function ViewFigure({ result }: { result: ViewResult }) {
  const draw = FORMS[result.form] as ((props: { result: ViewResult }) => ReactNode) | undefined;
  if (!draw) throw new Error(`No chart is drawn for ${result.form}`);
  return <>{draw({ result })}</>;
}
