"use client";

import Link from "next/link";
import { useState } from "react";
import { hrefFor } from "@/lib/links";
import type { ActionData, CompareData, LetterData, NoteData, NumberData, ProgressData, SentenceData, TableData, TimelineData } from "@/lib/canvas/resolve";

// One component per block type that shows resolved data. None does any arithmetic on money beyond drawing a bar's length.

export function SentenceBlock({ data }: { data: SentenceData }) {
  const lead = data.leadParts.map((part, index) => (typeof part === "string" ? part : <Link key={index} prefetch={false} href={hrefFor({ type: "client", id: part.id })}>{part.name}</Link>));
  return <>
    <p className="canvas-sentence">{lead} <span className={data.short ? "is-short" : undefined}>{data.on ? `${data.before} ${data.on}.` : data.before}</span></p>
    {data.note && <p className="canvas-note">{data.note}</p>}
  </>;
}

export function NumberBlock({ data }: { data: NumberData }) {
  return <>
    <p className="canvas-label">{data.label}</p>
    <p className={`canvas-number ${data.tone === "short" ? "is-short" : ""}`}>{data.value}</p>
    {data.sub && <p className="canvas-sub">{data.sub}</p>}
    {data.note && <p className="canvas-note">{data.note}</p>}
  </>;
}

export function ProgressBlock({ data }: { data: ProgressData }) {
  const percent = Math.min(100, Math.max(0, Math.round((data.valueMinor / data.targetMinor) * 100)));
  return <>
    <p className="canvas-label">{data.label}</p>
    <p className="canvas-number">{data.valueLabel} <small>of {data.targetLabel}</small></p>
    <div className="canvas-meter" role="progressbar" aria-label={data.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${percent}% of ${data.targetLabel}`}><i style={{ width: `${percent}%` }} /></div>
  </>;
}

export function TimelineBlock({ data }: { data: TimelineData }) {
  if (data.empty) return <p className="canvas-note">{data.empty}</p>;
  return <>
    <p className="canvas-sub">{data.caption}</p>
    <ul className="canvas-rows">
      {data.rows.map(row => <li key={row.id + row.date} className="canvas-row">
        <time dateTime={row.date}>{row.dateLabel}</time>
        <span className="canvas-what">{row.label}{row.flag && <small>{row.flag}</small>}{!row.covered && <small className="is-short">Short that day</small>}</span>
        <span className={`canvas-amount ${row.incoming ? "is-in" : ""}`}>{row.amountLabel}</span>
        <span className="canvas-balance">{row.balanceLabel}</span>
      </li>)}
    </ul>
  </>;
}

export function TableBlock({ data }: { data: TableData }) {
  return <>
    {data.title && <p className="canvas-label">{data.title}</p>}
    {data.caption && <p className="canvas-note">{data.caption}</p>}
    {data.empty ? <p className="canvas-note">{data.empty}</p> : <table className="canvas-table">
      <thead><tr>{data.head.map((cell, i) => <th key={i} scope="col">{cell}</th>)}</tr></thead>
      <tbody>{data.rows.map((row, r) => <tr key={r} className={row.tone === "plain" ? undefined : `is-${row.tone}`}>{row.cells.map((cell, i) => (i === 0 ? <th key={i} scope="row">{cell}</th> : <td key={i}>{cell}</td>))}</tr>)}</tbody>
      {data.foot && <tfoot><tr>{data.foot.map((cell, i) => (i === 0 ? <th key={i} scope="row">{cell}</th> : <td key={i}>{cell}</td>))}</tr></tfoot>}
    </table>}
  </>;
}

export function CompareBlock({ data }: { data: CompareData }) {
  if (data.empty) return <p className="canvas-note">{data.empty}</p>;
  const biggest = Math.max(1, ...data.rows.flatMap(row => [row.aMinor, row.bMinor]));
  const width = (minor: number) => `${Math.max(0, (minor / biggest) * 100)}%`;
  return <>
    <p className="canvas-sub"><b>{data.aName}</b> {data.aTotal} · <b>{data.bName}</b> {data.bTotal} · {data.difference}</p>
    <div className="canvas-legend" aria-hidden="true"><span>{data.aName}</span><span className="is-new">{data.bName}</span></div>
    <div className="canvas-compare">
      {data.rows.map(row => <div key={row.label} className="canvas-compare-row">
        <span className="canvas-compare-name">{row.label}<small>{row.change}</small></span>
        <div className="canvas-bars" role="img" aria-label={`${row.label}: ${data.aName} ${row.aLabel}, ${data.bName} ${row.bLabel}`}>
          <span className="canvas-bar"><i style={{ width: width(row.aMinor) }} /><em>{row.aLabel}</em></span>
          <span className="canvas-bar is-new"><i style={{ width: width(row.bMinor) }} /><em>{row.bLabel}</em></span>
        </div>
      </div>)}
    </div>
  </>;
}

export function NoteBlock({ data }: { data: NoteData }) {
  return <p className="canvas-text">{data.text}</p>;
}

export function LetterBlock({ data }: { data: LetterData }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return <>
    <div className="canvas-letter" tabIndex={0} role="region" aria-label="Letter">{data.text}</div>
    <button type="button" className="ui-button" onClick={copy}>{copied ? "Copied" : "Copy the letter"}</button>
  </>;
}

export function ActionBlock({ data }: { data: ActionData }) {
  return <Link className="ui-button primary" prefetch={false} href={data.href}>{data.label}</Link>;
}
