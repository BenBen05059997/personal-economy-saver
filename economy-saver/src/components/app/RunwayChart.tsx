"use client";

import { useEffect, useRef, useState } from "react";
import { arrivals, dayEvents, daysBetween, low, shortRuns, statementItems, type Series } from "@/lib/money/runway";
import type { MoneyState } from "@/lib/money/types";
import type { Persona } from "@/lib/sample/personas";
import { findInvoice } from "./demo";
import { currencySymbol, dayLabelAt, homeFormat, shortName, usd } from "./format";
import styles from "./RunwayChart.module.css";
import { useReducedMotion } from "./useReducedMotion";

type Pair = { e: readonly number[]; w: readonly number[] };
type Anim = { from: Pair; to: Pair; p: number };

const MARGIN = { l: 50, r: 10, t: 14, b: 34 };
const TWEEN_MS = 750;

function lerp(a: Pair, b: Pair, p: number): Pair {
  return { e: a.e.map((v, i) => v + (b.e[i] - v) * p), w: a.w.map((v, i) => v + (b.w[i] - v) * p) };
}

// Grid spacing per currency: the same picture for ¥100k and $1k lines.
const UNIT: Record<MoneyState["homeCurrency"], number> = { JPY: 100_000, USD: 1_000 };

function domain(e: readonly number[], w: readonly number[], unit: number) {
  const lo = Math.min(0, ...w, ...e);
  const hi = Math.max(...e, ...w);
  const half = unit / 2;
  return { lo: Math.min(-half, Math.floor((lo - unit / 4) / half) * half), hi: Math.ceil((hi + unit / 5) / unit) * unit };
}

function stepPath(v: readonly number[], x: (i: number) => number, y: (v: number) => number): string {
  let p = `M${x(0)},${y(v[0])}`;
  for (let i = 0; i < v.length; i++) {
    if (i) p += `V${y(v[i])}`;
    p += `H${x(i + 1)}`;
  }
  return p;
}

type Props = { persona: Persona; money: MoneyState; expected: Series; worst: Series; view?: "expected" | "worst" };

export function RunwayChart({ persona, money, expected, worst, view = "worst" }: Props) {
  const fmt = homeFormat(money);
  const sym = currencySymbol(money.homeCurrency);
  const unit = UNIT[money.homeCurrency];
  const reduced = useReducedMotion();
  const target: Pair = { e: expected, w: worst };
  const days = worst.length;

  // When the data changes, start from what is on screen and tween to the new lines.
  const [anim, setAnim] = useState<Anim>({ from: target, to: target, p: 1 });
  if (anim.to.e !== expected || anim.to.w !== worst) {
    setAnim({ from: lerp(anim.from, anim.to, anim.p), to: target, p: reduced ? 1 : 0 });
  }
  const settled = anim.p >= 1;
  const animTo = anim.to;
  useEffect(() => {
    if (settled) return;
    let raf = 0;
    let t0: number | undefined;
    const step = (now: number) => {
      t0 ??= now;
      const t = Math.min(1, (now - t0) / TWEEN_MS);
      const p = 1 - Math.pow(1 - t, 3);
      setAnim((a) => (a.to === animTo ? { ...a, p: t >= 1 ? 1 : p } : a));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [settled, animTo]);

  const shown = reduced || settled ? anim.to : lerp(anim.from, anim.to, anim.p);
  const dom = domain(expected, worst, unit);

  // Width follows the container.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(280, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [hover, setHover] = useState<number | null>(null);

  const W = width;
  const H = W < 560 ? 220 : 270;
  const m = MARGIN;
  const x = (i: number) => m.l + (i / days) * (W - m.l - m.r);
  const y = (v: number) => m.t + (1 - (v - dom.lo) / (dom.hi - dom.lo)) * (H - m.t - m.b);
  const z = y(0);
  const gridTicks: number[] = [];
  for (let t = Math.ceil(dom.lo / unit) * unit; t <= dom.hi; t += unit) if (t !== 0) gridTicks.push(t);
  const xTicks = W < 480 ? [0, 14, 28] : [0, 7, 14, 21, 28];
  const lead = view === "worst" ? shown.w : shown.e;
  const runs = shortRuns(lead, unit / 200);
  const lw = low(lead);
  const negative = lw.amount < -unit / 200;
  const lx = x(lw.dayIndex + 0.5);
  const ly = y(lw.amount);
  const lowAnchor = lx > W - 150 ? "end" : "start";
  const lowText = negative ? `${fmt(lw.amount)} on ${dayLabelAt(money.today, lw.dayIndex)}` : `Lowest ${fmt(lw.amount)} · ${dayLabelAt(money.today, lw.dayIndex)}`;
  const worstPath = stepPath(shown.w, x, y);
  const leadPath = view === "worst" ? worstPath : stepPath(shown.e, x, y);

  const bills = money.bills.filter((b) => b.status === "confirmed" && daysBetween(money.today, b.due) >= 0 && daysBetween(money.today, b.due) < days);
  const statementDays = [...new Set(statementItems(money).map((st) => daysBetween(money.today, st.dueOn)).filter((i) => i >= 0 && i < days))];

  // The demo invoice gets a note on the chart: expected while it is in the post, paid once it lands.
  const demo = findInvoice(money, persona);
  let note: { text: string; at: number; good: boolean } | null = null;
  if (demo?.status === "sent") {
    const a = arrivals(money).find((r) => r.invoiceId === demo.id);
    if (a) note = { text: `${shortName(a.clientName)} ${usd(a.amountUsd)} expected`, at: daysBetween(money.today, a.expectedOn), good: false };
  } else if (demo?.status === "paid") {
    const client = money.clients.find((c) => c.id === demo.clientId);
    note = { text: `+${fmt(demo.amountUsd * money.fxPerUsd)} ${shortName(client?.name ?? "Client")} paid`, at: 0, good: true };
  }

  function onMove(ev: React.PointerEvent<HTMLDivElement>) {
    const r = ev.currentTarget.getBoundingClientRect();
    const i = Math.floor(((ev.clientX - r.left - m.l) / (W - m.l - m.r)) * days);
    setHover(i < 0 || i >= days ? null : i);
  }

  const hx = hover === null ? 0 : x(hover + 0.5);
  const events = hover === null ? null : dayEvents(money, hover);

  return (
    <div className={styles.chart} ref={wrapRef} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} height={H} role="img" aria-label={`Balance for the next ${days} days. Lowest ${view === "worst" ? "worst-case" : "expected"} point ${lowText}.`}>
        <defs>
          <clipPath id="runway-below">
            <rect x="0" y={z} width={W} height={Math.max(0, H - z)} />
          </clipPath>
        </defs>
        {gridTicks.map((t) => (
          <g key={t}>
            <line className={styles.grid} x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} />
            <text className={styles.axis} x={m.l - 8} y={y(t) + 4} textAnchor="end">
              {t < 0 ? "−" : ""}{sym}{Math.abs(t) / 1000}k
            </text>
          </g>
        ))}
        {xTicks.map((i) => (
          <text key={i} className={styles.axis} x={x(i + 0.5)} y={H - 10} textAnchor="middle">
            {i === 0 ? "Today" : dayLabelAt(money.today, i)}
          </text>
        ))}
        {/* days the worst case is below zero get a full-height band, so a small gap still reads at a glance */}
        {runs.map((r, k) => {
          const n = r.to - r.from + 1;
          const rx = x(r.to + 1) + 6;
          const end = rx > W - 130;
          return (
            <g key={r.from}>
              <rect className={styles.band} x={x(r.from)} y={m.t} width={x(r.to + 1) - x(r.from)} height={H - m.t - m.b} />
              {k === 0 && (
                <text className={styles.bandLabel} x={end ? x(r.from) - 6 : rx} y={m.t + 12} textAnchor={end ? "end" : "start"}>
                  Short for {n} day{n > 1 ? "s" : ""}
                </text>
              )}
            </g>
          );
        })}
        <path className={styles.band} d={`${leadPath}V${z}H${x(0)}Z`} clipPath="url(#runway-below)" />
        <line className={styles.zero} x1={m.l} x2={W - m.r} y1={z} y2={z} />
        <text className={styles.zeroLabel} x={m.l - 8} y={z + 4} textAnchor="end">
          {fmt(0)}
        </text>
        {bills.map((b) => (
          <path key={b.id} className={styles.billTick} d={`M${x(daysBetween(money.today, b.due) + 0.5) - 3.5},${H - m.b + 4}h7l-3.5,5z`} />
        ))}
        {statementDays.map((i) => (
          <path key={`st-${i}`} className={styles.billTick} d={`M${x(i + 0.5) - 3.5},${H - m.b + 4}h7l-3.5,5z`} />
        ))}
        <path className={`${styles.expected} ${view === "worst" ? styles.dim : ""}`} d={stepPath(shown.e, x, y)} />
        <path className={`${styles.worst} ${view === "expected" ? styles.dim : ""}`} d={worstPath} />
        <circle className={`${styles.lowDot} ${negative ? styles.lowDotBad : styles.lowDotOk}`} cx={lx} cy={ly} r={5} />
        <text className={styles.lowLabel} x={lx + (lowAnchor === "end" ? -10 : 10)} y={negative ? Math.min(ly + 18, H - m.b - 5) : ly - 10} textAnchor={lowAnchor}>
          {lowText}
        </text>
        {note && (
          <text className={note.good ? styles.noteGood : styles.note} x={x(note.at) + 4} y={y(shown.e[note.at]) - 8}>
            {note.text}
          </text>
        )}
        {hover !== null && <line className={styles.cross} x1={hx} x2={hx} y1={m.t} y2={H - m.b} />}
      </svg>
      {hover !== null && events && (
        <div className={styles.tip} style={hx > W / 2 ? { left: hx - 12, transform: "translateX(-100%)" } : { left: hx + 12 }}>
          <div className={styles.tipDay}>
            {hover === 0 ? "Today, " : ""}
            {dayLabelAt(money.today, hover)}
          </div>
          <div className={styles.tipRow}>
            <span>
              <i className={styles.sw} style={{ background: "var(--s-exp)" }} />
              Expected
            </span>
            <span>{fmt(expected[hover])}</span>
          </div>
          <div className={styles.tipRow}>
            <span>
              <i className={styles.sw} style={{ background: "var(--s-worst)" }} />
              Worst case
            </span>
            <span>{fmt(worst[hover])}</span>
          </div>
          {events.bills.length + events.statements.length + events.expected.length + events.worst.length > 0 && (
            <ul>
              {events.bills.map((b) => (
                <li key={b.id}>
                  <span>{b.biller}</span>
                  <span>{fmt(-b.amount)}</span>
                </li>
              ))}
              {events.statements.map((st) => (
                <li key={st.cardId + st.closesOn}>
                  <span>
                    {st.label}
                    {st.open ? " (so far)" : ""}
                  </span>
                  <span>{fmt(-st.amount)}</span>
                </li>
              ))}
              {events.expected.map((a) => (
                <li key={a.invoiceId + "e"}>
                  <span>
                    {a.clientName} pays {a.number ? (/^\d+$/.test(a.number) ? "#" + a.number : a.number) : "invoice"} (expected)
                  </span>
                  <span>+{fmt(a.amountHome)}</span>
                </li>
              ))}
              {events.worst.map((a) => (
                <li key={a.invoiceId + "w"}>
                  <span>
                    {a.clientName} pays {a.number ? (/^\d+$/.test(a.number) ? "#" + a.number : a.number) : "invoice"} (worst)
                  </span>
                  <span>+{fmt(a.amountHome)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
