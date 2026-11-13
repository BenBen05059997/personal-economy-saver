"use client";

import type { ReactNode } from "react";
import type { ChartForm, ViewResult } from "@/lib/views/types";
import { Calendar } from "./forms/Calendar";
import { GoalLine } from "./forms/GoalLine";
import { PaceLines } from "./forms/PaceLines";
import { BeforeAfter } from "./forms/BeforeAfter";
import { RankedBars } from "./forms/RankedBars";
import { RunwayBar } from "./forms/RunwayBar";
import { Sankey } from "./forms/Sankey";
import { StackedColumns } from "./forms/StackedColumns";
import { Strip } from "./forms/Strip";
import { StepLine } from "./forms/StepLine";
import { Waterfall } from "./forms/Waterfall";
import { Tracks } from "./forms/Tracks";

/** The drawing for each chart form. A form with no entry is not built yet; its view is not live either. */
const FORMS: { [F in ChartForm]?: (props: { result: ViewResult<F> }) => ReactNode } = {
  step_line: StepLine,
  ranked_bars: RankedBars,
  stacked_columns: StackedColumns,
  waterfall: Waterfall,
  sankey: Sankey,
  calendar: Calendar,
  strip: Strip,
  runway_bar: RunwayBar,
  pace_lines: PaceLines,
  goal_line: GoalLine,
  tracks: Tracks,
  before_after: BeforeAfter,
};

/** One view's chart, by its form. Stops with an error when no form is drawn for it, so a view never shows blank. */
export function ViewFigure({ result }: { result: ViewResult }) {
  const draw = FORMS[result.form] as ((props: { result: ViewResult }) => ReactNode) | undefined;
  if (!draw) throw new Error(`No chart is drawn for ${result.form}`);
  return <>{draw({ result })}</>;
}
