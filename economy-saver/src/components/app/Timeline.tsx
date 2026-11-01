import type { TimelineEvent } from "@/lib/money/runway";
import { cx } from "./cx";
import { dayLabel } from "./format";
import styles from "./Timeline.module.css";
import ui from "./ui.module.css";

/** A date on the timeline that moves no money: a tax date from the "Coming up" list. */
export type TaxDate = { id: string; date: string; title: string; value: string };

export type Row =
  | { type: "money"; event: TimelineEvent }
  | { type: "tax"; tax: TaxDate };

/** Money events and tax dates in date order; a tax date sits after the money of its day. */
export function rows(events: TimelineEvent[], taxes: TaxDate[] = []): Row[] {
  const out: Row[] = events.map((event) => ({ type: "money" as const, event }));
  for (const tax of taxes) {
    const at = out.findIndex((r) => r.type === "money" && r.event.date > tax.date);
    out.splice(at < 0 ? out.length : at, 0, { type: "tax", tax });
  }
  return out;
}

function eventText(e: TimelineEvent, late: boolean): string {
  if (e.kind === "arrival") {
    const num = e.number ? (/^\d+$/.test(e.number) ? ` #${e.number}` : ` ${e.number}`) : "";
    return `${e.label} pays${num}${late ? " (late)" : " (expected)"}`;
  }
  if (e.kind === "statement") return `${e.label}${e.open ? " (so far)" : ""}`;
  return e.label;
}

type Props = {
  events: TimelineEvent[];
  taxes?: TaxDate[];
  fmt: (n: number) => string;
  late: boolean; // arrivals are the worst-case ones
  start?: { balance: number }; // the cash today row at the top
  label: string;
};

/** Every dated event with the balance after it and whether the day is covered. */
export function Timeline({ events, taxes, fmt, late, start, label }: Props) {
  const list = rows(events, taxes);
  return (
    <ol className={styles.list} aria-label={label}>
      {start && (
        <li className={styles.row}>
          <span className={styles.dt}>Today</span>
          <span className={styles.what}>Cash in PayPal and the bank</span>
          <span className={styles.am} />
          <span className={styles.bal}>{fmt(start.balance)}</span>
          <span className={styles.tag} />
        </li>
      )}
      {list.map((r) => {
        if (r.type === "tax") {
          return (
            <li key={`tax-${r.tax.id}`} className={cx(styles.row, styles.taxRow)}>
              <span className={styles.dt}>{dayLabel(r.tax.date)}</span>
              <span className={styles.what}>{r.tax.title}</span>
              <span className={styles.am} />
              <span className={styles.bal}>{r.tax.value}</span>
              <span className={styles.tag}>
                <span className={ui.pill}>Tax date</span>
              </span>
            </li>
          );
        }
        const e = r.event;
        return (
          <li key={e.id} className={styles.row}>
            <span className={styles.dt}>{dayLabel(e.date)}</span>
            <span className={styles.what}>
              {eventText(e, late)}
              {e.pending && <span className={styles.pend}>to confirm</span>}
            </span>
            <span className={cx(styles.am, e.amount > 0 && styles.in)}>
              {e.amount > 0 ? "+" : ""}
              {fmt(e.amount)}
            </span>
            <span className={cx(styles.bal, e.balance < 0 && styles.neg)}>{e.pending ? "" : fmt(e.balance)}</span>
            <span className={styles.tag}>
              {e.kind !== "arrival" && <span className={cx(ui.pill, e.covered ? ui.good : ui.crit)}>{e.covered ? "Covered" : "Not covered"}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
