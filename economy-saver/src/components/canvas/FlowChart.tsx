import type { FlowData } from "@/lib/canvas/resolve";

/** The balance day by day, drawn in the runway's style: a step line over a zero baseline, the lowest point marked and named. */
export function FlowChart({ data }: { data: FlowData }) {
  const { points } = data;
  const last = Math.max(points.length - 1, 1);
  const floor = Math.min(0, ...points);
  const ceiling = Math.max(0, ...points);
  const x = (day: number) => 1 + (98 * day) / last;
  const y = (balance: number) => 8 + (74 * (ceiling - balance)) / Math.max(ceiling - floor, 1);
  const path = points.map((value, i) => (i === 0 ? `M${x(i)} ${y(value)}` : `H${x(i)} V${y(value)}`)).join(" ");
  const lowAmount = points[data.lowIndex] ?? 0;
  return <figure className="canvas-chart" aria-label={data.aria}>
    <div className="canvas-plot" aria-hidden="true">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <path className="canvas-baseline" d={`M1 ${y(0)} H99`} />
        <path className="canvas-line" d={path} />
      </svg>
      <span className="canvas-zero" style={{ top: `${y(0)}%` }}>{data.zeroLabel}</span>
      <span className={`canvas-dot ${data.short ? "is-short" : ""}`} style={{ left: `${x(data.lowIndex)}%`, top: `${y(lowAmount)}%` }} />
      <span className={`canvas-low ${data.short ? "is-short" : ""}`} style={{ left: `clamp(5em, ${x(data.lowIndex)}%, 100% - 5em)`, top: `${y(lowAmount)}%` }}>{data.lowLabel}</span>
    </div>
    <figcaption aria-hidden="true"><span>{data.startLabel}</span><span>{data.caption}</span><span>{data.endLabel}</span></figcaption>
  </figure>;
}
