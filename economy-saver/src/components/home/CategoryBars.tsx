"use client";

import { useState } from "react";
import type { Currency } from "@/lib/catalogue/types";
import { minorMoney, minorPerUnit } from "@/lib/money/format";
import { compact, niceStep } from "./chart-utils";

export type CategoryRow = { key: string; label: string; note?: string; spent: number; coming: number; total: number; previous: number };

export function CategoryBars({ rows, currency, lastName }: { rows: CategoryRow[]; currency: Currency; lastName: string }) {
  const [active, setActive] = useState<string | null>(null);
  const format = (value: number) => minorMoney(value, currency);
  const top = Math.max(1, ...rows.flatMap(row => [row.total, row.previous])), step = niceStep(top, 4), max = Math.ceil(top / step) * step;
  const ticks: number[] = []; for (let v = 0; v <= max + step / 2; v += step) ticks.push(v);
  const pct = (value: number) => `${(value / max) * 100}%`;
  const row = rows.find(item => item.key === active);
  return <div className="hv-cats">
    <div className="hv-legend"><span><i className="hv-sq-late" />Spent so far</span><span><i className="hv-sq-coming" />Still to come (bills and statements you know of)</span><span><i className="hv-key-tick" />{lastName}</span></div>
    <div className="hv-cat-axis" aria-hidden="true"><span />
      <div>{ticks.map(v => <span key={v} style={{ left: pct(v) }}>{compact(v / minorPerUnit(currency), currency)}</span>)}</div><span /></div>
    <ul className="hv-cat-list">
      {rows.map(item => <li key={item.key} className={active === item.key ? "hv-cat hv-cat-on" : "hv-cat"} tabIndex={0}
        aria-label={`${item.label}: ${format(item.total)} this month. Spent ${format(item.spent)}, still to come ${format(item.coming)}, ${lastName} ${format(item.previous)}.`}
        onPointerEnter={() => setActive(item.key)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(item.key)} onBlur={() => setActive(null)}>
        <span className="hv-cat-name"><b>{item.label}</b>{item.note && <small>{item.note}</small>}</span>
        <span className="hv-cat-track">
          {ticks.map(v => <i key={v} className="hv-vgrid" style={{ left: pct(v) }} />)}
          <span className="hv-cat-bar"><span className="hv-seg-late" style={{ width: pct(item.spent) }} /><span className="hv-seg-coming" style={{ width: pct(item.coming) }} /></span>
          <i className="hv-tick" style={{ left: pct(item.previous) }} />
          {active === item.key && row && <span className="hv-tip hv-cat-tip" role="status"><strong>{row.label}</strong><span>Spent <b>{format(row.spent)}</b></span><span>Still to come <b>{format(row.coming)}</b></span><span>{lastName} <b>{format(row.previous)}</b></span></span>}
        </span>
        <span className="hv-cat-total"><b>{format(item.total)}</b><small>vs {format(item.previous)} last month</small></span>
      </li>)}
    </ul>
  </div>;
}
