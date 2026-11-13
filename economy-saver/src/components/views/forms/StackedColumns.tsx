"use client";

import { useState } from "react";
import { minorMoney, minorPerUnit } from "@/lib/money/format";
import type { ViewResult } from "@/lib/views/types";
import { compact, niceStep, useWidth } from "../chart-utils";
import "@/components/home/home-views.css";
import "./stacked-columns.css";

const H = 270, M = { left: 54, right: 12, top: 28, bottom: 30 };

/** The stacked-columns form: up to five segments per column, dashed labelled reference lines, a part below zero in the `short` tone, and the current column's label in bold. Hover or focus a column for its parts. */
export function StackedColumns({ result }: { result: ViewResult<"stacked_columns"> }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const data = result.data!, { segments, columns, refs } = data, currency = result.currency;
  const format = (value: number) => minorMoney(value, currency);
  const plotW = Math.max(200, width - M.left - M.right), plotH = H - M.top - M.bottom;
  const up = (col: { parts: number[] }) => col.parts.reduce((sum, v) => sum + Math.max(0, v), 0), down = (col: { parts: number[] }) => col.parts.reduce((sum, v) => sum + Math.min(0, v), 0);
  const top = Math.max(1, ...columns.map(up), ...refs.map(r => r.minor)), step = niceStep(Math.max(top, -Math.min(0, ...columns.map(down))), 4);
  const max = Math.ceil(top / step) * step, min = -Math.ceil(-Math.min(0, ...columns.map(down)) / step) * step;
  const y = (v: number) => M.top + plotH - ((v - min) / (max - min)) * plotH;
  const ticks: number[] = []; for (let v = min; v <= max + step / 2; v += step) ticks.push(v);
  const col = plotW / columns.length, barW = Math.min(64, col * 0.5);
  const hovered = active === null ? null : columns[active];
  const tipLeft = active === null ? 0 : Math.min(width - 218, Math.max(8, M.left + col * (active + 0.5) - 105));
  return <div className="hv-chart" ref={ref}>
    <div className="hv-legend">{segments.map(segment => <span key={segment.key}><i className={`sc-key sc-seg-${segment.tone}`} />{segment.legend}</span>)}</div>
    <div className="hv-plot">
      <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="group" aria-label={result.aria}>
        {ticks.map(v => <g key={v}><line className={v === 0 ? "hv-base" : "hv-grid"} x1={M.left} x2={M.left + plotW} y1={y(v)} y2={y(v)} /><text className="hv-axis" x={M.left - 8} y={y(v) + 4} textAnchor="end">{compact(v / minorPerUnit(currency), currency)}</text></g>)}
        {refs.map(line => <g key={line.label}><line className="sc-ref" x1={M.left} x2={M.left + plotW} y1={y(line.minor)} y2={y(line.minor)} /><text className="sc-ref-label" x={M.left + plotW} y={y(line.minor) - 4} textAnchor="end">{line.label}</text></g>)}
        {columns.map((column, i) => {
          const cx = M.left + col * (i + 0.5);
          let above = 0, below = 0;
          const bars = column.parts.map((part, index) => {
            if (part === 0) return null;
            const negative = part < 0, from = negative ? below : above, to = from + part;
            if (negative) below = to; else above = to;
            const tone = negative ? "short" : segments[index]?.tone ?? "main";
            const gap = index > 0 && !negative ? 2 : 0, h = Math.max(0, Math.abs(y(from) - y(to)) - gap);
            return <rect key={index} className={`sc-seg-${tone}`} x={cx - barW / 2} y={negative ? y(from) : y(to)} width={barW} height={h} />;
          });
          return <g key={column.key} className={active === i ? "sc-col sc-col-on" : "sc-col"} tabIndex={0} role="img" aria-label={column.aria}
            onPointerEnter={() => setActive(i)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}>
            <rect className="sc-hit" x={cx - col / 2} y={M.top} width={col} height={plotH + M.bottom} />
            {bars}
            <text className="sc-total" x={cx} y={y(Math.max(above, 0)) - 7} textAnchor="middle">{column.totalLabel}</text>
            <text className={column.current ? "hv-axis sc-now" : "hv-axis"} x={cx} y={H - 8} textAnchor="middle">{column.label}</text>
          </g>;
        })}
      </svg>
      {hovered && <div className="hv-tip" style={{ left: tipLeft, top: 4 }} role="status"><strong>{hovered.label}</strong>
        {segments.map((segment, index) => (index === 0 || hovered.current || hovered.parts[index] !== 0) && <p key={segment.key}>{segment.legend} <b>{format(hovered.parts[index] ?? 0)}</b></p>)}
        <p>Total <b>{hovered.totalLabel}</b></p></div>}
    </div>
  </div>;
}
