"use client";

import { useId, useMemo, useState } from "react";
import type { Context, Profile } from "@/lib/catalogue/types";
import { useDismissals } from "../know/dismissals";
import { cx, formatDays, formatDueDate, formatValue } from "../know/format";
import { safeComingUp } from "../know/safeEngine";
import { WhyBody } from "../know/Why";
import styles from "./DeadlineStrip.module.css";

// The tax dates with real money attached. `withinDays` keeps only the ones that close that soon (Today's week); `caption`
// replaces the "Coming up" label, or hides it with null when the section around the strip already has one.
export type DeadlineStripProps = { profile: Profile; context: Context; withinDays?: number; caption?: string | null };

export function DeadlineStrip({ profile, context, withinDays, caption = "Coming up" }: DeadlineStripProps) {
  const list = useMemo(() => safeComingUp(profile, context), [profile, context]);
  const { get } = useDismissals();
  const [openId, setOpenId] = useState<string | null>(null);
  const panelId = useId();

  const shown = list.filter((s) => get(s.move.id) === undefined && (withinDays === undefined || (s.dueInDays !== undefined && s.dueInDays <= withinDays)));
  if (shown.length === 0) return null;
  const open = shown.find((s) => s.move.id === openId);

  return (
    <section className={styles.strip} aria-label="Coming up">
      {caption && <p className={styles.cap}>{caption}</p>}
      <ul className={styles.row}>
        {shown.map((s) => {
          const days = s.dueInDays;
          const tone = days === undefined ? "" : days <= 7 ? styles.urgent : days <= 30 ? styles.soon : "";
          const isOpen = open?.move.id === s.move.id;
          return (
            <li key={s.move.id}>
              <button
                type="button"
                className={styles.chip}
                aria-expanded={isOpen}
                aria-controls={isOpen ? panelId : undefined}
                onClick={() => setOpenId(isOpen ? null : s.move.id)}
              >
                {days !== undefined && (
                  <span className={styles.when}>
                    <span className={styles.date}>{formatDueDate(context.today, days)}</span>
                    <span className={cx(styles.days, tone)}>{days <= 0 ? "today" : `${days}d left`}</span>
                  </span>
                )}
                <span className={styles.what}>
                  <span className={styles.name}>{s.move.title}</span>
                  <span className={styles.val}>{formatValue(s.value)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {open && (
        <div id={panelId} className={styles.panel} role="region" aria-label={open.move.title}>
          <div className={styles.panelHead}>
            <h3 className={styles.panelTitle}>{open.move.title}</h3>
            {open.dueInDays !== undefined && (
              <span className={styles.panelMeta}>
                {open.move.deadline?.label ? `${open.move.deadline.label} · ` : ""}
                {formatDueDate(context.today, open.dueInDays)} · {formatDays(open.dueInDays)}
              </span>
            )}
          </div>
          <WhyBody s={open} />
          <button type="button" className={styles.close} onClick={() => setOpenId(null)}>
            Close
          </button>
        </div>
      )}
    </section>
  );
}
