"use client";

import { Fragment, useState } from "react";
import { minorMoney, minorPerUnit } from "@/lib/money/format";
import type { RankedRow, ViewResult } from "@/lib/views/types";
import { compact, niceStep } from "../chart-utils";
import "./ranked-bars.css";

/** The ranked-bars form (D73): a bar per row made of the data's segments, an optional tick (last month) with its own legend, child rows (own categories, D75) behind a disclosure, and a readout per row. Draws any `ranked_bars` result. */
export function RankedBars({ result }: { result: ViewResult<"ranked_bars"> }) {
  const data = result.data!;
  const [active, setActive] = useState<string | null>(null);
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set(data.open ? [data.open] : [])); // which rows show their children; kept here, not stored
  const toggle = (key: string) => setOpened(previous => { const next = new Set(previous); if (!next.delete(key)) next.add(key); return next; });
  const everyRow = data.rows.flatMap(row => [row, ...(row.children ?? [])]);
  const top = Math.max(1, ...everyRow.flatMap(row => [row.total, row.tick ?? 0])), step = niceStep(top, 4, minorPerUnit(result.currency)), max = Math.ceil(top / step) * step;
  const ticks: number[] = []; for (let v = 0; v <= max + step / 2; v += step) ticks.push(v);
  if (everyRow.every(row => row.total === 0 && (row.tick ?? 0) === 0)) ticks.splice(1); // nothing to measure: the baseline alone
  const pct = (value: number) => `${(value / max) * 100}%`;
  const row = everyRow.find(item => item.key === active);
  const hasKids = data.rows.some(item => (item.children ?? []).length > 0);
  const short = (legend: string) => legend.split(" (")[0];
  const line = (item: RankedRow, thin: boolean, disclosure?: { open: boolean; onToggle: () => void }) => <li key={item.key} className={`${thin ? "rb-cat rb-cat-thin" : "rb-cat"}${active === item.key ? " rb-cat-on" : ""}`} tabIndex={0}
    aria-label={item.aria}
    onPointerEnter={() => setActive(item.key)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(item.key)} onBlur={() => setActive(null)}>
    <span className="rb-cat-name">
      {disclosure && <button type="button" className="rb-cat-toggle" aria-expanded={disclosure.open} aria-label={`${disclosure.open ? "Hide" : "Show"} your categories in ${item.label}`} onClick={disclosure.onToggle}>
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></button>}
      {!disclosure && !thin && hasKids && <span className="rb-cat-gap" aria-hidden="true" />}
      <span className="rb-cat-label"><b>{item.label}</b>{item.note && <small>{item.note}</small>}</span>
    </span>
    <span className="rb-cat-track">
      {ticks.map(v => <i key={v} className="rb-vgrid" style={{ left: pct(v) }} />)}
      <span className="rb-cat-bar">{data.segments.map((segment, index) => item.parts[index] > 0 && <span key={segment.key} className={`rb-seg-${segment.tone}`} style={{ width: pct(item.parts[index]) }} />)}</span>
      {item.tick !== null && <i className="rb-tick" style={{ left: pct(item.tick) }} />}
      {active === item.key && row && <span className="hv-tip rb-cat-tip" role="status"><strong>{row.label}</strong>
        {data.segments.map((segment, index) => <span key={segment.key}>{short(segment.legend)} <b>{minorMoney(row.parts[index], result.currency)}</b></span>)}
        {data.tick && row.tickLabel !== null && <span>{data.tick.legend} <b>{row.tickLabel}</b></span>}</span>}
    </span>
    <span className="rb-cat-total"><b>{item.totalLabel}</b><small>{item.sub}</small></span>
  </li>;
  return <div className="rb-cats" role="group" aria-label={result.aria}>
    <div className="hv-legend">{data.segments.map(segment => <span key={segment.key}><i className={`rb-sq-${segment.tone}`} />{segment.legend}</span>)}{data.tick && <span><i className="rb-key-tick" />{data.tick.legend}</span>}</div>
    <div className="rb-cat-axis" aria-hidden="true"><span />
      <div>{ticks.map(v => <span key={v} style={{ left: pct(v) }}>{compact(v / minorPerUnit(result.currency), result.currency)}</span>)}</div><span /></div>
    <ul className="rb-cat-list">
      {data.rows.map(item => {
        const kids = item.children ?? [], open = kids.length > 0 && opened.has(item.key);
        return <Fragment key={item.key}>
          {line(item, false, kids.length > 0 ? { open, onToggle: () => toggle(item.key) } : undefined)}
          {open && kids.map(kid => line(kid, true))}
        </Fragment>;
      })}
    </ul>
  </div>;
}
