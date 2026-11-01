"use client";

import { useMemo } from "react";
import { arrivals, type Arrival } from "@/lib/money/runway";
import type { Invoice } from "@/lib/money/types";
import { useApp } from "./AppContext";
import { cx } from "./cx";
import { dayLabel, shortName, usd } from "./format";
import styles from "./GetPaid.module.css";
import ui from "./ui.module.css";

const num = (n?: string) => (n ? (/^\d+$/.test(n) ? `#${n}` : n) : "");
const sum = (list: Invoice[]) => list.reduce((total, i) => total + i.amountUsd, 0);
const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)] ?? 0;
const plural = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

export function GetPaid() {
  const { money, persona, stage, check, approve, go, toast } = useApp();
  const sent = money.invoices.filter((i) => i.status === "sent");
  const paid = money.invoices.filter((i) => i.status === "paid");
  const unbilled = money.invoices.filter((i) => i.status === "unbilled");
  const overdue = sent.filter((i) => i.dueOn && i.dueOn < money.today);
  const arr = useMemo(() => arrivals(money), [money]);
  const clientOf = (i: Invoice) => money.clients.find((c) => c.id === i.clientId);
  // The assistant's drafts: the ones that need your OK, and the one being sent right now.
  const drafts = money.invoices.filter((i) => check.drafts.some((d) => d.id === i.id) || (i.id === persona.demo.invoiceId && i.status === "draft"));

  return (
    <div className={styles.page}>
      <div className={styles.summary} role="list" aria-label="Invoices at a glance">
        <Stat label="Owed to you" value={usd(sum(sent))} sub={`${sent.length} invoice${sent.length === 1 ? "" : "s"} sent, not paid`} />
        <Stat label="Overdue" value={usd(sum(overdue))} sub={overdue.length ? `${overdue.length} past the due date` : "nothing past its due date"} bad={overdue.length > 0} />
        <Stat label="Not invoiced" value={usd(sum(unbilled))} sub={unbilled.length ? `${unbilled.length} finished piece${unbilled.length === 1 ? "" : "s"} of work` : "all work is invoiced"} />
      </div>

      <section className={ui.block} aria-labelledby="drafts-h">
        <div className={ui.sectionHead}>
          <h3 id="drafts-h">Drafts waiting for you</h3>
          <button
            className={cx(ui.btn, styles.small)}
            type="button"
            onClick={() => toast("In the app you describe the work and the assistant drafts the invoice for your OK. The demo drafts it once the bill is confirmed.")}
          >
            New invoice
          </button>
        </div>
        {drafts.length === 0 && <p className={styles.quiet}>No drafts waiting. When you finish work, the assistant drafts the invoice here.</p>}
        {drafts.map((i) => {
          const c = clientOf(i);
          const mine = i.id === persona.demo.invoiceId;
          const sending = i.status === "draft";
          return (
            <div key={i.id} className={styles.draft}>
              <div>
                <b>
                  {c?.name ?? "Client"} · {usd(i.amountUsd)}
                </b>
                <span>{i.item}</span>
                <span>{sending ? "Sending through PayPal…" : "Draft in PayPal. Nothing is sent until you approve."}</span>
              </div>
              {!sending && (
                <div className={ui.actions}>
                  {mine && stage === "approve" && (
                    <button className={cx(ui.btn, ui.primary)} type="button" onClick={approve}>
                      Approve and send
                    </button>
                  )}
                  <button className={ui.btn} type="button" onClick={() => go("today", "needs-you")}>
                    Review
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {unbilled.filter((i) => !drafts.some((d) => d.id === i.id)).map((i) => (
          <p key={i.id} className={styles.quiet}>
            Not invoiced yet: {i.item} · {usd(i.amountUsd)} · {clientOf(i)?.name}
            {stage === "bill" ? ". Confirm the new bill on Today first and the assistant drafts it." : ""}
          </p>
        ))}
      </section>

      <div className={styles.cols}>
        <section className={ui.block} aria-labelledby="sent-h">
          <div className={ui.sectionHead}>
            <h3 id="sent-h">Sent</h3>
            <small>expected and late dates from how each client has paid</small>
          </div>
          <ul className={styles.list}>
            {sent.map((i) => (
              <SentRow key={i.id} invoice={i} arrival={arr.find((a) => a.invoiceId === i.id)} overdue={!!i.dueOn && i.dueOn < money.today} clientName={clientOf(i)?.name ?? "Client"} />
            ))}
            {sent.length === 0 && <li className={styles.quiet}>Nothing is waiting on a client.</li>}
          </ul>
          <div className={ui.sectionHead}>
            <h3>Paid</h3>
          </div>
          <ul className={styles.list}>
            {paid.map((i) => (
              <li key={i.id}>
                <div>
                  <b>
                    {clientOf(i)?.name} · {usd(i.amountUsd)}
                  </b>
                  <span>
                    {num(i.number)} {i.item}
                  </span>
                </div>
                <span className={cx(ui.pill, ui.good)}>Paid</span>
              </li>
            ))}
            {paid.length === 0 && <li className={styles.quiet}>Nothing paid this month yet.</li>}
          </ul>
        </section>

        <section className={ui.block} aria-labelledby="days-h">
          <div className={ui.sectionHead}>
            <h3 id="days-h">How fast clients pay</h3>
            <small>days from sending to paid</small>
          </div>
          <ul className={styles.list}>
            {money.clients.map((c) => (
              <li key={c.id}>
                <div>
                  <b>{c.name}</b>
                  <span>
                    {c.daysToPay.length ? `usually ${plural(median(c.daysToPay))}, slowest ${plural(Math.max(...c.daysToPay))}` : "no paid invoices yet"}
                  </span>
                </div>
                <span className={styles.avg}>{c.daysToPay.length ? <>avg {plural(mean(c.daysToPay))}</> : "-"}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, bad }: { label: string; value: string; sub: string; bad?: boolean }) {
  return (
    <div className={styles.stat} role="listitem">
      <span className="eyebrow">{label}</span>
      <b className={bad ? styles.bad : undefined}>{value}</b>
      <small>{sub}</small>
    </div>
  );
}

function SentRow({ invoice, arrival, overdue, clientName }: { invoice: Invoice; arrival?: Arrival; overdue: boolean; clientName: string }) {
  return (
    <li>
      <div>
        <b>
          {clientName} · {usd(invoice.amountUsd)}
        </b>
        <span>
          {num(invoice.number)} {invoice.item}
        </span>
        <span>
          {invoice.sentOn ? `Sent ${dayLabel(invoice.sentOn)}` : "Sent"}
          {invoice.dueOn ? ` · due ${dayLabel(invoice.dueOn)}` : ""}
        </span>
        {arrival && (
          <span>
            {shortName(clientName)} expected {dayLabel(arrival.expectedOn)} · late {dayLabel(arrival.worstOn)}
          </span>
        )}
      </div>
      {overdue ? <span className={cx(ui.pill, ui.crit)}>Overdue</span> : <span className={cx(ui.pill, ui.acc)}>Sent</span>}
    </li>
  );
}
