"use client";

import { useId, useMemo, useState } from "react";
import type { Context, Profile, Suggestion } from "@/lib/catalogue/types";
import { DismissButtons, UndoLine } from "./Dismiss";
import { useDismissals } from "./dismissals";
import { cx, formatDeadline, formatValue } from "./format";
import { safeAllFor, safeComingUp } from "./safeEngine";
import { WhyDisclosure } from "./Why";
import styles from "./KnowPanel.module.css";

// Right-hand rail. Props type is the contract with the page; do not change its shape.
export type KnowPanelProps = { profile: Profile; context: Context };

const FIRST = 3;

function MoveCard({
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
  const insider = move.tier === "insider";
  const urgency = dueInDays === undefined ? "" : dueInDays <= 7 ? styles.urgent : dueInDays <= 30 ? styles.soon : "";
  return (
    <li className={styles.card}>
      <div className={styles.top}>
        <h3 className={styles.title}>{move.title}</h3>
        <span className={styles.val}>{formatValue(value)}</span>
      </div>
      <div className={styles.chips}>
        {insider ? (
          <span className={cx(styles.chip, styles.chipInsider)}>
            <b>insider</b>
            {move.knownBy && <span>what {move.knownBy} know</span>}
          </span>
        ) : (
          <span className={styles.chip}>baseline</span>
        )}
        {dueInDays !== undefined && (
          <span className={cx(styles.deadline, urgency)} title={move.deadline?.label}>
            {formatDeadline(today, dueInDays)}
          </span>
        )}
      </div>
      <div className={styles.foot}>
        <WhyDisclosure s={s} />
        <DismissButtons onLater={onLater} onNever={onNever} />
      </div>
    </li>
  );
}

function Basics({ items, today }: { items: Suggestion[]; today: string }) {
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const baseId = useId();
  if (!items.length) return null;
  const toggle = (id: string) =>
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <details className={styles.basics}>
      <summary>
        <span>The basics (most people know these)</span>
        <span className={styles.basicsCount}>
          {done.size}/{items.length}
        </span>
      </summary>
      <ul className={styles.checklist}>
        {items.map((s) => {
          const id = `${baseId}-${s.move.id}`;
          return (
            <li key={s.move.id} className={styles.check}>
              <div className={styles.checkRow}>
                <input
                  id={id}
                  type="checkbox"
                  checked={done.has(s.move.id)}
                  onChange={() => toggle(s.move.id)}
                />
                <label htmlFor={id}>
                  {s.move.title}
                  {s.dueInDays !== undefined && (
                    <span className={styles.deadline}> · {formatDeadline(today, s.dueInDays)}</span>
                  )}
                </label>
                <span className={styles.checkVal}>{formatValue(s.value)}</span>
              </div>
              <WhyDisclosure s={s} className={styles.checkWhy} />
            </li>
          );
        })}
      </ul>
    </details>
  );
}

export function KnowPanel({ profile, context }: KnowPanelProps) {
  const everything = useMemo(() => safeAllFor(profile, context), [profile, context]);
  const comingUp = useMemo(() => safeComingUp(profile, context), [profile, context]);
  const { get, later, never, undo } = useDismissals();
  // A move the "Coming up" strip already shows (same allowlist, same dismissal rule) is not repeated here.
  const onStrip = new Set(comingUp.filter((s) => get(s.move.id) === undefined).map((s) => s.move.id));
  const all = everything.filter((s) => !onStrip.has(s.move.id));
  const [showAll, setShowAll] = useState(false);

  const insider = all.filter((s) => s.move.tier === "insider" && get(s.move.id) !== "later");
  const baseline = all.filter((s) => s.move.tier !== "insider");
  const shown = showAll ? insider : insider.slice(0, FIRST);

  return (
    <section className={styles.panel} aria-labelledby="know-heading">
      <header className={styles.head}>
        <h2 id="know-heading" className={styles.eyebrow}>
          Found for you
        </h2>
        <p className={styles.lede}>
          Other ways to keep more, from your numbers. Not urgent.
        </p>
      </header>

      {all.length === 0 && (
        <p className={styles.empty}>
          Nothing found yet. As your income and bills come in, the moves that fit them will show up here.
        </p>
      )}

      {shown.length > 0 && (
        <ul className={styles.list}>
          {shown.map((s) =>
            get(s.move.id) === "never" ? (
              <li key={s.move.id}>
                <UndoLine title={s.move.title} onUndo={() => undo(s.move.id)} />
              </li>
            ) : (
              <MoveCard
                key={s.move.id}
                s={s}
                today={context.today}
                onLater={() => later(s.move.id)}
                onNever={() => never(s.move.id)}
              />
            ),
          )}
        </ul>
      )}

      {insider.length > FIRST && (
        <button
          type="button"
          className={styles.more}
          aria-expanded={showAll}
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? "Show fewer" : `Show all ${insider.length}`}
        </button>
      )}

      <Basics items={baseline} today={context.today} />
    </section>
  );
}
