"use client";

import { useMemo, useState, type ActionDispatch } from "react";
import { MomentCard } from "@/components/moments/MomentCard";
import { closingOnOrAfter, context, cycle, paybackFor, pendingCharges, roomOnCard, statementItems } from "@/lib/money/runway";
import type { Card, Charge, MoneyState } from "@/lib/money/types";
import { useApp } from "./AppContext";
import { ChargeMoment, StatementNotice } from "./CardMoments";
import { cx } from "./cx";
import { nextStatement } from "./fix";
import { dayLabel, homeFormat, spanLabel, usd } from "./format";
import styles from "./Rail.module.css";
import tabStyles from "./Cards.module.css";
import type { Action } from "./state";
import ui from "./ui.module.css";

type Dispatch = ActionDispatch<[Action]>;

/** "month end" for 31, "the 15th" otherwise. */
function ordinal(day: number): string {
  if (day >= 31) return "month end";
  const v = day % 100;
  const suffix = v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][day % 10] ?? "th";
  return `the ${day}${suffix}`;
}

/** The Cards tab: card moments on top, then each card with what pays it back, then this cycle's charges. */
export function CardsTab() {
  const { money, profile, persona, state, stage, dispatch, go, fmt } = useApp();
  const { trip, runId, opened } = state;
  const [filter, setFilter] = useState<Filter>("all");

  // The statement demo uses the soonest closed statement still to pay, read from the data.
  const statement = useMemo(() => statementItems(money).find((st) => !st.open) ?? statementItems(money)[0], [money]);
  const statementMoment = useMemo(
    () =>
      context(money, profile, "statement_arrived", {
        kind: "statement",
        label: statement ? `${statement.label} ${fmt(statement.amount)}, due ${dayLabel(statement.dueOn)}` : "Card statement",
        ...(statement ? { amount: statement.amount, currency: money.homeCurrency } : {}),
      }),
    [money, profile, statement, fmt],
  );

  // The charge moment: shown once the travel demo has sent a charge, and for any charge waiting to be confirmed.
  const lastCharge = useMemo(() => {
    for (let i = trip.length - 1; i >= 0; i--) {
      const c = money.charges.find((x) => x.id === trip[i]);
      if (c) return c;
    }
    return undefined;
  }, [trip, money.charges]);
  const showCharge = trip.length > 0 || money.charges.some((c) => c.status === "pending");
  const chargeCardId = lastCharge?.cardId ?? persona.demo.trip.cardId;
  const chargeMoment = useMemo(() => {
    const card = money.cards.find((c) => c.id === lastCharge?.cardId);
    return lastCharge && card
      ? context(money, profile, "charge_arrived", { kind: "charge", label: `${card.label} ${fmt(lastCharge.amount)} at ${lastCharge.merchant}`, amount: lastCharge.amount, currency: money.homeCurrency })
      : null;
  }, [money, profile, lastCharge, fmt]);

  const toFix = () => go("today", "needs-you");

  return (
    <div className={tabStyles.page}>
      {(showCharge || opened.includes("statement")) && (
        <div className={tabStyles.moments}>
          {showCharge && (
            <div id="moment-charge" className={tabStyles.slot}>
              <ChargeMoment money={money} cardId={chargeCardId} stage={stage} dispatch={dispatch} onFix={toFix} />
              {chargeMoment && <MomentCard key={`charge-${runId}`} profile={profile} context={chargeMoment} />}
            </div>
          )}
          {opened.includes("statement") && (
            <div id="moment-statement" className={tabStyles.slot}>
              {statement && <StatementNotice money={money} cardId={statement.cardId} stage={stage} onFix={toFix} />}
              <MomentCard key={`statement-${runId}`} profile={profile} context={statementMoment} empty={<p className={tabStyles.nothing}>Nothing to add for this statement.</p>} />
            </div>
          )}
        </div>
      )}
      <div className={tabStyles.grid}>
        <section className={ui.block} aria-labelledby="cards-h">
          <div className={ui.sectionHead}>
            <h3 id="cards-h">Cards</h3>
            <small>from card emails and receipts</small>
          </div>
          <Room money={money} />
          <ul className={styles.cards}>
            {money.cards.map((c) => (
              <CardRow key={`${runId}-${c.id}`} card={c} money={money} dispatch={dispatch} />
            ))}
          </ul>
        </section>
        <Charges money={money} filter={filter} onFilter={setFilter} />
      </div>
    </div>
  );
}

type Filter = "all" | "home" | "abroad";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "home", label: "At home" },
  { id: "abroad", label: "Abroad" },
];

/** Abroad = a charge with a place. */
const abroad = (c: Charge) => !!c.place;

/** The charges of the cycle that is still open on a card, confirmed and waiting, oldest first. */
function cycleRows(money: MoneyState, card: Card): Charge[] {
  const cy = cycle(money, card.id);
  const waiting = pendingCharges(money, card.id).filter((c) => closingOnOrAfter(card, c.date) === cy.closesOn);
  return [...cy.charges, ...waiting].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
}

type Trip = { place: string; charges: Charge[]; total: number; from: string; to: string; waiting: number };

/** Two or more charges in one place on one card are a trip. */
function tripsOf(rows: Charge[]): Trip[] {
  const byPlace = new Map<string, Charge[]>();
  for (const c of rows) if (c.place) byPlace.set(c.place, [...(byPlace.get(c.place) ?? []), c]);
  return [...byPlace.entries()]
    .filter(([, list]) => list.length >= 2)
    .map(([place, charges]) => {
      const dates = charges.map((c) => c.date).sort();
      return { place, charges, total: charges.reduce((sum, c) => sum + c.amount, 0), from: dates[0], to: dates[dates.length - 1], waiting: charges.filter((c) => c.status === "pending").length };
    });
}

function Charges({ money, filter, onFilter }: { money: MoneyState; filter: Filter; onFilter: (f: Filter) => void }) {
  return (
    <section className={ui.block} aria-labelledby="charges-h">
      <div className={ui.sectionHead}>
        <h3 id="charges-h">This cycle&apos;s charges</h3>
        <small>charges since each statement closed</small>
      </div>
      <div className={tabStyles.chips} role="group" aria-label="Which charges to show">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => onFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {money.cards.map((card) => (
        <CardCharges key={card.id} card={card} money={money} filter={filter} />
      ))}
    </section>
  );
}

function CardCharges({ card, money, filter }: { card: Card; money: MoneyState; filter: Filter }) {
  const fmt = homeFormat(money);
  const cy = cycle(money, card.id);
  const all = cycleRows(money, card);
  const trips = filter === "home" ? [] : tripsOf(all);
  const inTrip = new Set(trips.flatMap((t) => t.charges.map((c) => c.id)));
  const rest = all.filter((c) => !inTrip.has(c.id) && (filter === "all" || (filter === "abroad" ? abroad(c) : !abroad(c))));
  return (
    <div className={tabStyles.cardBlock}>
      <div className={tabStyles.cardHead}>
        <b>{card.label}</b>
        <span>
          {fmt(cy.openTotal)} · closes {dayLabel(cy.closesOn)}
        </span>
      </div>
      {trips.map((t) => (
        <TripCard key={t.place} trip={t} card={card} money={money} />
      ))}
      {rest.length > 0 && <ul className={tabStyles.rows}>{rest.map((c) => <ChargeRow key={c.id} charge={c} fmt={fmt} />)}</ul>}
      {trips.length === 0 && rest.length === 0 && <p className={tabStyles.empty}>{filter === "abroad" ? "No charges abroad this cycle." : filter === "home" ? "No charges at home this cycle." : "No charges this cycle."}</p>}
    </div>
  );
}

function ChargeRow({ charge, fmt, showPlace = true }: { charge: Charge; fmt: (n: number) => string; showPlace?: boolean }) {
  return (
    <li className={tabStyles.row}>
      <span className={tabStyles.rdt}>{dayLabel(charge.date)}</span>
      <span className={tabStyles.rwhat}>
        {charge.merchant}
        {showPlace && charge.place && <span className={tabStyles.place}>{charge.place}</span>}
        {charge.status === "pending" && <span className={tabStyles.pend}>to confirm</span>}
      </span>
      <span className={tabStyles.ram}>{fmt(charge.amount)}</span>
    </li>
  );
}

/** "Trip: Taipei · Nov 14–15 · 6 charges · ¥32,700" and what it did to the room on the card. */
function TripCard({ trip, card, money }: { trip: Trip; card: Card; money: MoneyState }) {
  const fmt = homeFormat(money);
  const ids = new Set(trip.charges.map((c) => c.id));
  const without: MoneyState = { ...money, charges: money.charges.filter((c) => !ids.has(c.id)) };
  const withAll: MoneyState = { ...money, charges: money.charges.map((c) => (ids.has(c.id) ? { ...c, status: "confirmed" as const } : c)) };
  const before = roomOnCard(without, card.id).room;
  const after = roomOnCard(withAll, card.id).room;
  const span = spanLabel(trip.from, trip.to);
  return (
    <section className={tabStyles.trip} aria-label={`Trip: ${trip.place}`}>
      <h4>
        Trip: {trip.place} · {span} · {trip.charges.length} charges · {fmt(trip.total)}
      </h4>
      <p className={tabStyles.room}>
        Room on {card.label}:{" "}
        <b>
          {fmt(before)} → {fmt(after)}
        </b>
        {trip.waiting > 0 && ` once you confirm the ${trip.waiting === trip.charges.length ? "" : "other "}${trip.waiting} waiting`}
      </p>
      <ul className={tabStyles.rows}>
        {trip.charges.map((c) => (
          <ChargeRow key={c.id} charge={c} fmt={fmt} showPlace={false} />
        ))}
      </ul>
    </section>
  );
}

/** Where the card's next statement is paid from: the bank, or a client's payment, named with its dates. */
function PaysBack({ card, money }: { card: Card; money: MoneyState }) {
  const fmt = homeFormat(money);
  const pb = paybackFor(money, card.id);
  if (!pb) return null;
  const due = dayLabel(pb.dueOn);
  const who = (a: (typeof pb.arrivals)[number]) => `${a.clientName} (${usd(a.amountUsd)}) · expected ${dayLabel(a.expectedOn)}, late ${dayLabel(a.worstOn)}`;
  if (pb.source === "bank") {
    return (
      <p className={styles.payback}>
        <b>Pays back from</b> the bank on {due}. {fmt(pb.cashBalance)} would be left after it, even if no client pays.
      </p>
    );
  }
  if (pb.source === "clients") {
    return (
      <p className={styles.payback}>
        <b>Pays back from</b> {pb.arrivals.map(who).join("; ")}. The bank alone would be {fmt(-pb.cashBalance)} short on {due}.
      </p>
    );
  }
  return (
    <p className={cx(styles.payback, styles.paybackBad)}>
      <b>Not covered:</b> {fmt(-pb.worstBalance)} short on {due} in the worst case. Waiting on {pb.arrivals.length ? pb.arrivals.map(who).join("; ") : "a payment that is not invoiced yet"}.
    </p>
  );
}

/** One budget under the cards: the figures overlap, so they are not added up. */
function Room({ money }: { money: MoneyState }) {
  const fmt = homeFormat(money);
  if (money.cards.length === 0) return null;
  const rooms = money.cards.map((c) => ({ label: c.label, room: roomOnCard(money, c.id).room }));
  const same = rooms.every((r) => r.room === rooms[0].room);
  return (
    <p className={styles.roomLine}>
      Room to charge, worst case:{" "}
      {same ? (
        <b className={styles.room}>{fmt(rooms[0].room)} across your cards</b>
      ) : (
        <>
          {rooms.map((r, i) => (
            <span key={r.label}>
              {i > 0 && " · "}
              {r.label} <b className={styles.room}>{fmt(r.room)}</b>
            </span>
          ))}{" "}
          (one budget, not each)
        </>
      )}
    </p>
  );
}

function CardRow({ card, money, dispatch }: { card: Card; money: MoneyState; dispatch: Dispatch }) {
  const fmt = homeFormat(money);
  const [editing, setEditing] = useState(false);
  const cy = cycle(money, card.id);
  const waiting = pendingCharges(money, card.id).reduce((sum, c) => sum + c.amount, 0);
  const last = money.charges
    .filter((c) => c.cardId === card.id && c.status === "confirmed")
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0];
  const next = nextStatement(money, card.id);

  return (
    <li className={styles.cardRow}>
      <div className={styles.cardTop}>
        <b>{card.label}</b>
        <span className={styles.cardTotal}>
          {fmt(cy.openTotal)}
          <small>this cycle</small>
        </span>
      </div>
      <p className={styles.cardMeta}>
        closes {dayLabel(cy.closesOn)} · due {dayLabel(cy.dueOn)}
        {waiting > 0 && <span className={styles.pend}>{fmt(waiting)} to confirm</span>}
      </p>
      <p className={styles.cardMeta}>{last ? `Last charge: ${last.merchant} ${fmt(last.amount)} · ${dayLabel(last.date)}` : "No charges yet"}</p>
      <div className={styles.cardNext}>
        <span>{next ? `Next to pay ${fmt(next.amount)} on ${dayLabel(next.date)}${next.open ? " (so far)" : ""}` : "Nothing to pay in the next 30 days"}</span>
        {next && <span className={cx(ui.pill, styles.small, next.covered ? ui.good : ui.crit)}>{next.covered ? "Covered" : "Not covered"}</span>}
      </div>
      <PaysBack card={card} money={money} />
      {editing ? (
        <EditForm
          card={card}
          onCancel={() => setEditing(false)}
          onSave={(closingDay, dueDay) => {
            dispatch({ type: "editCard", cardId: card.id, patch: { closingDay, dueDay } });
            setEditing(false);
          }}
        />
      ) : (
        <button className={styles.link} type="button" onClick={() => setEditing(true)} aria-label={`Edit ${card.label} closing and due days`}>
          Edit
        </button>
      )}
    </li>
  );
}

const clampDay = (text: string, fallback: number) => {
  const n = parseInt(text, 10);
  return Number.isFinite(n) ? Math.min(31, Math.max(1, n)) : fallback;
};

function EditForm({ card, onSave, onCancel }: { card: Card; onSave: (closingDay: number, dueDay: number) => void; onCancel: () => void }) {
  const [closing, setClosing] = useState(String(card.closingDay));
  const [due, setDue] = useState(String(card.dueDay));
  const id = `card-${card.id}`;
  const c = clampDay(closing, card.closingDay);
  const d = clampDay(due, card.dueDay);
  return (
    <form
      className={styles.editForm}
      onSubmit={(e) => {
        e.preventDefault();
        onSave(c, d);
      }}
    >
      <label htmlFor={`${id}-close`}>
        Closes on day
        <input id={`${id}-close`} inputMode="numeric" value={closing} onChange={(e) => setClosing(e.target.value)} />
      </label>
      <label htmlFor={`${id}-due`}>
        Paid on day (next month)
        <input id={`${id}-due`} inputMode="numeric" value={due} onChange={(e) => setDue(e.target.value)} />
      </label>
      <p>
        Closes {ordinal(c)}, paid {ordinal(d)} of the next month. 31 means month end.
      </p>
      <div className={ui.actions}>
        <button className={cx(ui.btn, ui.primary, styles.tight)} type="submit">
          Save
        </button>
        <button className={cx(ui.btn, ui.ghost, styles.tight)} type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
