"use client";

import { Fragment, useState } from "react";
import type { Currency } from "@/lib/catalogue/types";
import { minorMoney, minorPerUnit } from "@/lib/money/format";
import { compact, niceStep } from "@/components/home/chart-utils";

export type CategoryRow = { key: string; label: string; note?: string; spent: number; coming: number; total: number; previous: number; business?: number; personal?: number; children?: CategoryRow[] };

/** One of the two parts of a bar: `tone` picks the colour class, `word` is how a sentence says it, `legend` the legend text. */
export type BarSegment = { tone: "late" | "coming" | "personal"; word: string; legend: string; value: (row: CategoryRow) => number };

const SPENT_SEGMENTS: [BarSegment, BarSegment] = [
  { tone: "late", word: "spent", legend: "Spent so far", value: row => row.spent },
  { tone: "coming", word: "still to come", legend: "Still to come (bills and statements you know of)", value: row => row.coming },
];
export const BUSINESS_SEGMENTS: [BarSegment, BarSegment] = [
  { tone: "late", word: "business", legend: "Business", value: row => row.business ?? 0 },
  { tone: "personal", word: "personal", legend: "Personal", value: row => row.personal ?? 0 },
];

const cap = (word: string) => word[0].toUpperCase() + word.slice(1);

/** `note` is the small line under a row's total; it defaults to the comparison with the month before. `when` and `before` are how a past month says "this month" and "last month" ("in October", "the month before"). */
export function CategoryBars({ rows, currency, lastName, segments = SPENT_SEGMENTS, note, when = "this month", before = "last month" }: { rows: CategoryRow[]; currency: Currency; lastName: string; segments?: [BarSegment, BarSegment]; note?: (row: CategoryRow) => string; when?: string; before?: string }) {
  const [active, setActive] = useState<string | null>(null);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set()); // D75: which rows show their own categories; kept here, not stored
  const toggle = (key: string) => setOpened(previous => { const next = new Set(previous); if (!next.delete(key)) next.add(key); return next; });
  const format = (value: number) => minorMoney(value, currency);
  const everyRow = rows.flatMap(row => [row, ...(row.children ?? [])]);
  const top = Math.max(1, ...everyRow.flatMap(row => [row.total, row.previous])), step = niceStep(top, 4), max = Math.ceil(top / step) * step;
  const ticks: number[] = []; for (let v = 0; v <= max + step / 2; v += step) ticks.push(v);
  const pct = (value: number) => `${(value / max) * 100}%`;
  const row = everyRow.find(item => item.key === active);
  const [first, second] = segments;
  const sub = note ?? ((item: CategoryRow) => `vs ${format(item.previous)} ${before}`);
  const hasKids = rows.some(row => (row.children ?? []).length > 0);
  const line = (item: CategoryRow, thin: boolean, disclosure?: { open: boolean; onToggle: () => void }) => <li key={item.key} className={`${thin ? "hv-cat hv-cat-thin" : "hv-cat"}${active === item.key ? " hv-cat-on" : ""}`} tabIndex={0}
    aria-label={`${item.label}: ${format(item.total)} ${when}. ${cap(first.word)} ${format(first.value(item))}, ${second.word} ${format(second.value(item))}, ${lastName} ${format(item.previous)}.`}
    onPointerEnter={() => setActive(item.key)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(item.key)} onBlur={() => setActive(null)}>
    <span className="hv-cat-name">
      {disclosure && <button type="button" className="hv-cat-toggle" aria-expanded={disclosure.open} aria-label={`${disclosure.open ? "Hide" : "Show"} your categories in ${item.label}`} onClick={disclosure.onToggle}>
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></button>}
      {!disclosure && !thin && hasKids && <span className="hv-cat-gap" aria-hidden="true" />}
      <span className="hv-cat-label"><b>{item.label}</b>{item.note && <small>{item.note}</small>}</span>
    </span>
    <span className="hv-cat-track">
      {ticks.map(v => <i key={v} className="hv-vgrid" style={{ left: pct(v) }} />)}
      <span className="hv-cat-bar">{segments.map(segment => segment.value(item) > 0 && <span key={segment.tone} className={`hv-seg-${segment.tone}`} style={{ width: pct(segment.value(item)) }} />)}</span>
      <i className="hv-tick" style={{ left: pct(item.previous) }} />
      {active === item.key && row && <span className="hv-tip hv-cat-tip" role="status"><strong>{row.label}</strong><span>{cap(first.word)} <b>{format(first.value(row))}</b></span><span>{cap(second.word)} <b>{format(second.value(row))}</b></span><span>{lastName} <b>{format(row.previous)}</b></span></span>}
    </span>
    <span className="hv-cat-total"><b>{format(item.total)}</b><small>{sub(item)}</small></span>
  </li>;
  return <div className="hv-cats">
    <div className="hv-legend"><span><i className={`hv-sq-${first.tone}`} />{first.legend}</span><span><i className={`hv-sq-${second.tone}`} />{second.legend}</span><span><i className="hv-key-tick" />{lastName}</span></div>
    <div className="hv-cat-axis" aria-hidden="true"><span />
      <div>{ticks.map(v => <span key={v} style={{ left: pct(v) }}>{compact(v / minorPerUnit(currency), currency)}</span>)}</div><span /></div>
    <ul className="hv-cat-list">
      {rows.map(item => {
        const kids = item.children ?? [], open = kids.length > 0 && opened.has(item.key);
        return <Fragment key={item.key}>
          {line(item, false, kids.length > 0 ? { open, onToggle: () => toggle(item.key) } : undefined)}
          {open && kids.map(kid => line(kid, true))}
        </Fragment>;
      })}
    </ul>
  </div>;
}
