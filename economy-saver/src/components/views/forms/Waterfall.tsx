"use client";

import { useState } from "react";
import { minorPerUnit } from "@/lib/money/format";
import type { ViewResult } from "@/lib/views/types";
import { compact, niceStep, useWidth } from "../chart-utils";
import "./waterfall.css";

const H = 300, M = { left: 54, right: 12, top: 30, bottom: 46 };
const LINE = 14;

/** Cuts a label into at most two lines of about `max` characters at its spaces. */
function lines(label: string, max: number, most: number): string[] {
  const out: string[] = [""];
  for (const word of label.split(" ")) {
    const last = out[out.length - 1];
    if (last === "" || `${last} ${word}`.length <= max || out.length === most) out[out.length - 1] = last === "" ? word : `${last} ${word}`;
    else out.push(word);
  }
  return out;
}

/** The waterfall form (D77): each step floats from where the running total was to where it is now; starts, subtotals and the total stand on zero. A step that is a guess (money still owed to you) is dashed and says "about". */
export function Waterfall({ result }: { result: ViewResult<"waterfall"> }) {
  const [ref, width] = useWidth<HTMLDivElement>(), [active, setActive] = useState<number | null>(null);
  const data = result.data!, { steps } = data, per = minorPerUnit(result.currency);
  const bars = steps.reduce<{ from: number; to: number; level: number }[]>((out, step) => {
    const prev = out.length ? out[out.length - 1].level : 0;
    const level = step.kind === "plus" || step.kind === "minus" ? prev + step.minor : step.minor;
    out.push(step.kind === "plus" || step.kind === "minus" ? { from: prev, to: level, level } : { from: 0, to: level, level });
    return out;
  }, []);
  const values = bars.flatMap(bar => [bar.from, bar.to, 0]).map(v => v / per);
  const rawMin = Math.min(...values), rawMax = Math.max(...values), step = niceStep(rawMax - rawMin, 4);
  const yMax = Math.ceil(rawMax / step) * step, yMin = Math.floor(rawMin / step) * step;
  const plotW = Math.max(240, width - M.left - M.right), col = plotW / steps.length, barW = Math.min(64, col * 0.56);
  // In a narrow panel the amounts are written short (¥128k) and the names run to three lines, so nothing collides.
  const narrow = col < 80, perLine = Math.max(6, Math.floor(col / (narrow ? 6 : 6.6))), names = steps.map(s => lines(s.label, perLine, narrow ? 3 : 2));
  const bottom = 18 + LINE * Math.max(...names.map(n => n.length)) + 4, height = H - M.bottom + bottom, plotH = H - M.top - M.bottom;
  const amount = (s: (typeof steps)[number]) => narrow ? `${s.minor < 0 ? "−" : s.kind === "plus" ? "+" : ""}${compact(Math.abs(s.minor) / per, result.currency)}` : `${s.about ? "about " : ""}${s.amountLabel}`;
  const y = (minor: number) => M.top + (yMax - minor / per) * plotH / (yMax - yMin || 1);
  const ticks: number[] = []; for (let v = yMin; v <= yMax + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  const kinds = new Set(steps.map(s => s.kind)), anyAbout = steps.some(s => s.about);
  const cx = (i: number) => M.left + col * (i + 0.5);
  const shown = active === null ? null : steps[active];
  const tipLeft = active === null ? 0 : Math.min(width - 218, Math.max(8, cx(active) - 105));
  return <div className="wf-chart" ref={ref}>
    <div className="wf-legend">
      <span><i className="wf-key wf-total" />Money you hold</span>
      {kinds.has("plus") && <span><i className="wf-key wf-plus" />Comes in</span>}
      {kinds.has("minus") && <span><i className="wf-key wf-minus" />Goes out</span>}
      {anyAbout && <span><i className="wf-key wf-plus wf-about" />About, not paid yet</span>}
    </div>
    <div className="wf-plot">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label={result.aria}>
        {ticks.map(v => <g key={v}><line className={v === 0 ? "wf-base" : "wf-grid"} x1={M.left} x2={M.left + plotW} y1={y(v * per)} y2={y(v * per)} /><text className="wf-axis" x={M.left - 8} y={y(v * per) + 4} textAnchor="end">{compact(v, result.currency)}</text></g>)}
        {steps.slice(0, -1).map((_, i) => <line key={`c${i}`} className="wf-link" x1={cx(i) + barW / 2} x2={cx(i + 1) - barW / 2} y1={y(bars[i].level)} y2={y(bars[i].level)} />)}
        {steps.map((s, i) => {
          const top = Math.min(y(bars[i].from), y(bars[i].to)), h = Math.max(1.5, Math.abs(y(bars[i].from) - y(bars[i].to)));
          const tone = s.kind === "plus" ? "plus" : s.kind === "minus" ? "minus" : "total";
          return <g key={s.key} className={active === i ? "wf-step wf-on" : "wf-step"} tabIndex={0} role="img" aria-label={`${s.label}: ${s.amountLabel}${s.about ? ", about" : ""}`}
            onPointerEnter={() => setActive(i)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}>
            <rect className="wf-hit" x={cx(i) - col / 2} y={M.top - 24} width={col} height={plotH + bottom + 24} />
            <rect className={`wf-bar wf-${tone}${s.about ? " wf-about" : ""}`} x={cx(i) - barW / 2} y={top} width={barW} height={h} />
            <text className="wf-value" x={cx(i)} y={top - 7} textAnchor="middle">{amount(s)}</text>
            {names[i].map((text, k) => <text key={k} className={s.kind === "plus" || s.kind === "minus" ? "wf-axis" : "wf-axis wf-name"} x={cx(i)} y={H - M.bottom + 18 + LINE * k} textAnchor="middle">{text}</text>)}
          </g>;
        })}
      </svg>
      {shown && active !== null && <div className="wf-tip" style={{ left: tipLeft, top: 4 }} role="status"><strong>{shown.label}</strong><p><b>{shown.amountLabel}</b>{shown.about && <span>about: invoices you have sent, at today&apos;s rate</span>}</p>
        {(shown.kind === "subtotal" || shown.kind === "total") && <p><span>Running total</span> <b>{shown.amountLabel}</b></p>}</div>}
    </div>
  </div>;
}
