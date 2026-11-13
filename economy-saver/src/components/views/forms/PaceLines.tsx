"use client";

import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { minorMoney, minorPerUnit } from "@/lib/money/format";
import type { ViewResult } from "@/lib/views/types";
import { compact, niceStep, useWidth } from "../chart-utils";
import "./pace-lines.css";

const H = 280, M = { left: 54, right: 40, top: 22, bottom: 30 };

/** The pace-lines form (D77): two running totals over the days of a month, this month in the accent and last month in grey, today marked; the pointer or arrow keys read any day. */
export function PaceLines({ result }: { result: ViewResult<"pace_lines"> }) {
  const data = result.data, [ref, width] = useWidth<HTMLDivElement>();
  const [selected, setSelected] = useState<number | null>(null), [focused, setFocused] = useState(false);
  if (!data) return null;
  const { lines, days: n, todayIndex } = data, currency = result.currency, per = minorPerUnit(currency), format = (m: number) => minorMoney(m, currency);
  const plotW = Math.max(200, width - M.left - M.right), plotH = H - M.top - M.bottom;
  const top = Math.max(1, ...lines.flatMap(l => l.points)) / per, step = niceStep(top, 4), yMax = Math.ceil(top / step) * step;
  const x = (i: number) => M.left + plotW * i / Math.max(1, n - 1), y = (m: number) => M.top + (yMax - m / per) * plotH / yMax;
  const ticks: number[] = []; for (let v = 0; v <= yMax + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  const path = (values: readonly number[]) => values.slice(1).reduce((s, value, i) => `${s} H${x(i + 1)} V${y(value)}`, `M${x(0)} ${y(values[0])}`);
  const drawn = [...lines].reverse(); // this month last, on top
  const xTicks = Array.from({ length: Math.ceil(n / 7) }, (_, k) => k * 7).filter(i => i < n);
  const move = (next: number) => setSelected(Math.max(0, Math.min(n - 1, next)));
  const onPointer = (event: PointerEvent<HTMLDivElement>) => { const rect = event.currentTarget.getBoundingClientRect(); move(Math.round((event.clientX - rect.left - M.left) / plotW * (n - 1))); };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.key === "ArrowRight" ? (selected ?? -1) + 1 : event.key === "ArrowLeft" ? (selected ?? 1) - 1 : event.key === "Home" ? 0 : event.key === "End" ? n - 1 : null;
    if (target === null) return;
    event.preventDefault(); move(target);
  };
  const valueOn = (key: string, i: number) => lines.find(l => l.key === key)?.points[i];
  const tipLeft = selected === null ? 0 : x(selected) > width / 2 ? Math.max(8, x(selected) - 14 - 210) : Math.min(width - 218, x(selected) + 14);
  const readout = (i: number) => `Day ${i + 1}: ${lines.map(l => `${l.label} ${l.points[i] === undefined ? "not yet" : format(l.points[i])}`).join("; ")}.`;
  const thisLine = lines[0], lastLine = lines[1];
  return <div className="pl-chart" ref={ref}>
    <div className="pl-legend">{lines.map(l => <span key={l.key}><i className={`pl-t-${l.tone}`} />{l.label}</span>)}{todayIndex !== null && <span><i className="pl-key-today" />Today</span>}</div>
    <div className="pl-plot" tabIndex={0} role="group" aria-label={result.aria} onPointerMove={onPointer} onPointerLeave={() => { if (!focused) setSelected(null); }} onKeyDown={onKey} onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setSelected(null); }}>
      <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} aria-hidden="true">
        {ticks.map(v => <g key={v}><line className={v === 0 ? "pl-base" : "pl-grid"} x1={M.left} x2={M.left + plotW} y1={y(v * per)} y2={y(v * per)} /><text className="pl-axis" x={M.left - 8} y={y(v * per) + 4} textAnchor="end">{compact(v, currency)}</text></g>)}
        {todayIndex !== null && <line className="pl-today" x1={x(todayIndex)} x2={x(todayIndex)} y1={M.top} y2={M.top + plotH} />}
        {drawn.map(l => <path key={l.key} className={`pl-line pl-t-${l.tone}`} d={path(l.points)} />)}
        <text className="pl-direct" x={x(lastLine.points.length - 1)} y={y(lastLine.points[lastLine.points.length - 1]) - 8} textAnchor="end">{lastLine.label}</text>
        {todayIndex !== null && <><circle className="pl-end" cx={x(todayIndex)} cy={y(thisLine.points[todayIndex])} r="5" /><text className="pl-today-label" x={x(todayIndex) - 6} y={M.top - 6} textAnchor="end">Today</text></>}
        {xTicks.map(i => <text className="pl-axis" key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : "middle"}>{i + 1}</text>)}
        {selected !== null && <><line className="pl-cross" x1={x(selected)} x2={x(selected)} y1={M.top} y2={M.top + plotH} />{drawn.map(l => l.points[selected] !== undefined && <circle key={l.key} className={`pl-pt pl-t-${l.tone}`} cx={x(selected)} cy={y(l.points[selected])} r="4" />)}</>}
      </svg>
      {selected !== null && <div className="pl-tip" style={{ left: tipLeft, top: 6 }}>
        <strong>Day {selected + 1}</strong>
        {lines.map(l => <p key={l.key}><i className={`pl-sw pl-t-${l.tone}`} /><b>{valueOn(l.key, selected) === undefined ? "–" : format(valueOn(l.key, selected)!)}</b> <span>{l.label}</span></p>)}
      </div>}
    </div>
    <div className="pl-sr" aria-live="polite">{selected === null ? "" : readout(selected)}</div>
  </div>;
}
