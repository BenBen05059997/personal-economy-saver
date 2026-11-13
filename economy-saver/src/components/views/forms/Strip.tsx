"use client";

import { useState } from "react";
import type { ViewResult } from "@/lib/views/types";
import { niceStep, useWidth } from "../chart-utils";
import "@/components/home/home-views.css";
import "./strip.css";

const LABEL = 168, PAD = 10, ROW = 52, MID = 30;
const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/** The strip form: a row per client on one shared days axis, a dot for each paid invoice, a tick at the usual days, and a ring for each open invoice (red once it is past the slowest). Hover or focus a row for its numbers. */
export function Strip({ result }: { result: ViewResult<"strip"> }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<string | null>(null);
  const { maxDays, rows } = result.data!;
  const plotW = Math.max(220, width - LABEL), x = (d: number) => PAD + (d / maxDays) * (plotW - 2 * PAD);
  const step = niceStep(maxDays, 5), ticks: number[] = [];
  for (let v = 0; v <= maxDays + 1e-9; v += step) ticks.push(v);
  const hovered = rows.find(row => row.key === active);
  return <div className="hv-chart st-chart" ref={ref}>
    <div className="hv-legend">
      <span><i className="st-key st-key-dot" />Paid invoice</span>
      <span><i className="st-key st-key-usual" />Usual days</span>
      <span><i className="st-key st-key-open" />Open invoice, days so far</span>
      {rows.some(row => row.open.some(o => o.late)) && <span><i className="st-key st-key-late" />Open longer than the slowest</span>}
    </div>
    <div className="st-rows hv-plot" role="group" aria-label={result.aria}>
      {rows.map(row => <div key={row.key} className={active === row.key ? "st-row st-row-on" : "st-row"} tabIndex={0} role="img" aria-label={row.aria}
        onPointerEnter={() => setActive(row.key)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(row.key)} onBlur={() => setActive(null)}>
        <div className="st-name"><b>{row.label}</b><small>{days(row.usual)} usual · {row.slowest} slowest</small></div>
        <svg width={plotW} height={ROW} viewBox={`0 0 ${plotW} ${ROW}`} aria-hidden="true">
          {ticks.map(v => <line key={v} className="hv-grid" x1={x(v)} x2={x(v)} y1={4} y2={ROW - 4} />)}
          <line className="st-track" x1={x(0)} x2={x(maxDays)} y1={MID} y2={MID} />
          <line className="st-usual" x1={x(row.usual)} x2={x(row.usual)} y1={MID - 12} y2={MID + 12} />
          {row.dots.map((d, i) => {
            const before = row.dots.slice(0, i).filter(other => other === d).length;
            return <circle key={i} className="st-dot" cx={x(d)} cy={MID + (before % 2 ? 1 : -1) * Math.ceil(before / 2) * 7} r={5} />;
          })}
          {row.open.map((o, i) => <g key={`o${i}`}>
            <circle className={o.late ? "st-open st-open-late" : "st-open"} cx={x(o.days)} cy={MID} r={6.5} />
            <text className="st-open-label" x={x(o.days)} y={MID - 15 - i * 12} textAnchor={x(o.days) > plotW - 60 ? "end" : "middle"}>{days(o.days)}</text>
          </g>)}
        </svg>
      </div>)}
      <div className="st-axis"><span aria-hidden="true" /><svg width={plotW} height={22} viewBox={`0 0 ${plotW} 22`} aria-hidden="true">
        {ticks.map(v => <text key={v} className="hv-axis" x={x(v)} y={14} textAnchor={v === 0 ? "start" : v === ticks[ticks.length - 1] ? "end" : "middle"}>{v === ticks[ticks.length - 1] ? `${v} days` : v}</text>)}
      </svg></div>
      {hovered && <div className="hv-tip" style={{ left: LABEL + 24, top: rows.indexOf(hovered) * (ROW + 6) + ROW }} role="status"><strong>{hovered.label}</strong>
        <p>Paid in <b>{hovered.dots.join(", ")}</b> days</p>
        <p>Usual <b>{days(hovered.usual)}</b> · slowest <b>{days(hovered.slowest)}</b></p>
        {hovered.open.map((o, i) => <p key={i}><span>{o.label}{o.late ? ", longer than the slowest" : ""}</span></p>)}</div>}
    </div>
  </div>;
}
