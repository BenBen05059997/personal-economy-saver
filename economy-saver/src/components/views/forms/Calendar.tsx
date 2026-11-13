"use client";

import { useState } from "react";
import { dayLabel } from "@/lib/money/format";
import type { ViewResult } from "@/lib/views/types";
import { longDay } from "../chart-utils";
import "./calendar.css";

/** A pending line in a cell, in short words ("Hikari Denki ¥11,220 · to check"); the readout and the table keep the full sentence. */
const cellWords = (item: string) => item.replace(/ waits in To check and is not counted yet$/, " · to check");
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** The shade of a day's cell: how much goes out against the heaviest day, as a share of the yellow (the amounts are the engine's; this only picks a tint). */
const shade = (out: number, max: number) => out <= 0 || max <= 0 ? 0 : Math.round(16 + 64 * Math.sqrt(out / max));

/** The calendar form (D77): whole weeks from Sunday, each day shaded in the yellow by what goes out, a green dot where money comes in, a red mark where the late case is short. Hover or focus a day for everything on it. */
export function Calendar({ result }: { result: ViewResult<"calendar"> }) {
  const data = result.data;
  const [selected, setSelected] = useState<string | null>(null);
  if (!data) return null;
  const cells = data.weeks.flat(), chosen = cells.find(cell => cell.date === selected && cell.inRange) ?? null;
  const hasIn = cells.some(cell => cell.inMinor > 0), hasShort = cells.some(cell => cell.short);
  const readout = chosen === null ? "Hover or focus a day to read what falls on it." : `${longDay(chosen.date)}: ${chosen.items.length ? chosen.items.join("; ") : "nothing scheduled"}${chosen.short ? ". Short if clients pay late" : ""}.`;
  return <div className="cal-chart">
    <div className="cal-legend">
      <span><i className="cal-sw cal-sw-low" />Goes out, a little</span><span><i className="cal-sw cal-sw-high" />Goes out, the most</span>
      {hasIn && <span><i className="cal-dot cal-dot-in" />Money coming in</span>}
      {hasShort && <span><i className="cal-dot cal-dot-short" />Short if clients pay late</span>}
    </div>
    <div className="cal-grid" role="group" aria-label={result.aria}>
      {WEEKDAYS.map(day => <div key={day} className="cal-head" aria-hidden="true">{day}</div>)}
      {cells.map(cell => {
        const first = cell.date.endsWith("-01") || cell === cells.find(c => c.inRange);
        const level = shade(cell.outMinor, data.maxOutMinor);
        const style = level > 0 ? { background: `color-mix(in srgb, var(--chart) ${level}%, var(--screen))` } : undefined;
        if (!cell.inRange) return <div key={cell.date} className="cal-cell cal-out" aria-hidden="true"><span className="cal-num">{Number(cell.date.slice(8, 10))}</span></div>;
        const shown = cell.items.slice(0, 2), more = cell.items.length - shown.length;
        const cls = ["cal-cell", cell.today && "cal-today", cell.short && "cal-short", selected === cell.date && "cal-on", level >= 55 && "cal-heavy"].filter(Boolean).join(" ");
        return <div key={cell.date} className={cls} style={style} tabIndex={0} role="img"
          aria-label={`${longDay(cell.date)}${cell.today ? ", today" : ""}: ${cell.items.length ? cell.items.join("; ") : "nothing scheduled"}${cell.short ? ". Short if clients pay late" : ""}`}
          onPointerEnter={() => setSelected(cell.date)} onPointerLeave={() => setSelected(null)} onFocus={() => setSelected(cell.date)} onBlur={() => setSelected(null)}>
          <span className="cal-num">{first ? dayLabel(cell.date) : Number(cell.date.slice(8, 10))}{cell.today && <b> · Today</b>}</span>
          {shown.map(item => <span key={item} className="cal-item">{cellWords(item)}</span>)}
          {more > 0 && <span className="cal-item cal-more">+{more} more</span>}
          <span className="cal-marks">{cell.inMinor > 0 && <i className="cal-dot cal-dot-in" />}{cell.short && <i className="cal-dot cal-dot-short" />}</span>
        </div>;
      })}
    </div>
    <p className="cal-readout" aria-live="polite">{readout}</p>
  </div>;
}
