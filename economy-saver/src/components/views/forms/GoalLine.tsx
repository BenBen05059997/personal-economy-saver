"use client";

import { daysBetween } from "@/lib/money/dates";
import { dayLabel, minorPerUnit } from "@/lib/money/format";
import type { ViewResult } from "@/lib/views/types";
import { compact, niceStep, useWidth } from "../chart-utils";
import "@/components/home/home-views.css";
import "./goal-line.css";

const H = 280, M = { left: 58, right: 24, top: 20, bottom: 30 };

/** The goal-line form (D77): the straight line the goal expects (nothing at the start, the target on its date), what is saved today as a dot, and a dashed line from that dot to the day this pace reaches the target. One amount axis. */
export function GoalLine({ result }: { result: ViewResult<"goal_line"> }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const { start, target, today, expected, projection } = result.data!, currency = result.currency, per = minorPerUnit(currency);
  const span = Math.max(1, daysBetween(start.date, target.date));
  // A pace that lands long after the target date is cut at the axis edge (the label still names its day).
  const reach = projection ? daysBetween(start.date, projection.date) : span, axisDays = Math.max(span, Math.min(reach, span * 2));
  const cut = projection !== null && reach > axisDays;
  const plotW = Math.max(220, width - M.left - M.right), plotH = H - M.top - M.bottom;
  const todayDay = Math.min(axisDays, Math.max(0, daysBetween(start.date, today.date)));
  const top = Math.max(target.minor, today.minor) / per, step = niceStep(top, 4), yMax = Math.ceil(top / step) * step;
  const x = (d: number) => M.left + plotW * d / axisDays, y = (m: number) => M.top + plotH - (m / per) / yMax * plotH;
  const ticks: number[] = []; for (let v = 0; v <= yMax + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  const goalDay = Math.min(span, axisDays), reachX = x(cut ? axisDays : reach), reachY = cut ? y(today.minor + (target.minor - today.minor) * (axisDays - todayDay) / Math.max(1, reach - todayDay)) : y(target.minor);
  const labelRight = x(todayDay) < M.left + plotW * 0.55;
  // The axis names the target day, today and the start, dropping any that would touch one already named.
  const xTicks = [{ label: dayLabel(target.date), at: span }, { label: "Today", at: todayDay }, { label: dayLabel(start.date), at: 0 }, ...(projection && !cut && reach > span ? [{ label: dayLabel(projection.date), at: reach }] : [])];
  const named = xTicks.filter((tick, i) => xTicks.slice(0, i).every(other => Math.abs(x(other.at) - x(tick.at)) > 56));
  // The higher of the two points is named above its dot and the lower below it (beside it when the axis is in the way), so the names never meet.
  const savedHigher = today.minor >= expected.minor, bottom = M.top + plotH - 6, side = labelRight ? 12 : -12, anchor = labelRight ? "start" : "end";
  const place = (minor: number, higher: boolean) => higher ? { dx: side, y: y(minor) - 10 } : y(minor) + 18 <= bottom ? { dx: side, y: y(minor) + 18 } : { dx: side, y: y(minor) + 4 };
  const savedAt = place(today.minor, savedHigher), expectedAt = place(expected.minor, !savedHigher);
  return <div className="hv-chart gl-chart" ref={ref}>
    <div className="hv-legend">
      <span><i className="gl-key gl-key-saved" />Saved today</span>
      <span><i className="gl-key gl-key-goal" />Where the goal expects you</span>
      {projection && <span><i className="gl-key gl-key-pace" />At this pace</span>}
    </div>
    <div className="hv-plot gl-plot" role="img" aria-label={result.aria}>
      <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} aria-hidden="true">
        {ticks.map(v => <g key={v}><line className={v === 0 ? "gl-base" : "hv-grid"} x1={M.left} x2={M.left + plotW} y1={y(v * per)} y2={y(v * per)} /><text className="gl-axis" x={M.left - 8} y={y(v * per) + 4} textAnchor="end">{compact(v, currency)}</text></g>)}
        <line className="gl-target" x1={M.left} x2={M.left + plotW} y1={y(target.minor)} y2={y(target.minor)} />
        <text className="gl-label" x={M.left + plotW} y={y(target.minor) - 8} textAnchor="end">{target.label}</text>
        <line className="gl-today" x1={x(todayDay)} x2={x(todayDay)} y1={M.top} y2={M.top + plotH} />
        <line className="gl-goal" x1={x(0)} y1={y(0)} x2={x(goalDay)} y2={y(target.minor * goalDay / span)}><title>{expected.label}</title></line>
        {projection && today.minor < target.minor && <line className="gl-pace" x1={x(todayDay)} y1={y(today.minor)} x2={reachX} y2={reachY}><title>{projection.label}</title></line>}
        {projection && !cut && <circle className="gl-reach" cx={reachX} cy={reachY} r={4.5}><title>{projection.label}</title></circle>}
        <circle className="gl-expected" cx={x(todayDay)} cy={y(expected.minor)} r={4}><title>{expected.label}</title></circle>
        <circle className="gl-saved" cx={x(todayDay)} cy={y(today.minor)} r={5.5}><title>{today.label}</title></circle>
        <text className="gl-label gl-label-saved" x={x(todayDay) + savedAt.dx} y={savedAt.y} textAnchor={anchor}>{today.label}</text>
        <text className="gl-sub" x={x(todayDay) + expectedAt.dx} y={expectedAt.y} textAnchor={anchor}>{expected.label}</text>
        {cut && projection && <text className="gl-sub" x={M.left + plotW} y={y(target.minor) + 22} textAnchor="end">{`${projection.label} →`}</text>}
        {named.map(tick => <text className="gl-axis" key={tick.label} x={x(tick.at)} y={H - 8} textAnchor={tick.at === 0 ? "start" : tick.at === span ? "end" : "middle"}>{tick.label}</text>)}
      </svg>
    </div>
  </div>;
}
