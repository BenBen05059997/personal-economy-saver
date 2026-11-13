"use client";

import type { ViewResult } from "@/lib/views/types";
import "@/components/home/home-views.css";
import "./runway-bar.css";

/** The runway-bar form (D77): one bar for how many months the cash lasts, with the usual guide's marks at 3 and 6 months and the guide's source line under it. The marks are information; the bar is never judged against them. */
export function RunwayBar({ result }: { result: ViewResult<"runway_bar"> }) {
  const { months, cashLabel, monthlyLabel, marks, guide } = result.data!;
  const axis = Math.max(7, Math.ceil(months * 1.1), ...marks.map(mark => mark.months + 1));
  const at = (value: number) => `${Math.min(100, (value / axis) * 100)}%`;
  const word = `${months.toFixed(1)} months`;
  return <div className="hv-chart rw" role="img" aria-label={result.aria}>
    <div className="rw-sum"><b>{word}</b><span>{cashLabel} ÷ {monthlyLabel} a month</span></div>
    <div className="rw-track">
      <div className="rw-fill" style={{ width: at(months) }} />
      {marks.map(mark => <span key={mark.months} className="rw-mark" style={{ left: at(mark.months) }}><i /><small>{mark.label}</small></span>)}
    </div>
    {guide && <p className="rw-guide">{guide}</p>}
  </div>;
}
