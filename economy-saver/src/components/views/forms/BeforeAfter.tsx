import type { ViewResult } from "@/lib/views/types";
import "./before-after.css";

/** The before-and-after form (D77): one row per thing that moves, the picture without it beside the picture with it. The sentence is the line under it. */
export function BeforeAfter({ result }: { result: ViewResult<"before_after"> }) {
  const data = result.data!, pending = result.figures.status === "pending";
  const heads = pending ? ["Now", "If you confirm"] : ["Without it", "With it"];
  const figures = data.rows.filter(row => row.key !== "sentence"); // the sentence is the line under the chart, and a row of the table
  return <div className="ba-chart" role="group" aria-label={result.aria}>
    <div className="ba-head" aria-hidden="true"><span /><span>{heads[0]}</span><span /><span>{heads[1]}</span><span /></div>
    <ul className="ba-rows">
      {figures.map(row => <li key={row.key} className="ba-row">
        <span className="ba-label">{row.label}</span>
        <span className="ba-before">{row.before}</span>
        <span className="ba-arrow" aria-hidden="true">→</span>
        <b className="ba-after">{row.after}</b>
        <span className="ba-change">{row.change ?? (row.key === "low" ? "No change" : "")}</span>
      </li>)}
    </ul>
  </div>;
}
