"use client";

import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatter, ordinal } from "@/lib/money/format";
import { forecastCosts } from "@/lib/money/forecast-causes";
import { addDays, low, series, timeline } from "@/lib/money/runway";
import type { MoneyState } from "@/lib/money/types";
import { compact, longDay, niceStep, useWidth } from "./chart-utils";

/** Everything the Forecast shows, from the engine's two series and timelines. */
export function forecastModel(state: MoneyState) {
  const format = formatter(state.homeCurrency), late = series(state, "worst"), usual = series(state, "expected");
  const lateEvents = timeline(state, "worst"), usualEvents = timeline(state, "expected");
  const date = (i: number) => addDays(state.today, i);
  const pending = new Map(state.bills.filter(bill => bill.status === "pending").map(bill => [bill.id, bill]));
  const lineFor = (event: ReturnType<typeof timeline>[number]) => {
    if (event.pending) { const bill = pending.get(event.id); return `${event.label} ${format(bill ? bill.amount : -event.amount)} waits in To check and is not counted yet`; }
    if (event.uncounted) return `${event.label}: amount not known`;
    return `${event.label} ${event.amount < 0 ? "−" : "+"}${format(Math.abs(event.amount))}`;
  };
  const on = (events: typeof lateEvents, day: string) => events.filter(event => event.date === day).map(lineFor);
  /** The lines for a day: one list when late and on time agree, two when they differ, empty when nothing happens. */
  const words = (i: number): { same: string[] } | { late: string[]; usual: string[] } => {
    const a = on(lateEvents, date(i)), b = on(usualEvents, date(i));
    return a.join("|") === b.join("|") ? { same: a } : { late: a, usual: b };
  };
  const text = (i: number) => { const w = words(i); return "same" in w ? (w.same.join("; ") || "Nothing scheduled") : `If late: ${w.late.join("; ") || "nothing"}. If on time: ${w.usual.join("; ") || "nothing"}`; };
  const lo = low(late), hi = low(usual);
  const lowerFirst = (label: string) => /^[A-Z][a-z]+$/.test(label) ? label[0].toLowerCase() + label.slice(1) : label;
  const costs = forecastCosts(lateEvents, lo.date).map((event, index) => {
    const label = event.label.replace(/ statement$/, ""), day = event.date === lo.date ? "" : ` on the ${ordinal(Number(event.date.slice(8, 10)))}`;
    return `${index ? lowerFirst(label) : label} ${format(-event.amount)}${day}`;
  }).join(", then ");
  const eventDays = new Set([...lateEvents, ...usualEvents].map(event => event.date));
  const rows = late.map((_, i) => i).filter(i => i === 0 || eventDays.has(date(i)));
  return { format, late, usual, date, words, text, lo, hi, costs, rows, currency: state.homeCurrency };
}
export type ForecastModel = ReturnType<typeof forecastModel>;

const H = 300, M = { left: 54, right: 28, top: 14, bottom: 30 };

export function ForecastChart({ model }: { model: ForecastModel }) {
  const { late, usual, lo, format, currency } = model, n = late.length;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [selected, setSelected] = useState<number | null>(null), [focused, setFocused] = useState(false);
  const plotW = Math.max(200, width - M.left - M.right), plotH = H - M.top - M.bottom;
  const rawMin = Math.min(0, ...late, ...usual), rawMax = Math.max(0, ...late, ...usual);
  const step = niceStep(rawMax - rawMin, 5);
  const yMax = Math.ceil(rawMax / step) * step;
  const yMin = Math.floor(rawMin / step) * step - (rawMin < 0 && rawMin % step === 0 ? step : 0);
  const x = (i: number) => M.left + plotW * i / (n - 1), y = (v: number) => M.top + (yMax - v) * plotH / (yMax - yMin || 1);
  const ticks: number[] = []; for (let v = yMin; v <= yMax + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  const path = (values: readonly number[]) => values.slice(1).reduce((s, value, i) => `${s} H${x(i + 1)} V${y(value)}`, `M${x(0)} ${y(values[0])}`);
  const band = `${path(usual)} V${y(late[n - 1])} ${late.slice(0, -1).reduceRight((s, value, i) => `${s} V${y(value)} H${x(i)}`, "")} Z`;
  const short = lo.amount < 0;
  const lowText = `${short ? `Short ${format(-lo.amount)}` : `Lowest ${format(lo.amount)}`} on ${longDay(lo.date)}`;
  const lowX = x(lo.dayIndex), lowY = y(lo.amount);
  // What makes the low point, wrapped at ", then" so it never runs past the plot.
  const subMax = Math.max(20, Math.floor((width - M.left - 12) / 6.1));
  const fitsBelow = (lines: number) => lowY + 24 + 16 * lines < M.top + plotH + 14;
  const wrapped = model.costs ? model.costs.split(", then ").reduce<string[]>((lines, part) => {
    const last = lines.length - 1;
    if (last < 0) return [part];
    if (`${lines[last]}, then ${part}`.length <= subMax) lines[last] = `${lines[last]}, then ${part}`;
    else { lines[last] = `${lines[last]},`; lines.push(`then ${part}`); }
    return lines;
  }, []) : [];
  // Wrapped lines that have no room under the low point are left to the day's tooltip and the table.
  const subLines = wrapped.length > 1 && !fitsBelow(wrapped.length) ? [] : wrapped;
  // The label starts at the low point and slides left only as far as it must to stay inside the plot.
  const labelW = Math.max(lowText.length * 7.4, ...subLines.map(line => line.length * 6.1));
  const labelX = Math.max(M.left + 4, Math.min(lowX - 2, width - 8 - labelW));
  const below = fitsBelow(subLines.length);
  const labelY = below ? lowY + 22 : lowY - 12 - 16 * subLines.length;
  // Name the two lines where they are furthest apart, clear of the low label.
  const labelLeft = labelX - 8, labelRight = labelX + labelW;
  let gapAt = -1;
  late.forEach((v, i) => {
    const cx = x(i);
    if (cx < M.left + 70 || cx > M.left + plotW - 60 || (cx + 64 > labelLeft && cx - 8 < labelRight)) return;
    if (gapAt < 0 || usual[i] - v > usual[gapAt] - late[gapAt]) gapAt = i;
  });
  const showGap = gapAt >= 0 && usual[gapAt] - late[gapAt] > step * 0.6 && selected === null;
  const weekly = [0, 7, 14, 21, 28].filter(i => i < n);
  const move = (next: number) => setSelected(Math.max(0, Math.min(n - 1, next)));
  const onPointer = (event: PointerEvent<HTMLDivElement>) => { const rect = event.currentTarget.getBoundingClientRect(); move(Math.round((event.clientX - rect.left - M.left) / plotW * (n - 1))); };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.key === "ArrowRight" ? (selected ?? -1) + 1 : event.key === "ArrowLeft" ? (selected ?? 1) - 1 : event.key === "Home" ? 0 : event.key === "End" ? n - 1 : null;
    if (target === null) return;
    event.preventDefault(); move(target);
  };
  const w = selected === null ? null : model.words(selected);
  const tipLeft = selected === null ? 0 : x(selected) > width / 2 ? Math.max(8, x(selected) - 14 - 250) : Math.min(width - 258, x(selected) + 14);
  const summary = `Cash forecast for the next 30 days. ${short ? `If clients pay late you are ${format(-lo.amount)} short on ${longDay(lo.date)}` : `The lowest if clients pay late is ${format(lo.amount)} on ${longDay(lo.date)}`}. Use the left and right arrow keys to look at each day.`;
  return <div className="hv-chart" ref={ref}>
    <div className="hv-legend"><span><i className="hv-key-late" />If clients pay late (what safe to spend uses)</span><span><i className="hv-key-usual" />If they pay on time</span><span><i className="hv-key-area" />Depends on when they pay</span></div>
    <div className="hv-plot" tabIndex={0} role="group" aria-label={summary} onPointerMove={onPointer} onPointerLeave={() => { if (!focused) setSelected(null); }} onKeyDown={onKey} onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setSelected(null); }}>
      <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} aria-hidden="true">
        {ticks.map(v => <g key={v}><line className={v === 0 ? "hv-base" : "hv-grid"} x1={M.left} x2={M.left + plotW} y1={y(v)} y2={y(v)} /><text className="hv-axis" x={M.left - 8} y={y(v) + 4} textAnchor="end">{compact(v, currency)}</text></g>)}
        <path className="hv-band" d={band} />
        <path className="hv-line-usual" d={path(usual)} /><path className="hv-line-late" d={path(late)} />
        {showGap && <><text className="hv-direct" x={x(gapAt) + 6} y={y(usual[gapAt]) - 6}>If on time</text><text className="hv-direct" x={x(gapAt) + 6} y={y(late[gapAt]) + 18}>If late</text></>}
        {weekly.map(i => <text className="hv-axis" key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : "middle"}>{i === 0 ? "Today" : longDay(model.date(i)).slice(5)}</text>)}
        <circle className={short ? "hv-dot-short" : "hv-dot-low"} cx={lowX} cy={lowY} r="5" />
        <text className={short ? "hv-low hv-low-short" : "hv-low"} x={labelX} y={labelY}>{lowText}</text>
        {subLines.map((line, index) => <text className="hv-low-sub" key={line} x={labelX} y={labelY + 16 * (index + 1)}>{line}</text>)}
        {selected !== null && <><line className="hv-cross" x1={x(selected)} x2={x(selected)} y1={M.top} y2={M.top + plotH} /><circle className="hv-pt-usual" cx={x(selected)} cy={y(usual[selected])} r="4" /><circle className="hv-pt-late" cx={x(selected)} cy={y(late[selected])} r="4.5" /></>}
      </svg>
      {selected !== null && w && <div className="hv-tip" style={{ left: tipLeft, top: 6 }}>
        <strong>{longDay(model.date(selected))}</strong>
        <p><i className="hv-sw-late" /><b className={late[selected] < 0 ? "hv-neg" : undefined}>{format(late[selected])}</b> <span>if late</span></p>
        <p><i className="hv-sw-usual" /><b>{format(usual[selected])}</b> <span>if on time</span></p>
        <div className="hv-tip-what">{"same" in w ? (w.same.length ? w.same.map(line => <p key={line}>{line}</p>) : <p>Nothing scheduled</p>) : <><p>If late: {w.late.join("; ") || "nothing"}</p><p>If on time: {w.usual.join("; ") || "nothing"}</p></>}</div>
      </div>}
    </div>
    <div className="hv-sr" aria-live="polite">{selected === null ? "" : `${longDay(model.date(selected))}: if late ${format(late[selected])}; if on time ${format(usual[selected])}. ${model.text(selected)}.`}</div>
  </div>;
}
