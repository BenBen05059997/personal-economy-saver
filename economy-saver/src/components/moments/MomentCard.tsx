"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import type { Context, Moment, Profile, Suggestion } from "@/lib/catalogue/types";
import { DismissButtons, UndoLine } from "../know/Dismiss";
import { useDismissals } from "../know/dismissals";
import { cx, formatDeadline, formatDueDate, formatMoney, formatValue } from "../know/format";
import { safeSuggest } from "../know/safeEngine";
import { WhyDisclosure } from "../know/Why";
import { ConfirmStep } from "./ConfirmStep";
import styles from "./MomentCard.module.css";

// Main column. Props type is the contract with the page; `empty` is optional and says what to show
// when there is nothing to say (the card renders nothing at all without it).
export type MomentCardProps = { profile: Profile; context: Context; empty?: ReactNode };

const COUNT = ["", "One thing", "Two things", "Three things"];

function header(moment: Moment, event: Context["event"], n: number): { eyebrow: string; title: string } {
  const things = `${COUNT[Math.min(n, 3)] ?? "A few things"} worth doing with it.`;
  switch (moment) {
    case "client_paid": {
      const who = event?.label || "A client";
      const amount =
        event?.amount !== undefined && event.currency ? ` ${formatMoney(event.amount, event.currency)}` : "";
      return { eyebrow: "Just landed", title: `${who} paid${amount}. ${things}` };
    }
    case "bill_arrived":
      return {
        eyebrow: event?.label ? `New bill · ${event.label}` : "New bill",
        title: "While you're looking at this bill",
      };
    case "statement_arrived":
      return {
        eyebrow: event?.label ? `Statement · ${event.label}` : "Statement",
        title: "Before you pay this statement",
      };
    case "surplus_month":
      return { eyebrow: "Room to spare", title: "A quiet month. Here's what it's good for." };
    case "deadline_near":
      return { eyebrow: "Dates coming up", title: "These have a date on them" };
    case "life_event":
      return {
        eyebrow: event?.label ?? "Something changed",
        title: "A change like this opens a few doors",
      };
    case "windfall":
      return { eyebrow: "Bigger than usual", title: "A larger payment. Worth a plan before it disappears." };
    default:
      return { eyebrow: "The basics", title: "Worth doing once" };
  }
}

type Phase = "idle" | "confirm" | "done";

function MomentItem({
  s,
  today,
  onLater,
  onNever,
}: {
  s: Suggestion;
  today: string;
  onLater: () => void;
  onNever: () => void;
}) {
  const { move, value, dueInDays } = s;
  const [phase, setPhase] = useState<Phase>("idle");
  const insider = move.tier === "insider";
  const action = move.steps?.[0] ?? "Add to my list";
  const urgency = dueInDays === undefined ? "" : dueInDays <= 7 ? styles.urgent : dueInDays <= 30 ? styles.soon : "";
  const remind =
    move.deadline && dueInDays !== undefined
      ? ` We'll remind you before the deadline (${move.deadline.label}, ${formatDueDate(today, dueInDays)}).`
      : "";

  return (
    <li className={cx(styles.item, phase === "done" && styles.itemDone)}>
      {move.question && <p className={styles.question}>&ldquo;{move.question}&rdquo;</p>}
      <p className={styles.fact}>{move.fact}</p>
      <div className={styles.valueRow}>
        <span className={styles.val}>{formatValue(value)}</span>
        {move.illustrative && (
          <span className={styles.sample} title="This number uses example figures, not verified ones">
            sample figure
          </span>
        )}
        {dueInDays !== undefined && (
          <span className={cx(styles.deadline, urgency)}>{formatDeadline(today, dueInDays)}</span>
        )}
      </div>
      {value.basis && <p className={styles.basis}>{value.basis}</p>}

      {insider && (
        <>
          <span className={styles.insider}>
            <b>insider</b>
            {move.knownBy && <span>what {move.knownBy} know</span>}
          </span>
          {(move.exitNote || move.taxNote) && (
            <div className={styles.notes}>
              {move.exitNote && (
                <p className={styles.note}>
                  <b>How to get out</b>
                  {move.exitNote}
                </p>
              )}
              {move.taxNote && (
                <p className={styles.note}>
                  <b>Tax</b>
                  {move.taxNote}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {phase === "idle" && (
        <button type="button" className={styles.action} onClick={() => setPhase("confirm")}>
          {action}
        </button>
      )}
      {phase === "confirm" && (
        <ConfirmStep
          detail="You stay in charge. This saves it to your list; nothing is sent or paid from here."
          onConfirm={() => setPhase("done")}
          onCancel={() => setPhase("idle")}
        />
      )}
      {phase === "done" && (
        <p className={styles.done} role="status">
          Saved to your list.{remind}
        </p>
      )}

      <div className={styles.foot}>
        <WhyDisclosure s={s} showFact={false} showNotes={!insider} />
        {phase !== "done" && <DismissButtons onLater={onLater} onNever={onNever} />}
      </div>
    </li>
  );
}

export function MomentCard({ profile, context, empty }: MomentCardProps) {
  // D7: one suggestion per event, the top one (pinned moves come first).
  const suggestions = useMemo(() => safeSuggest(profile, context, 1), [profile, context]);
  const { get, later, never, undo } = useDismissals();
  const headingId = useId();

  const shown = suggestions.filter((s) => get(s.move.id) !== "later");
  if (shown.length === 0) return <>{empty}</>;

  const active = shown.filter((s) => get(s.move.id) !== "never").length;
  const { eyebrow, title } = header(context.moment, context.event, active || shown.length);

  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h2 id={headingId} className={styles.title}>
          {title}
        </h2>
      </header>
      <ul className={styles.list}>
        {shown.map((s) =>
          get(s.move.id) === "never" ? (
            <li key={s.move.id}>
              <UndoLine title={s.move.title} onUndo={() => undo(s.move.id)} />
            </li>
          ) : (
            <MomentItem
              key={s.move.id}
              s={s}
              today={context.today}
              onLater={() => later(s.move.id)}
              onNever={() => never(s.move.id)}
            />
          ),
        )}
      </ul>
    </section>
  );
}
