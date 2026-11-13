"use client";

import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { minorMoney, minorPerUnit } from "@/lib/money/format";
import type { ViewResult } from "@/lib/views/types";
import { compact, longDay, niceStep, useWidth } from "../chart-utils";
import "./step-line.css";

const H = 300, M = { left: 54, right: 28, top: 14, bottom: 30 };

/** Draws any step_line data (D77): lines by tone, the band between two of them, the zero line, the lowest point and a readout for the pointer and the arrow keys. */
export function StepLine({ result }: { result: ViewResult<"step_line"> }) {
  const data = result.data, [ref, width] = useWidth<HTMLDivElement>();
  const [selected, setSelected] = useState<number | null>(null), [focused, setFocused] = useState(false);
  if (!data) return null;
  const { lines, low, band, days: n } = data, currency = result.currency, per = minorPerUnit(currency), format = (m: number) => minorMoney(m, currency);
  const plotW = Math.max(200, width - M.left - M.right), plotH = H - M.top - M.bottom;
  const all = lines.flatMap(l => l.points).map(m => m / per);
  const rawMin = Math.min(0, ...all), rawMax = Math.max(0, ...all);
  const step = niceStep(rawMax - rawMin, 5);
  const yMax = Math.ceil(rawMax / step) * step;
  const yMin = Math.floor(rawMin / step) * step - (rawMin < 0 && rawMin % step === 0 ? step : 0);
  const x = (i: number) => M.left + plotW * i / Math.max(1, n - 1), y = (m: number) => M.top + (yMax - m / per) * plotH / (yMax - yMin || 1);
  const ticks: number[] = []; for (let v = yMin; v <= yMax + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  const path = (values: readonly number[]) => values.slice(1).reduce((s, value, i) => `${s} H${x(i + 1)} V${y(value)}`, `M${x(0)} ${y(values[0])}`);
  const lineOf = (key: string) => lines.find(l => l.key === key);
  const top = band ? lineOf(band[0]) : undefined, bottom = band ? lineOf(band[1]) : undefined;
  const bandPath = top && bottom ? `${path(top.points)} V${y(bottom.points[n - 1])} ${bottom.points.slice(0, -1).reduceRight((s, value, i) => `${s} V${y(value)} H${x(i)}`, "")} Z` : null;
  const lowX = x(low.index), lowY = y(low.minor);
  // What makes the low point, wrapped at ", then" so it never runs past the plot.
  const subMax = Math.max(20, Math.floor((width - M.left - 12) / 6.1));
  const fitsBelow = (count: number) => lowY + 24 + 16 * count < M.top + plotH + 14;
  const wrapped = low.sub.reduce<string[]>((rows, part) => {
    const last = rows.length - 1;
    if (last < 0) return [part];
    if (`${rows[last]}, then ${part}`.length <= subMax) rows[last] = `${rows[last]}, then ${part}`;
    else { rows[last] = `${rows[last]},`; rows.push(`then ${part}`); }
    return rows;
  }, []);
  // Wrapped lines with no room under the low point are left to the day's readout and the table.
  const subLines = wrapped.length > 1 && !fitsBelow(wrapped.length) ? [] : wrapped;
  // The label starts at the low point and slides left only as far as it must to stay inside the plot.
  const labelW = Math.max(low.label.length * 7.4, ...subLines.map(line => line.length * 6.1));
  const labelX = Math.max(M.left + 4, Math.min(lowX - 2, width - 8 - labelW));
  const labelY = fitsBelow(subLines.length) ? lowY + 22 : lowY - 12 - 16 * subLines.length;
  // Name the band's two lines where they are furthest apart, clear of the low label; without a band each line is named at its end.
  let gapAt = -1;
  if (top && bottom) {
    const labelLeft = labelX - 8, labelRight = labelX + labelW;
    bottom.points.forEach((v, i) => {
      const cx = x(i);
      if (cx < M.left + 70 || cx > M.left + plotW - 60 || (cx + 64 > labelLeft && cx - 8 < labelRight)) return;
      if (gapAt < 0 || top.points[i] - v > top.points[gapAt] - bottom.points[gapAt]) gapAt = i;
    });
  }
  const showGap = gapAt >= 0 && (top!.points[gapAt] - bottom!.points[gapAt]) / per > step * 0.6 && selected === null;
  const directOf = (key: string) => data.direct.find(d => d.line === key)?.text;
  const move = (next: number) => setSelected(Math.max(0, Math.min(n - 1, next)));
  const onPointer = (event: PointerEvent<HTMLDivElement>) => { const rect = event.currentTarget.getBoundingClientRect(); move(Math.round((event.clientX - rect.left - M.left) / plotW * (n - 1))); };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.key === "ArrowRight" ? (selected ?? -1) + 1 : event.key === "ArrowLeft" ? (selected ?? 1) - 1 : event.key === "Home" ? 0 : event.key === "End" ? n - 1 : null;
    if (target === null) return;
    event.preventDefault(); move(target);
  };
  const day = selected === null ? null : data.dayWords[selected];
  const tipLeft = selected === null ? 0 : x(selected) > width / 2 ? Math.max(8, x(selected) - 14 - 250) : Math.min(width - 258, x(selected) + 14);
  const readout = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
  // A ghost line (the days as they are now, under a what-if) gets its own lowest point and is named by the legend, not at its end; without one nothing here draws.
  const ghost = lines.find(l => l.tone === "ghost"), ghostLow = ghost ? ghost.points.reduce((best, v, i) => v < ghost.points[best] ? i : best, 0) : 0;
  const drawn = [...lines].reverse(); // the first line (the one that matters) is painted last, on top
  return <div className="sl-chart" ref={ref}>
    <div className="sl-legend">{lines.map(l => <span key={l.key}><i className={`sl-t-${l.tone}`} />{l.label}</span>)}{bandPath && <span><i className="sl-key-band" />Depends on when they pay</span>}</div>
    <div className="sl-plot" tabIndex={0} role="group" aria-label={result.aria} onPointerMove={onPointer} onPointerLeave={() => { if (!focused) setSelected(null); }} onKeyDown={onKey} onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setSelected(null); }}>
      <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} aria-hidden="true">
        {ticks.map(v => <g key={v}><line className={v === 0 ? "sl-base" : "sl-grid"} x1={M.left} x2={M.left + plotW} y1={y(v * per)} y2={y(v * per)} /><text className="sl-axis" x={M.left - 8} y={y(v * per) + 4} textAnchor="end">{compact(v, currency)}</text></g>)}
        {data.marks.map(mark => <line key={`${mark.index}-${mark.label}`} className="sl-mark" x1={x(mark.index)} x2={x(mark.index)} y1={M.top} y2={M.top + plotH}><title>{mark.label}</title></line>)}
        {bandPath && <path className="sl-band" d={bandPath} />}
        {drawn.map(l => <path key={l.key} className={`sl-line sl-t-${l.tone}`} d={path(l.points)} />)}
        {showGap && top && bottom && <><text className="sl-direct" x={x(gapAt) + 6} y={y(top.points[gapAt]) - 6}>{directOf(top.key)}</text><text className="sl-direct" x={x(gapAt) + 6} y={y(bottom.points[gapAt]) + 18}>{directOf(bottom.key)}</text></>}
        {!band && !ghost && lines.map(l => directOf(l.key) && <text key={l.key} className="sl-direct" x={x(n - 1)} y={y(l.points[n - 1]) - 8} textAnchor="end">{directOf(l.key)}</text>)}
        {data.xTicks.map(tick => <text className="sl-axis" key={tick.index} x={x(tick.index)} y={H - 8} textAnchor={tick.index === 0 ? "start" : "middle"}>{tick.label}</text>)}
        {ghost && <circle className="sl-dot-ghost" cx={x(ghostLow)} cy={y(ghost.points[ghostLow])} r="4" />}
        <circle className={low.short ? "sl-dot-short" : "sl-dot-low"} cx={lowX} cy={lowY} r="5" />
        <text className={low.short ? "sl-low sl-low-short" : "sl-low"} x={labelX} y={labelY}>{low.label}</text>
        {subLines.map((line, index) => <text className="sl-low-sub" key={`${index}-${line}`} x={labelX} y={labelY + 16 * (index + 1)}>{line}</text>)}
        {selected !== null && <><line className="sl-cross" x1={x(selected)} x2={x(selected)} y1={M.top} y2={M.top + plotH} />{drawn.map(l => <circle key={l.key} className={`sl-pt sl-t-${l.tone}`} cx={x(selected)} cy={y(l.points[selected])} r={l === lines[0] ? 4.5 : 4} />)}</>}
      </svg>
      {selected !== null && day && <div className="sl-tip" style={{ left: tipLeft, top: 6 }}>
        <strong>{longDay(day.date)}</strong>
        {lines.map(l => <p key={l.key}><i className={`sl-sw sl-t-${l.tone}`} /><b className={l.points[selected] < 0 ? "sl-neg" : undefined}>{format(l.points[selected])}</b> <span>{readout(directOf(l.key) ?? l.label)}</span></p>)}
        <div className="sl-tip-what">{day.lines.map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}</div>
      </div>}
    </div>
    <div className="sl-sr" aria-live="polite">{day === null || selected === null ? "" : `${day.label}: ${lines.map(l => `${readout(directOf(l.key) ?? l.label)} ${format(l.points[selected])}`).join("; ")}. ${day.lines.join("; ")}.`}</div>
  </div>;
}
