"use client";

import { useState } from "react";
import { minorMoney } from "@/lib/money/format";
import type { ViewResult } from "@/lib/views/types";
import { useWidth } from "../chart-utils";
import "@/components/home/home-views.css";
import "./sankey.css";

const NODE_W = 14, GAP = 12, MIN_H = 4, PAD = 12, BODY = 300, CHAR = 6.7, NARROW = 560;
/** The name cut to fit `px` of label, with an ellipsis. */
const fit = (text: string, px: number) => { const room = Math.max(3, Math.floor(px / CHAR)); return text.length <= room ? text : `${text.slice(0, Math.max(1, room - 1)).trimEnd()}…`; };

/** The sankey form (D77): clients on the left, the month's money in the middle, what it went to on the right. Flow widths are proportional; labels are beside the nodes. Hover or focus a flow for its amount. */
export function Sankey({ result }: { result: ViewResult<"sankey"> }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const { nodes, links } = result.data!, currency = result.currency, format = (minor: number) => minorMoney(minor, currency);
  const columns = [0, 1, 2].map(column => nodes.filter(node => node.column === column));
  const total = Math.max(1, ...columns.map(column => column.reduce((sum, node) => sum + node.minor, 0)));
  const scale = Math.min(...columns.map(column => (BODY - Math.max(0, column.length - 1) * GAP) / total));
  const heights = new Map(nodes.map(node => [node.id, Math.max(MIN_H, node.minor * scale)]));
  const colHeight = (column: typeof nodes) => column.reduce((sum, node) => sum + heights.get(node.id)!, 0) + Math.max(0, column.length - 1) * GAP;
  const narrow = width < NARROW, labelL = Math.min(150, Math.round(width * 0.27)), labelR = Math.min(210, Math.round(width * 0.37));
  const height = Math.max(BODY, ...columns.map(colHeight)) + PAD * 2;
  const plotW = Math.max(60, width - labelL - labelR), xs = [labelL, labelL + (plotW - NODE_W) / 2, labelL + plotW - NODE_W];
  const pos = new Map<string, { x: number; y: number; h: number }>();
  columns.forEach((column, c) => {
    let y = PAD + (height - PAD * 2 - colHeight(column)) / 2;
    for (const node of column) { const h = heights.get(node.id)!; pos.set(node.id, { x: xs[c], y, h }); y += h + GAP; }
  });
  // Each link takes the next strip of its source's right edge and its target's left edge, in the order the nodes are drawn.
  const outUsed = new Map<string, number>(), inUsed = new Map<string, number>();
  const drawn = links.map(link => {
    const a = pos.get(link.from)!, b = pos.get(link.to)!, thick = Math.max(1, link.minor * scale);
    const y0 = a.y + (outUsed.get(link.from) ?? 0) + thick / 2, y1 = b.y + (inUsed.get(link.to) ?? 0) + thick / 2;
    outUsed.set(link.from, (outUsed.get(link.from) ?? 0) + thick); inUsed.set(link.to, (inUsed.get(link.to) ?? 0) + thick);
    const x0 = a.x + NODE_W, x1 = b.x, mid = (x0 + x1) / 2;
    return { link, thick, d: `M${x0},${y0} C${mid},${y0} ${mid},${y1} ${x1},${y1}` };
  });
  /** A side label: one line when there is room, else the name cut short, and on a narrow chart the amount on a second line when the node is tall enough. */
  const sideLabel = (node: (typeof nodes)[number], x: number, mid: number, px: number, anchor: "start" | "end") => {
    if (!narrow) return <text className="sk-label" x={x} y={mid + 4} textAnchor={anchor}>{node.label} <tspan className="sk-amount">{node.amountLabel}</tspan></text>;
    if (heights.get(node.id)! + GAP >= 32) return <text className="sk-label" x={x} y={mid - 2} textAnchor={anchor}>{fit(node.label, px)}<tspan className="sk-amount" x={x} dy={14}>{node.amountLabel}</tspan></text>;
    return <text className="sk-label" x={x} y={mid + 4} textAnchor={anchor}>{fit(node.label, px - node.amountLabel.length * CHAR - 4)} <tspan className="sk-amount">{node.amountLabel}</tspan></text>;
  };
  const label = (id: string) => nodes.find(node => node.id === id)!.label;
  const shown = active === null ? null : drawn[active];
  const middle = nodes.find(node => node.column === 1);
  return <div className="hv-chart" ref={ref}>
    {narrow && middle && <p className="sk-cap">{middle.label} <b>{middle.amountLabel}</b></p>}
    <div className="hv-plot">
      <svg width={width} height={height} style={{ maxWidth: "100%" }} viewBox={`0 0 ${width} ${height}`} role="group" aria-label={result.aria}>
        {drawn.map(({ link, thick, d }, i) => {
          const tone = nodes.find(node => node.id === (link.to === "month" ? link.from : link.to))!.tone;
          return <path key={`${link.from}>${link.to}`} d={d} strokeWidth={thick} className={`sk-link sk-${tone}${active === i ? " sk-link-on" : ""}`} tabIndex={0} role="img" aria-label={`${label(link.from)} to ${label(link.to)}: ${format(link.minor)}`}
            onPointerEnter={() => setActive(i)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)} />;
        })}
        {nodes.map(node => {
          const p = pos.get(node.id)!, mid = p.y + p.h / 2;
          return <g key={node.id}>
            <rect className={`sk-node sk-${node.tone}`} x={p.x} y={p.y} width={NODE_W} height={p.h} rx={2} />
            {node.column === 0 && sideLabel(node, p.x - 8, mid, labelL - 12, "end")}
            {node.column === 2 && sideLabel(node, p.x + NODE_W + 8, mid, labelR - 12, "start")}
            {node.column === 1 && !narrow && <text className="sk-label sk-mid" x={p.x + NODE_W / 2} y={p.y - 6} textAnchor="middle">{node.label} <tspan className="sk-amount">{node.amountLabel}</tspan></text>}
          </g>;
        })}
      </svg>
      {shown && <div className="hv-tip" style={{ left: Math.max(8, Math.min(width - 258, xs[1] - 40)), top: 4 }} role="status"><strong>{label(shown.link.from)} → {label(shown.link.to)}</strong><p><b>{format(shown.link.minor)}</b></p></div>}
    </div>
  </div>;
}
