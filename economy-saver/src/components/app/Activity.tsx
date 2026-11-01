"use client";

import { useMemo, useState } from "react";
import type { MoneyState } from "@/lib/money/types";
import type { Persona } from "@/lib/sample/personas";
import { useApp } from "./AppContext";
import { PendingList } from "./CardMoments";
import { cx } from "./cx";
import type { Actor, LogEntry } from "./demo";
import { dayLabel, homeFormat, usd } from "./format";
import styles from "./Activity.module.css";
import { Address, UploadPhoto } from "./Inbox";
import ui from "./ui.module.css";

const TONE: Record<Actor, string | undefined> = {
  AI: styles.ai,
  You: styles.you,
  PayPal: styles.paypal,
  Webhook: styles.hook,
  Email: undefined,
  Rule: undefined,
};

type Row = { key: string; sort: string; date: string; tm?: string; who: string; tone?: string; text: string; tool?: string; source: string; fresh?: boolean };

/** Where a log line came from: PayPal, an email, a card email, or the app itself (the assistant, your own tap, a saved rule). */
function sourceOf(e: LogEntry): string {
  if (e.who === "PayPal" || e.who === "Webhook") return "PayPal";
  if (e.who === "Email") return e.text.startsWith("Card email") ? "Card email" : "Email";
  return "In app";
}

/** The log, plus the confirmed charges and bills the person did not see arrive today, newest first. */
export function feed(money: MoneyState, log: LogEntry[], persona: Persona): Row[] {
  const rows: Row[] = [];
  const fmt = homeFormat(money);
  // A charge dated after today, or a bill due later, arrived no later than today: they sort by the date they belong to, capped at today.
  const cap = (iso: string) => (iso > money.today ? money.today : iso);
  for (const b of money.bills) {
    if (b.status !== "confirmed" || b.id === persona.demo.billId) continue;
    rows.push({ key: `bill-${b.id}`, sort: `${cap(b.due)} 00:00`, date: cap(b.due), who: "Bill", text: `${b.biller} ${fmt(b.amount)}, due ${dayLabel(b.due)}`, source: "Email" });
  }
  for (const c of money.charges) {
    if (c.status !== "confirmed" || c.id.startsWith("trip-")) continue;
    const card = money.cards.find((x) => x.id === c.cardId);
    rows.push({ key: `charge-${c.id}`, sort: `${cap(c.date)} 00:00`, date: cap(c.date), who: "Charge", text: `${card?.label ?? "Card"} ${fmt(c.amount)} at ${c.merchant}${c.place ? `, ${c.place}` : ""}`, source: c.source === "receipt" ? "Photo" : "Card email" });
  }
  rows.sort((a, b) => (a.sort < b.sort ? 1 : a.sort > b.sort ? -1 : a.key < b.key ? -1 : 1));
  const logRows: Row[] = log.map((e) => ({ key: `log-${e.id}`, sort: `${money.today} ${e.tm}`, date: money.today, tm: e.tm, who: e.who, tone: TONE[e.who], text: e.text, tool: e.tool, source: sourceOf(e), fresh: e.fresh }));
  // Log entries come in time order; the newest is last.
  return [...[...logRows].reverse(), ...rows].sort((a, b) => (a.sort < b.sort ? 1 : a.sort > b.sort ? -1 : 0));
}

type Mode = "check" | "all";

/** The Activity tab: the address and upload on top, then what to check, or everything that happened. */
export function ActivityTab() {
  const { money, persona, state, check, stage, dispatch, approve, go, fmt } = useApp();
  const [mode, setMode] = useState<Mode>("check");
  const rows = useMemo(() => feed(money, state.log, persona), [money, state.log, persona]);

  return (
    <div className={styles.page}>
      <section className={styles.inbox} aria-label="Send something to read">
        <div>
          <span className="eyebrow">Bills inbox</span>
          <Address className={styles.address} />
        </div>
        <UploadPhoto />
      </section>

      <div className={styles.seg} role="group" aria-label="Activity view">
        <button type="button" aria-pressed={mode === "check"} onClick={() => setMode("check")}>
          To check ({check.count})
        </button>
        <button type="button" aria-pressed={mode === "all"} onClick={() => setMode("all")}>
          All activity
        </button>
      </div>

      {mode === "check" ? (
        <section className={ui.block} aria-label="To check">
          {check.count === 0 && <p className={styles.quiet}>Nothing to check. Everything the assistant read has your yes.</p>}
          {check.bills.length > 0 && (
            <div className={ui.block}>
              <h3 className={styles.sub}>Bills</h3>
              <ul className={styles.items}>
                {check.bills.map((b) => (
                  <li key={b.id}>
                    <div>
                      <b>
                        {b.biller} {fmt(b.amount)}
                      </b>
                      <span>
                        Due {dayLabel(b.due)} · {b.category} · from an email
                      </span>
                    </div>
                    <div className={ui.actions}>
                      <button className={cx(ui.btn, ui.primary)} type="button" onClick={() => dispatch({ type: "confirm", id: b.id })}>
                        Confirm
                      </button>
                      {stage === "bill" && b.id === persona.demo.billId && (
                        <button className={ui.btn} type="button" onClick={() => go("today", "needs-you")}>
                          Edit
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {check.charges.length > 0 && (
            <div className={ui.block}>
              <div className={ui.sectionHead}>
                <h3 className={styles.sub}>Card charges</h3>
                {check.charges.length > 1 && (
                  <button className={cx(ui.btn, ui.primary)} type="button" onClick={() => dispatch({ type: "chargeConfirmAll" })}>
                    Confirm all {check.charges.length}
                  </button>
                )}
              </div>
              <PendingList charges={check.charges} money={money} dispatch={dispatch} />
            </div>
          )}
          {check.drafts.length > 0 && (
            <div className={ui.block}>
              <h3 className={styles.sub}>Invoice drafts</h3>
              <ul className={styles.items}>
                {check.drafts.map((i) => {
                  const c = money.clients.find((x) => x.id === i.clientId);
                  return (
                    <li key={i.id}>
                      <div>
                        <b>
                          {c?.name ?? "Client"} {usd(i.amountUsd)}
                        </b>
                        <span>{i.item} · drafted by the assistant, nothing sent</span>
                      </div>
                      <div className={ui.actions}>
                        {i.id === persona.demo.invoiceId && stage === "approve" && (
                          <button className={cx(ui.btn, ui.primary)} type="button" onClick={approve}>
                            Approve and send
                          </button>
                        )}
                        <button className={ui.btn} type="button" onClick={() => go("today", "needs-you")}>
                          Review
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      ) : (
        <section className={ui.block} aria-labelledby="activity-h">
          <div className={ui.sectionHead}>
            <h3 id="activity-h">All activity</h3>
            <small>Every AI step, approval, charge, bill and PayPal call</small>
          </div>
          <ul className={styles.feed}>
            {rows.map((e) => (
              <li key={e.key} className={e.fresh ? styles.fresh : undefined}>
                <span className={styles.tm}>
                  {e.date === money.today && e.tm ? e.tm : dayLabel(e.date)}
                </span>
                <span className={cx(styles.who, e.tone)}>{e.who}</span>
                <span className={styles.tx}>
                  {e.text}
                  {e.tool && (
                    <>
                      {" "}
                      <code>{e.tool}</code>
                    </>
                  )}
                  <span className={styles.src}>via {e.source.toLowerCase() === "in app" ? "the app" : e.source}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
