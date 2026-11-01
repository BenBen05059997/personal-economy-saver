"use client";

import { useState, type ActionDispatch, type ReactNode } from "react";
import { low, project, series, type Rung } from "@/lib/money/runway";
import type { Bill, Invoice, MoneyState } from "@/lib/money/types";
import { cx } from "./cx";
import type { Persona } from "@/lib/sample/personas";
import { findInvoice } from "./demo";
import { fixLadder } from "./fix";
import { currencySymbol, dayLabel, group, homeFormat, parseAmount, previousMonthName, shortName, usdCents } from "./format";
import styles from "./NeedsYou.module.css";
import { stageOf, type Action } from "./state";
import ui from "./ui.module.css";

type Dispatch = ActionDispatch<[Action]>;

type Props = {
  persona: Persona;
  money: MoneyState;
  editing: boolean;
  dispatch: Dispatch;
  toast: (message: string) => void;
  onApprove: () => void;
  onReplay: () => void;
};

const CATEGORIES = ["Utilities · Electricity", "Utilities · Gas", "Phone", "Other"];

/** The one card that needs the person, whichever of the five stages the data is in. */
export function NeedsYou({ persona, money, editing, dispatch, toast, onApprove, onReplay }: Props) {
  const stage = stageOf(money, persona);
  const bill = money.bills.find((b) => b.status === "pending");
  const invoice = findInvoice(money, persona);
  const worst = low(series(money, "worst"));
  const fmt = homeFormat(money);

  if (stage === "none") return null;

  return (
    <section id="needs-you" className={cx(styles.needs, (stage === "bill" || stage === "approve") && styles.alert, stage === "paid" && styles.done)} aria-live="polite">
      {stage === "bill" && bill && <BillStage persona={persona} money={money} bill={bill} dispatch={dispatch} toast={toast} />}
      {stage === "approve" && invoice && <ApproveStage money={money} invoice={invoice} editing={editing} dispatch={dispatch} toast={toast} onApprove={onApprove} />}
      {stage === "sending" && (
        <>
          <div className={styles.head}>
            <h3>
              <span className={styles.spinner} />
              Sending through PayPal…
            </h3>
            <span className={cx(ui.pill, ui.acc)}>sandbox</span>
          </div>
          <p className={ui.tools}>send_invoice · {invoice?.number ?? persona.demo.invoiceNumber}</p>
        </>
      )}
      {stage === "sent" && invoice && <SentStage persona={persona} money={money} invoice={invoice} worstLow={worst.amount} dispatch={dispatch} />}
      {stage === "paid" && (
        <>
          <div className={styles.head}>
            <h3>{worst.amount >= 0 ? `Paid. ${dayLabel(worst.date)} is covered.` : `Paid. Still ${fmt(-worst.amount)} short on ${dayLabel(worst.date)}.`}</h3>
            <span className={cx(ui.pill, ui.good)}>Done</span>
          </div>
          <p className={styles.bigline}>+{usdCents(invoice?.amountUsd ?? 0)} arrived in PayPal</p>
          <div className={styles.proof}>
            <span>
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <circle cx="7" cy="7" r="6" fill="var(--good)" />
                <path d="M4 7.2 6 9l4-4" stroke="var(--surface)" strokeWidth="1.6" fill="none" strokeLinecap="round" />
              </svg>
              Webhook INVOICING.INVOICE.PAID, signature verified
            </span>
            <span>
              Lowest point now {fmt(worst.amount)} on {dayLabel(worst.date)}
            </span>
          </div>
          <div className={ui.actions}>
            <button className={ui.btn} type="button" onClick={onReplay}>
              Replay the demo
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ 1. new bill */

function BillStage({ persona, money, bill, dispatch, toast }: { persona: Persona; money: MoneyState; bill: Bill; dispatch: Dispatch; toast: Props["toast"] }) {
  const [amountText, setAmountText] = useState(group(bill.amount));
  const fmt = homeFormat(money);
  const slip = persona.demo.slip;

  // What the worst case would be with this bill confirmed.
  const after = low(series({ ...money, bills: money.bills.map((b) => (b.id === bill.id ? { ...b, status: "confirmed" as const } : b)) }, "worst"));
  const pct = bill.previousAmount ? Math.round((bill.amount / bill.previousAmount - 1) * 100) : null;
  const dueLabel = dayLabel(bill.due);

  return (
    <>
      <div className={styles.head}>
        <h3>New bill from your inbox</h3>
        <span className={cx(ui.pill, ui.warn)}>Check and confirm</span>
      </div>
      <div className={styles.bill}>
        <div className={styles.slip} aria-hidden="true">
          <div className={styles.slipHead}>
            <span>{bill.biller}</span>
            <span>{dayLabel(money.today).split(" ")[0]}</span>
          </div>
          <div>{slip.customer}</div>
          <div className={styles.slipBar} style={{ width: "70%" }} />
          <div className={styles.slipBar} style={{ width: "45%" }} />
          <div className={styles.slipLine}>
            <span>{slip.usage.label}</span>
            <span>{fmt(slip.usage.amount)}</span>
          </div>
          <div className={styles.slipLine}>
            <span>{slip.extra.label}</span>
            <span>{fmt(slip.extra.amount)}</span>
          </div>
          <div className={styles.slipLine}>
            <span>Due</span>
            <span>{dueLabel}</span>
          </div>
          <div className={styles.slipTotal}>
            <span>Total</span>
            <span>{fmt(bill.amount)}</span>
          </div>
        </div>
        <div className={styles.billBody}>
          <div className={styles.fields}>
            <div className={styles.field}>
              <label htmlFor="bill-name">Biller</label>
              <input id="bill-name" value={bill.biller} onChange={(e) => dispatch({ type: "editBill", patch: { biller: e.target.value } })} />
            </div>
            <div className={styles.field}>
              <label htmlFor="bill-amount">Amount ({currencySymbol(money.homeCurrency)})</label>
              <input
                id="bill-amount"
                inputMode="numeric"
                value={amountText}
                onChange={(e) => {
                  setAmountText(e.target.value);
                  dispatch({ type: "editBill", patch: { amount: parseAmount(e.target.value) } });
                }}
                onBlur={() => setAmountText(group(bill.amount))}
              />
              {pct !== null && bill.previousAmount !== undefined && (
                <span className={styles.hint}>
                  {pct >= 0 ? "+" : ""}
                  {pct}% vs {previousMonthName(bill.due)} ({fmt(bill.previousAmount)})
                </span>
              )}
            </div>
            <div className={styles.field}>
              <label htmlFor="bill-due">Due</label>
              <input
                id="bill-due"
                type="date"
                value={bill.due}
                onChange={(e) => {
                  if (e.target.value) dispatch({ type: "editBill", patch: { due: e.target.value } });
                }}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="bill-cat">Category</label>
              <select
                id="bill-cat"
                value={bill.category}
                onChange={(e) => {
                  dispatch({ type: "category", category: e.target.value });
                  toast(`Rule saved: ${bill.biller} → ${e.target.value}`);
                }}
              >
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <p className={styles.preview}>
            {after.amount < 0 ? (
              <>
                Adding this bill makes {dayLabel(after.date)} <b>{fmt(-after.amount)} short</b> in the worst case.
              </>
            ) : (
              "This bill fits. No shortfall."
            )}
          </p>
          <div className={ui.actions}>
            <button className={cx(ui.btn, ui.primary)} type="button" onClick={() => dispatch({ type: "confirm" })}>
              Confirm bill
            </button>
            <button className={cx(ui.btn, ui.ghost)} type="button" onClick={() => toast("In the app this archives the email. The demo keeps the bill.")}>
              Not a bill
            </button>
            <span className={ui.tools}>Read by AI from the emailed PDF</span>
          </div>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------- 2. options and approval */

function medianLow(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)] ?? 0;
}

/** The ways to cover a gap, cheapest first, with the pick marked. `action` adds a button under a rung. */
export function Ladder({ money, rungs, action }: { money: MoneyState; rungs: Rung[]; action?: (r: Rung) => ReactNode }) {
  return (
    <div className={styles.ladder}>
      <div className={styles.cap}>Ways to cover it, costed in {money.homeCurrency === "JPY" ? "yen" : "dollars"}</div>
      {rungs.map((r) => {
        const extra = action?.(r);
        return (
          <div key={r.id} className={cx(styles.rung, r.pick && styles.pick)}>
            <span className={styles.rungTitle}>{r.title}</span>
            <span className={styles.rungDetail}>{r.detail}</span>
            <span className={styles.rungCost}>
              <b>{r.costLabel}</b>
              <small>{r.verdict}</small>
            </span>
            {extra && <span className={styles.rungAction}>{extra}</span>}
          </div>
        );
      })}
    </div>
  );
}

function ApproveStage({
  money,
  invoice,
  editing,
  dispatch,
  toast,
  onApprove,
}: {
  money: MoneyState;
  invoice: Invoice;
  editing: boolean;
  dispatch: Dispatch;
  toast: Props["toast"];
  onApprove: () => void;
}) {
  const fmt = homeFormat(money);
  const lw = low(series(money, "worst"));
  const gap = Math.max(0, -lw.amount);
  const rungs = fixLadder(money);
  const client = money.clients.find((c) => c.id === invoice.clientId);
  const amountHome = Math.round(invoice.amountUsd * money.fxPerUsd);
  const lands = project(money, invoice, money.today).expectedOn;
  const history = client?.daysToPay ?? [];

  return (
    <>
      <div className={styles.head}>
        <h3>{gap > 0 ? `${fmt(gap)} short on ${dayLabel(lw.date)}. Cheapest fix first.` : `${dayLabel(lw.date)} is covered.`}</h3>
        <span className={cx(ui.pill, ui.crit)}>Needs your OK</span>
      </div>
      {rungs.length > 0 && <Ladder money={money} rungs={rungs} />}
      <div className={styles.approval}>
        <div className={styles.ah}>
          <b>Send this invoice through PayPal?</b>
          <span className={cx(ui.pill, ui.acc)}>Draft in PayPal</span>
        </div>
        <dl className={styles.payload}>
          <dt>To</dt>
          <dd>
            {client?.name} · {client?.email}
          </dd>
          <dt>Item</dt>
          <dd>
            {editing ? <input aria-label="Invoice item" value={invoice.item} onChange={(e) => dispatch({ type: "editInvoice", patch: { item: e.target.value } })} /> : invoice.item}
          </dd>
          <dt>Amount</dt>
          <dd>
            <span className={styles.amt}>{usdCents(invoice.amountUsd)}</span> &nbsp;
            {money.homeCurrency !== "USD" && (
              <span className={styles.dim}>
                about {fmt(amountHome)} at {fmt(money.fxPerUsd)}
              </span>
            )}
          </dd>
          <dt>Terms</dt>
          <dd>{client && client.termsDays > 0 ? `Net ${client.termsDays} days` : "Due on receipt"}</dd>
          <dt>Note</dt>
          <dd>
            {editing ? (
              <input aria-label="Invoice note" value={invoice.note ?? ""} autoFocus onChange={(e) => dispatch({ type: "editInvoice", patch: { note: e.target.value } })} />
            ) : (
              invoice.note
            )}
          </dd>
          <dt>Effect</dt>
          <dd>
            {history.length > 0 ? `${client?.name} paid its last ${history.length} invoices in about ${medianLow(history)} day${medianLow(history) === 1 ? "" : "s"}. ` : ""}
            Lands around {dayLabel(lands)}
            {gap > 0 ? ` and leaves ${fmt(Math.max(0, amountHome - gap))} to spare on ${dayLabel(lw.date)}.` : "."}
          </dd>
        </dl>
        <div className={styles.gate}>
          <div>
            <b>Costs</b>Nothing extra. The usual PayPal fee applies when {client ? shortName(client.name) : "the client"} pays.
          </div>
          <div>
            <b>Why you</b>The agent can only draft. Sending is yours.
          </div>
          <div>
            <b>Undo</b>Cancel it in PayPal any time before {client ? shortName(client.name) : "the client"} pays.
          </div>
        </div>
        <div className={styles.af}>
          <div className={ui.actions}>
            <button className={cx(ui.btn, ui.primary)} type="button" onClick={onApprove}>
              Approve and send
            </button>
            <button className={ui.btn} type="button" onClick={() => dispatch({ type: "editing", value: !editing })}>
              {editing ? "Done editing" : "Edit"}
            </button>
            <button
              className={cx(ui.btn, ui.ghost)}
              type="button"
              onClick={() => {
                toast("Kept as a draft. Nothing was sent.");
                dispatch({ type: "decline" });
              }}
            >
              Don&apos;t send
            </button>
          </div>
          <span className={ui.tools}>
            drafted by <code>create_invoice</code> · sends with <code>send_invoice</code>
          </span>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ 4. sent */

function SentStage({ persona, money, invoice, worstLow, dispatch }: { persona: Persona; money: MoneyState; invoice: Invoice; worstLow: number; dispatch: Dispatch }) {
  const client = money.clients.find((c) => c.id === invoice.clientId);
  const med = medianLow(client?.daysToPay ?? []);
  return (
    <>
      <div className={styles.head}>
        <h3>Invoice sent to {client?.name}</h3>
        <span className={cx(ui.pill, ui.acc)}>Waiting for payment</span>
      </div>
      <p className={styles.bigline}>
        {usdCents(invoice.amountUsd)} · {invoice.number ?? persona.demo.invoiceNumber}
      </p>
      <p className={styles.sub}>
        {client ? shortName(client.name) : "The client"} usually pays in about {med} day{med === 1 ? "" : "s"}. The runway already counts it as expected,{" "}
        {worstLow >= 0 ? "so the worst case is no longer short" : "so the shortfall is smaller"}. We&apos;ll tell you when PayPal confirms the payment.
      </p>
      <div className={ui.actions}>
        <button className={cx(ui.btn, ui.demo)} type="button" onClick={() => dispatch({ type: "paid" })}>
          Demo: {client ? shortName(client.name) : "The client"} pays in the sandbox
        </button>
      </div>
    </>
  );
}
