"use client";

import { useState } from "react";
import type { Currency } from "@/lib/catalogue/types";
import { minorMoney, minorPerUnit } from "@/lib/money/format";
import { compact, niceStep, useWidth } from "@/components/home/chart-utils";

export type MonthColumn = { month: string; name: string; spent: number; coming: number; total: number; current: boolean };

const H = 270, M = { left: 54, right: 12, top: 28, bottom: 30 };

export function MonthColumns({ months, currency }: { months: MonthColumn[]; currency: Currency }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const format = (value: number) => minorMoney(value, currency);
  const plotW = Math.max(200, width - M.left - M.right), plotH = H - M.top - M.bottom;
  const top = Math.max(1, ...months.map(month => month.total)), step = niceStep(top, 4), max = Math.ceil(top / step) * step;
  const y = (v: number) => M.top + plotH - (v / max) * plotH;
  const ticks: number[] = []; for (let v = 0; v <= max + step / 2; v += step) ticks.push(v);
  const col = plotW / months.length, barW = Math.min(64, col * 0.5);
  const current = months.find(month => month.current);
  const hovered = active === null ? null : months[active];
  const tipLeft = active === null ? 0 : Math.min(width - 218, Math.max(8, M.left + col * (active + 0.5) - 105));
  return <div className="hv-chart" ref={ref}>
    <div className="hv-legend"><span><i className="hv-sq-late" />Spent so far</span><span><i className="hv-sq-coming" />Still to come{current ? ` in ${current.name}` : ""}</span></div>
    <div className="hv-plot">
      <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="group" aria-label="Monthly spending. Use Tab to move between months.">
        {ticks.map(v => <g key={v}><line className={v === 0 ? "hv-base" : "hv-grid"} x1={M.left} x2={M.left + plotW} y1={y(v)} y2={y(v)} /><text className="hv-axis" x={M.left - 8} y={y(v) + 4} textAnchor="end">{compact(v / minorPerUnit(currency), currency)}</text></g>)}
        {months.map((month, i) => {
          const cx = M.left + col * (i + 0.5), spentH = (month.spent / max) * plotH, comingH = (month.coming / max) * plotH;
          return <g key={month.month} className={active === i ? "hv-col hv-col-on" : "hv-col"} tabIndex={0} role="img" aria-label={`${month.name}: ${format(month.total)}. Spent ${format(month.spent)}${month.current ? `, still to come ${format(month.coming)}` : ""}.`}
            onPointerEnter={() => setActive(i)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}>
            <rect className="hv-hit" x={cx - col / 2} y={M.top} width={col} height={plotH + M.bottom} />
            {spentH > 0 && <rect className="hv-seg-late" x={cx - barW / 2} y={y(month.spent)} width={barW} height={spentH} />}
            {comingH > 0 && <rect className="hv-seg-coming" x={cx - barW / 2} y={y(month.spent + month.coming)} width={barW} height={Math.max(0, comingH - 2)} />}
            <text className="hv-bar-total" x={cx} y={y(month.total) - 7} textAnchor="middle">{format(month.total)}</text>
            <text className="hv-axis" x={cx} y={H - 8} textAnchor="middle">{month.name.slice(0, 3)}</text>
          </g>;
        })}
      </svg>
      {hovered && <div className="hv-tip" style={{ left: tipLeft, top: 4 }} role="status"><strong>{hovered.name}</strong><p>Spent <b>{format(hovered.spent)}</b></p>{hovered.current && <p>Still to come <b>{format(hovered.coming)}</b></p>}<p>Total <b>{format(hovered.total)}</b></p></div>}
    </div>
  </div>;
}
