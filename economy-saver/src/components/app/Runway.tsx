"use client";

import { useMemo } from "react";
import { addDays, arrivals, dueItems, low, series } from "@/lib/money/runway";
import type { MoneyState } from "@/lib/money/types";
import type { Persona } from "@/lib/sample/personas";
import { dayLabel, homeFormat, shortName, usd } from "./format";
import styles from "./Runway.module.css";
import { cx } from "./cx";
import { RunwayChart } from "./RunwayChart";

const DAYS = 30;

export type View = "expected" | "worst";

/** The headline and the 30-day chart. `view` picks the line that stands out: expected, or the worst case (late clients). */
export function Runway({ persona, money, view = "worst" }: { persona: Persona; money: MoneyState; view?: View }) {
  const expected = useMemo(() => series(money, "expected", DAYS), [money]);
  const worst = useMemo(() => series(money, "worst", DAYS), [money]);

  const fmt = homeFormat(money);
  const lw = low(worst);
  const le = low(expected);
  const short = lw.amount < 0;
  const lastDay = addDays(money.today, DAYS - 1);
  const outTotal = dueItems(money, DAYS).filter((d) => !d.pending).reduce((sum, d) => sum + d.amount, 0);
  const owed = money.invoices.filter((i) => i.status === "sent").reduce((sum, i) => sum + i.amountUsd, 0);

  let why: string;
  if (short) {
    const late = [...new Set(arrivals(money).filter((a) => a.worstOn > lw.date).map((a) => shortName(a.clientName)))];
    const who = late.length ? `if ${late.join(" and ")} pay${late.length === 1 ? "s" : ""} as late as they usually do` : "if nothing new comes in before then";
    why = `Worst case, ${who}. ${le.amount < 0 ? `The expected line dips below ${fmt(0)} too.` : `The expected line stays above ${fmt(0)}.`}`;
  } else {
    why = `Even if every client pays late, the lowest point is ${fmt(lw.amount)} on ${dayLabel(lw.date)}.`;
  }

  return (
    <section className={styles.runway} aria-labelledby="status-h">
      <div className={styles.head}>
        <div className={styles.status}>
          <span className="eyebrow">Your runway · next {DAYS} days</span>
          <h2 id="status-h" className={cx(short ? styles.statusCrit : styles.statusGood)}>
            {short ? `${fmt(-lw.amount)} short on ${dayLabel(lw.date)}` : `Covered for the next ${DAYS} days`}
          </h2>
          <p>{why}</p>
        </div>
        <div className={styles.stats}>
          <div className={styles.stat}>
            <b>{fmt(money.paypal + money.bank)}</b>
            <span>Cash today</span>
          </div>
          <div className={styles.stat}>
            <b>{fmt(outTotal)}</b>
            <span>Bills and cards to {dayLabel(lastDay)}</span>
          </div>
          <div className={styles.stat}>
            <b>{usd(owed)}</b>
            <span>Clients owe you</span>
          </div>
        </div>
      </div>
      <div className={styles.legend} aria-hidden="true">
        <span className={styles.lx}>
          <i />
          Expected
        </span>
        <span className={styles.lw}>
          <i />
          Worst case (late clients)
        </span>
        <span className={styles.lg}>
          <i />
          Below {fmt(0)}
        </span>
      </div>
      <RunwayChart persona={persona} money={money} expected={expected} worst={worst} view={view} />
    </section>
  );
}
