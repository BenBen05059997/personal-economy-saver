"use client";

import { type ActionDispatch } from "react";
import { cycle, dueItems, pendingCharges, planWindow, type Rung } from "@/lib/money/runway";
import type { Charge, MoneyState } from "@/lib/money/types";
import { cx } from "./cx";
import { chargeAnswer, cheapestFix, fixButton } from "./fix";
import { dayLabel, homeFormat } from "./format";
import styles from "./CardMoments.module.css";
import type { Action, Stage } from "./state";
import ui from "./ui.module.css";

type Dispatch = ActionDispatch<[Action]>;

function Pill({ covered }: { covered: boolean | undefined }) {
  if (covered === undefined) return <span className={ui.pill}>After 30 days</span>;
  return <span className={cx(ui.pill, covered ? ui.good : ui.crit)}>{covered ? "Covered" : "Not covered"}</span>;
}

/** The shortfall fix: one line on what it is, and one button that takes the person to it. */
function Fix({ fix, stage, onFix }: { fix: Rung; stage: Stage; onFix: () => void }) {
  const label = fix.id === "invoice" ? fixButton(stage) : null;
  return (
    <div className={styles.fix}>
      <div>
        <b>Cheapest fix: {fix.title}</b>
        <span>
          {fix.detail}
          {fix.cost === 0 ? " Costs nothing extra." : ""}
        </span>
      </div>
      {label && (
        <button className={cx(ui.btn, ui.primary)} type="button" onClick={onFix}>
          {label}
        </button>
      )}
    </div>
  );
}

type ChargeProps = {
  money: MoneyState;
  cardId: string;
  stage: Stage;
  dispatch: Dispatch;
  onFix: () => void;
};

/** A card charge just arrived: confirm it, then see what it does to the statement and to "can I proceed?". */
export function ChargeMoment({ money, cardId, stage, dispatch, onFix }: ChargeProps) {
  const fmt = homeFormat(money);
  const card = money.cards.find((c) => c.id === cardId);
  if (!card) return null;
  const cy = cycle(money, cardId);
  const waiting = pendingCharges(money);
  const waitingOnCard = waiting.filter((c) => c.cardId === cardId);
  const waitingTotal = waitingOnCard.reduce((sum, c) => sum + c.amount, 0);
  const item = dueItems(money, planWindow(money)).find((d) => d.cardId === cardId && d.date === cy.dueOn && d.open);
  const answer = chargeAnswer(money, cardId);
  const checking = waiting.length > 0;

  return (
    <section className={cx(styles.card, !checking && !answer.ok && styles.alert, !checking && answer.ok && styles.done)} aria-live="polite" aria-labelledby="charge-h">
      <div className={styles.head}>
        <div>
          <span className="eyebrow">Card charge{waiting.length === 1 ? "" : "s"}</span>
          <h3 id="charge-h">
            {checking
              ? `${waiting.length} new charge${waiting.length === 1 ? "" : "s"} on ${card.label}. Check ${waiting.length === 1 ? "it" : "them"}.`
              : `${card.label} is ${fmt(cy.openTotal)} so far, due ${dayLabel(cy.dueOn)}`}
          </h3>
        </div>
        {checking ? <span className={cx(ui.pill, ui.warn)}>Check and confirm</span> : <Pill covered={item?.covered} />}
      </div>

      {waiting.length > 1 && (
        <div className={ui.actions}>
          <button className={cx(ui.btn, ui.demo)} type="button" onClick={() => dispatch({ type: "chargeConfirmAll" })}>
            Confirm all {waiting.length}
          </button>
        </div>
      )}
      {checking && <PendingList charges={waiting} money={money} dispatch={dispatch} />}

      <dl className={styles.facts}>
        <div>
          <dt>Running total on {card.label}</dt>
          <dd>
            <b>{fmt(cy.openTotal)}</b>
            {waitingTotal > 0 && <small>+ {fmt(waitingTotal)} waiting for you</small>}
          </dd>
        </div>
        <div>
          <dt>Statement closes</dt>
          <dd>
            <b>{dayLabel(cy.closesOn)}</b>
          </dd>
        </div>
        <div>
          <dt>Due</dt>
          <dd>
            <b>{dayLabel(cy.dueOn)}</b>
            {item ? <small>{item.covered ? `${fmt(item.worstBalance)} left after, worst case` : `${fmt(-item.worstBalance)} short, worst case`}</small> : <small>after the next 30 days</small>}
          </dd>
        </div>
      </dl>

      <div className={styles.answer}>
        <span className={styles.q}>Can I proceed?</span>
        <p>{answer.text}</p>
        {answer.note && <p>{answer.note}</p>}
        {checking && answer.ok && <p className={styles.note}>Confirmed charges only. Anything waiting is not counted yet.</p>}
      </div>
      {answer.fix && <Fix fix={answer.fix} stage={stage} onFix={onFix} />}
    </section>
  );
}

/** Charges read from card emails and receipts, each with Confirm and Not mine. */
export function PendingList({ charges, money, dispatch }: { charges: Charge[]; money: MoneyState; dispatch: Dispatch }) {
  return (
    <ul className={styles.pending}>
      {charges.map((c) => (
        <PendingRow key={c.id} charge={c} money={money} dispatch={dispatch} />
      ))}
    </ul>
  );
}

function PendingRow({ charge, money, dispatch }: { charge: Charge; money: MoneyState; dispatch: Dispatch }) {
  const fmt = homeFormat(money);
  const card = money.cards.find((c) => c.id === charge.cardId);
  return (
    <li className={styles.row}>
      <div className={styles.what}>
        <b>{charge.merchant}</b>
        <span>
          {card?.label ?? "Card"} · {charge.place ? `${charge.place} · ` : ""}
          {dayLabel(charge.date)}
        </span>
      </div>
      <span className={styles.amt}>{fmt(charge.amount)}</span>
      <div className={styles.btns}>
        <button className={cx(ui.btn, ui.primary)} type="button" onClick={() => dispatch({ type: "chargeConfirm", id: charge.id })}>
          Confirm
        </button>
        <button className={cx(ui.btn, ui.ghost)} type="button" onClick={() => dispatch({ type: "chargeReject", id: charge.id })}>
          Not mine
        </button>
      </div>
    </li>
  );
}

/** The statement demo: the real closed statement from the data, whether it is covered, and what to do. */
export function StatementNotice({ money, cardId, stage, onFix }: { money: MoneyState; cardId: string; stage: Stage; onFix: () => void }) {
  const fmt = homeFormat(money);
  const card = money.cards.find((c) => c.id === cardId);
  const item = dueItems(money, 30).find((d) => d.cardId === cardId && !d.open);
  if (!card || !item) return null;
  const fix = item.covered ? undefined : cheapestFix(money);
  return (
    <section className={cx(styles.card, item.covered ? styles.done : styles.alert)}>
      <div className={styles.head}>
        <div>
          <span className="eyebrow">Statement arrived</span>
          <h3>
            {card.label} statement {fmt(item.amount)}, due {dayLabel(item.date)}
          </h3>
        </div>
        <Pill covered={item.covered} />
      </div>
      <p className={styles.line}>
        {item.covered ? (
          <>
            Pay it in full from the bank on {dayLabel(item.date)}. Even if clients pay late you still have {fmt(item.worstBalance)} after it.
          </>
        ) : (
          <>
            Not covered yet. Pay it in full from the bank on {dayLabel(item.date)}, but in the worst case you are {fmt(-item.worstBalance)} short that day.
          </>
        )}
      </p>
      {fix && <Fix fix={fix} stage={stage} onFix={onFix} />}
    </section>
  );
}
