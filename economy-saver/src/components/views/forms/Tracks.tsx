"use client";

import { dayLabel } from "@/lib/money/format";
import type { FormData, ViewResult } from "@/lib/views/types";
import { useWidth } from "../chart-utils";
import "./tracks.css";

const M = { left: 14, right: 14, top: 30 }, LINE = 28, LABEL = 52, LEVEL = 30, GAP = 14, CHAR = 6.4;
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

type Event = FormData["tracks"]["tracks"][number]["events"][number];

/** The tracks form: one row per track along a single date line (today at the left). Dots, ticks, due diamonds and spans carry their words under them; words that would touch step down a line. An arrow joins a purchase to the statement it lands on. Built to fit a 420px panel. */
export function Tracks({ result }: { result: ViewResult<"tracks"> }) {
  const [ref, width] = useWidth<HTMLDivElement>(380);
  const data = result.data!, plotW = Math.max(160, width - M.left - M.right), span = Math.max(1, days(data.from, data.to));
  const x = (iso: string) => M.left + (days(data.from, iso) / span) * plotW;
  const sized = data.tracks.map(track => {
    const placed: { l: number; r: number; level: number }[] = [];
    const items = [...track.events].sort((a, b) => (a.date < b.date ? -1 : 1)).map(event => {
      const cx = event.kind === "span" ? (x(event.date) + x(event.until ?? event.date)) / 2 : x(event.date);
      const first = event.label, second = event.kind === "span" ? event.amountLabel ?? "" : [dayLabel(event.date), event.amountLabel].filter(Boolean).join(" · ");
      if (!first) return { event, cx, first, second, tx: cx, level: 0 };
      const w = Math.max(first.length, second.length) * CHAR + 4, l = Math.min(width - w, Math.max(0, cx - w / 2));
      let level = 0;
      while (placed.some(p => p.level === level && l < p.r + 6 && l + w > p.l - 6)) level++;
      placed.push({ l, r: l + w, level });
      return { event, cx, first, second, tx: l + w / 2, level };
    });
    const levels = Math.max(-1, ...items.filter(i => i.first).map(i => i.level)), height = levels < 0 ? LINE + GAP : LABEL + 22 + levels * LEVEL;
    return { track, items, height };
  });
  const rows = sized.map((row, i) => ({ ...row, y: M.top + sized.slice(0, i).reduce((sum, r) => sum + r.height + 8, 0) }));
  const H = M.top + sized.reduce((sum, r) => sum + r.height + 8, 0), lineY = (y: number) => y + LINE;
  const rowOf = (key: string) => rows.find(r => r.track.key === key);
  const purchase = rowOf("purchase"), pay = rowOf("pay");
  return <div className="hv-chart tk-chart" ref={ref}>
    <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="group" aria-label={result.aria}>
      <defs><marker id="tk-head" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" className="tk-head" /></marker></defs>
      <line className="tk-today" x1={x(data.from)} x2={x(data.from)} y1={M.top - 8} y2={H - 6} />
      <text className="tk-today-label" x={x(data.from) + 5} y={M.top - 12}>Today</text>
      {rows.map(({ track, y, items }) => <g key={track.key}>
        <text className="tk-track" x={M.left + 7} y={y + 10}>{track.label}</text>
        <line className="tk-rail" x1={M.left} x2={M.left + plotW} y1={lineY(y)} y2={lineY(y)} />
        {items.map(({ event, cx, first, second, tx, level }, i) => <g key={`${event.date}-${i}`} className="tk-event" tabIndex={0} role="img" aria-label={[first, second || null, `on ${dayLabel(event.date)}`].filter(Boolean).join(" ")}>
          <title>{[first, dayLabel(event.date), event.amountLabel].filter(Boolean).join(" · ")}</title>
          <Mark event={event} x1={x(event.date)} x2={x(event.until ?? event.date)} y={lineY(y)} />
          {first && <text className="tk-text" x={tx} y={y + LABEL + level * LEVEL} textAnchor="middle"><tspan className="tk-first">{first}</tspan>{second && <tspan className="tk-second" x={tx} dy={14}>{second}</tspan>}</text>}
          <circle className="tk-hit" cx={cx} cy={lineY(y)} r={12} />
        </g>)}
      </g>)}
      {purchase && pay && data.arrows.map(arrow => <g key={arrow.from + arrow.to}>
        <title>{arrow.label}</title>
        <path className="tk-arrow" d={`M${x(arrow.from)},${lineY(purchase.y) + 7} L${x(arrow.to)},${lineY(pay.y) - 11}`} markerEnd="url(#tk-head)" />
      </g>)}
    </svg>
  </div>;
}

function Mark({ event, x1, x2, y }: { event: Event; x1: number; x2: number; y: number }) {
  const tone = `tk-t-${event.tone}`;
  if (event.kind === "span") return <rect className={`tk-span ${tone}`} x={x1} y={y - 4} width={Math.max(3, x2 - x1)} height={8} rx={2} />;
  if (event.kind === "tick") return <line className={`tk-tick ${tone}`} x1={x1} x2={x1} y1={y - 9} y2={y + 9} />;
  if (event.kind === "due") return <rect className={`tk-due ${tone}`} x={x1 - 6} y={y - 6} width={12} height={12} rx={1} transform={`rotate(45 ${x1} ${y})`} />;
  return <circle className={`tk-dot ${tone}`} cx={x1} cy={y} r={6} />;
}
