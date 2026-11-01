"use client";

import { useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { KnowPanel } from "@/components/know/KnowPanel";
import { useDismissals } from "@/components/know/dismissals";
import { safeAllFor, safeComingUp } from "@/components/know/safeEngine";
import { DeadlineStrip } from "@/components/moments/DeadlineStrip";
import { MomentCard } from "@/components/moments/MomentCard";
import { context, dueItems, safeToSpend, series, timeline, type SafeToSpend } from "@/lib/money/runway";
import type { Charge } from "@/lib/money/types";
import { afford, parseWhole } from "./afford";
import { useApp } from "./AppContext";
import { cx } from "./cx";
import { dayLabel, dayLabelAt, spanLabel, usd } from "./format";
import { NeedsYou } from "./NeedsYou";
import { Timeline } from "./Timeline";
import styles from "./Today.module.css";
import ui from "./ui.module.css";

const VERDICT = {
  hold: { text: "Hold off", tone: ui.crit },
  easy: { text: "Go easy", tone: ui.warn },
  go: { text: "Go", tone: ui.good },
} as const;

const list = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

export function Today() {
  const { money, profile, persona, state, stage, check, dispatch, toast, approve, play, fmt } = useApp();
  const { runId } = state;
  const safe = useMemo(() => safeToSpend(money, profile.monthlyEssentials), [money, profile]);

  // The moment cards that fire during the flow: a suggestion for the new bill, and one for the client who paid.
  const pending = money.bills.find((b) => b.status === "pending");
  const invoice = money.invoices.find((i) => i.id === persona.demo.invoiceId);
  const client = money.clients.find((c) => c.id === invoice?.clientId);
  const billMoment = useMemo(
    () =>
      pending
        ? context(money, profile, "bill_arrived", { kind: "bill", label: `${pending.biller} ${fmt(pending.amount)}, due ${dayLabel(pending.due)}`, amount: pending.amount, currency: money.homeCurrency })
        : null,
    [money, profile, pending, fmt],
  );
  const paidMoment = useMemo(
    () => (stage === "paid" && invoice && client ? context(money, profile, "client_paid", { kind: "payout", label: client.name, amount: invoice.amountUsd, currency: "USD" }) : null),
    [money, profile, stage, invoice, client],
  );

  // Cards that are not the flow: other bills to confirm, the charges waiting (grouped per card), other invoice drafts.
  const extra: ReactNode[] = [];
  for (const b of check.bills.slice(stage === "bill" ? 1 : 0)) {
    extra.push(
      <QueueCard key={b.id} title={`New bill: ${b.biller} ${fmt(b.amount)}`} sub={`Due ${dayLabel(b.due)} · read from your email`}>
        <button className={`${ui.btn} ${ui.primary}`} type="button" onClick={() => dispatch({ type: "confirm", id: b.id })}>
          Confirm bill
        </button>
      </QueueCard>,
    );
  }
  const byCard = new Map<string, Charge[]>();
  for (const c of check.charges) byCard.set(c.cardId, [...(byCard.get(c.cardId) ?? []), c]);
  for (const [cardId, charges] of byCard) {
    const card = money.cards.find((c) => c.id === cardId);
    const total = charges.reduce((sum, c) => sum + c.amount, 0);
    const places = [...new Set(charges.map((c) => c.place).filter(Boolean))];
    const dates = charges.map((c) => c.date).sort();
    const span = spanLabel(dates[0], dates[dates.length - 1]);
    extra.push(
      <QueueCard
        key={`charges-${cardId}`}
        title={`${charges.length} charge${charges.length === 1 ? "" : "s"} from ${card?.label ?? "a card"}`}
        sub={`${fmt(total)} · ${places.length ? `${places.join(", ")} · ` : ""}${span} · from card emails`}
      >
        <a className={`${ui.btn} ${ui.primary}`} href="#cards">
          Check
        </a>
      </QueueCard>,
    );
  }
  for (const i of check.drafts.filter((d) => d.id !== persona.demo.invoiceId)) {
    const c = money.clients.find((x) => x.id === i.clientId);
    extra.push(
      <QueueCard key={i.id} title={`Invoice draft for ${c?.name ?? "a client"} ${usd(i.amountUsd)}`} sub={i.item}>
        <a className={ui.btn} href="#paid">
          Review
        </a>
      </QueueCard>,
    );
  }
  const flow = stage !== "none";
  const shown = extra.slice(0, flow ? 2 : 3);
  const hidden = extra.length - shown.length;

  return (
    <div className={styles.grid}>
      <div className={styles.col}>
        <SafeCard safe={safe} />
        <Afford safe={safe} />
        <section className={styles.needs} aria-labelledby="needs-h">
          <div className={ui.sectionHead}>
            <h3 id="needs-h">Needs you</h3>
            {check.count > 1 || hidden > 0 ? (
              <a className={styles.more} href="#activity">
                See all {check.count} ›
              </a>
            ) : null}
          </div>
          {flow && <NeedsYou key={`needs-${runId}`} persona={persona} money={money} editing={state.editing} dispatch={dispatch} toast={toast} onApprove={approve} onReplay={play} />}
          {shown}
          {!flow && shown.length === 0 && <p className={styles.quiet}>Nothing needs you right now.</p>}
          {billMoment && <MomentCard key={`bill-${runId}`} profile={profile} context={billMoment} />}
          {paidMoment && <MomentCard key={`paid-${runId}`} profile={profile} context={paidMoment} />}
        </section>
      </div>
      <div className={styles.col}>
        <ComingUp />
        <MiniRunway />
        <Found />
      </div>
    </div>
  );
}

function QueueCard({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <div className={styles.queue}>
      <div>
        <b>{title}</b>
        <span>{sub}</span>
      </div>
      <div className={ui.actions}>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------ safe to spend */

function SafeCard({ safe }: { safe: SafeToSpend }) {
  const { money, fmt } = useApp();
  const [open, setOpen] = useState(false);
  const panel = useId();
  const v = VERDICT[safe.verdict];
  const upTo = useMemo(() => timeline(money, "worst", 30).filter((e) => e.date <= safe.low.date), [money, safe.low.date]);
  const lowDate = dayLabel(safe.low.date);

  return (
    <section className={cx(styles.safe, safe.verdict === "hold" && styles.safeHold)} aria-labelledby="safe-h">
      <span className="eyebrow" id="safe-h">
        Safe to spend · until {lowDate}
      </span>
      <div className={styles.safeRow}>
        <button className={styles.safeNum} type="button" aria-expanded={open} aria-controls={panel} onClick={() => setOpen((o) => !o)}>
          <span>{fmt(safe.amount)}</span>
          <small>{open ? "Hide the maths" : "How is this worked out?"}</small>
        </button>
        <span className={cx(ui.pill, v.tone, styles.verdict)}>{v.text}</span>
      </div>
      {safe.shortBy > 0 && (
        <p className={styles.short}>
          {safe.lateClients.length > 0 ? `If ${list(safe.lateClients)} pay${safe.lateClients.length === 1 ? "s" : ""} late, you're` : "You're"} <b>{fmt(safe.shortBy)} short</b> on {lowDate}
        </p>
      )}
      <p className={styles.cash}>
        Cash {fmt(safe.cash)} · PayPal {fmt(money.paypal)} + bank {fmt(money.bank)}
      </p>
      {open && (
        <div id={panel} className={styles.maths}>
          <p>
            The lowest balance in the next 30 days if clients pay as late as they usually do, never below {fmt(0)}. These are the dates up to the lowest point.
          </p>
          <Timeline events={upTo} fmt={fmt} late label="Dated events up to the lowest point" start={{ balance: safe.cash }} />
          <p className={styles.mathsEnd}>
            Lowest point <b>{fmt(safe.low.amount)}</b> on {lowDate}
            {safe.low.amount < 0 ? `, so safe to spend is ${fmt(0)}.` : "."}
          </p>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ can I afford */

function Afford({ safe }: { safe: SafeToSpend }) {
  const { money } = useApp();
  const [text, setText] = useState("");
  const [asked, setAsked] = useState<number | null>(null);
  const [error, setError] = useState("");
  const inputId = useId();
  const errId = useId();
  const sym = money.homeCurrency === "JPY" ? "¥" : "$";

  function submit(e: FormEvent) {
    e.preventDefault();
    const r = parseWhole(text);
    if ("error" in r) {
      setError(r.error);
      setAsked(null);
    } else {
      setError("");
      setAsked(r.amount);
    }
  }

  const lines = asked === null ? [] : afford(money, safe, asked);

  return (
    <section className={styles.afford} aria-labelledby="afford-h">
      <h3 id="afford-h">Can I afford…?</h3>
      <form onSubmit={submit} noValidate>
        <div className={styles.askRow}>
          <label className={styles.amount} htmlFor={inputId}>
            <span aria-hidden="true">{sym}</span>
            <input
              id={inputId}
              inputMode="decimal"
              autoComplete="off"
              placeholder="Amount"
              value={text}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errId : undefined}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <button className={`${ui.btn} ${ui.primary}`} type="submit">
            Check
          </button>
        </div>
        {error && (
          <p className={styles.error} id={errId} role="alert">
            {error}
          </p>
        )}
      </form>
      {lines.length > 0 && (
        <ul className={styles.answers} aria-live="polite">
          {lines.map((l) => (
            <li key={l.kind}>
              <span className={cx(ui.pill, l.ok ? ui.good : ui.crit)}>{l.ok ? "Yes" : l.kind === "cash" ? "Not now" : "No"}</span>
              <span>{l.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ coming up */

function ComingUp() {
  const { money, profile, state, fmt } = useApp();
  const items = dueItems(money, 7);
  const deadline = useMemo(() => context(money, profile, "deadline_near"), [money, profile]);
  const taxes = safeComingUp(profile, deadline).filter((s) => s.dueInDays !== undefined && s.dueInDays <= 7).length;
  return (
    <section className={styles.card} aria-labelledby="coming-h">
      <div className={ui.sectionHead}>
        <h3 id="coming-h">Coming up · 7 days</h3>
        <a className={styles.more} href="#plan">
          See the next 30 days ›
        </a>
      </div>
      <ul className={styles.due}>
        {items.map((d) => (
          <li key={d.id}>
            <span className={styles.dt}>{dayLabel(d.date)}</span>
            <span className={styles.dueWhat}>
              {d.label}
              {d.pending && <span className={styles.pend}>to confirm</span>}
              {d.open && <span className={styles.pend}>so far</span>}
            </span>
            <span className={styles.am}>{fmt(d.amount)}</span>
            <span className={cx(ui.pill, styles.small, d.covered ? ui.good : ui.crit)}>{d.covered ? "Covered" : "Not covered"}</span>
          </li>
        ))}
        {items.length === 0 && taxes === 0 && <li className={styles.quiet}>Nothing due in the next 7 days.</li>}
      </ul>
      <DeadlineStrip key={`deadline-${state.runId}`} profile={profile} context={deadline} withinDays={7} caption={null} />
    </section>
  );
}

/* ------------------------------------------------------------ mini runway */

const DAYS = 30;

function MiniRunway() {
  const { money, fmt } = useApp();
  const worst = useMemo(() => series(money, "worst", DAYS), [money]);
  const lo = Math.min(...worst);
  const lowDay = worst.indexOf(lo);
  const top = Math.max(0, ...worst);
  const bottom = Math.min(0, lo);
  const span = top - bottom || 1;
  const y = (v: number) => 4 + (1 - (v - bottom) / span) * 48;
  let d = `M0,${y(worst[0])}`;
  worst.forEach((v, i) => {
    if (i) d += `V${y(v)}`;
    d += `H${((i + 1) / DAYS) * 300}`;
  });
  const negative = lo < 0;
  const date = dayLabelAt(money.today, lowDay);
  return (
    <a className={styles.mini} href="#plan" aria-label={`Open the plan. Lowest worst-case point ${fmt(lo)} on ${date}.`}>
      <div className={ui.sectionHead}>
        <h3>Next 30 days, worst case</h3>
        <small>Plan ›</small>
      </div>
      <div className={styles.spark}>
        <svg viewBox="0 0 300 56" preserveAspectRatio="none" aria-hidden="true">
          {bottom < 0 && <line className={styles.zero} x1="0" x2="300" y1={y(0)} y2={y(0)} />}
          <path className={styles.line} d={d} />
        </svg>
        <i className={cx(styles.dot, negative ? styles.dotBad : styles.dotOk)} style={{ left: `${((lowDay + 0.5) / DAYS) * 100}%`, top: `${(y(lo) / 56) * 100}%` }} />
      </div>
      <p className={styles.lowText}>
        Lowest <b className={negative ? styles.bad : undefined}>{fmt(lo)}</b> · {date}
      </p>
    </a>
  );
}

/* ------------------------------------------------------------ found for you */

function Found() {
  const { profile, money, state } = useApp();
  const setup = useMemo(() => context(money, profile, "setup"), [money, profile]);
  const [open, setOpen] = useState(false);
  const { get } = useDismissals();
  const panel = useId();
  const ways = useMemo(() => {
    const onStrip = new Set(safeComingUp(profile, setup).map((s) => s.move.id));
    return safeAllFor(profile, setup).filter((s) => !onStrip.has(s.move.id) && s.move.tier === "insider");
  }, [profile, setup]);
  const n = ways.filter((s) => get(s.move.id) === undefined).length;
  return (
    <section className={styles.found}>
      <button className={styles.foundBtn} type="button" aria-expanded={open} aria-controls={panel} onClick={() => setOpen((o) => !o)}>
        <span>{n > 0 ? `${n} way${n === 1 ? "" : "s"} to keep more` : "Found for you"}</span>
        <span aria-hidden="true">{open ? "⌄" : "›"}</span>
      </button>
      {open && (
        <div id={panel}>
          <KnowPanel key={state.runId} profile={profile} context={setup} />
        </div>
      )}
    </section>
  );
}
