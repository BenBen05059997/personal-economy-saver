"use client";

import { useMemo, useState } from "react";
import { formatValue } from "@/components/know/format";
import { safeComingUp } from "@/components/know/safeEngine";
import { DeadlineStrip } from "@/components/moments/DeadlineStrip";
import { addDays, context, low, series, timeline } from "@/lib/money/runway";
import { useApp } from "./AppContext";
import { cx } from "./cx";
import { fixButton, fixLadder } from "./fix";
import { dayLabel } from "./format";
import { Ladder } from "./NeedsYou";
import styles from "./Plan.module.css";
import { Runway, type View } from "./Runway";
import { Timeline, type TaxDate } from "./Timeline";
import ui from "./ui.module.css";
import { WhoPays } from "./WhoPays";

const DAYS = 30;

const VIEWS: { id: View; label: string; hint: string }[] = [
  { id: "expected", label: "Expected", hint: "Every client pays on their usual day." },
  { id: "worst", label: "If clients pay late", hint: "Every client pays as late as they ever have." },
];

export function Plan() {
  const { money, profile, persona, state, stage, fmt, go } = useApp();
  const [view, setView] = useState<View>("worst");

  const events = useMemo(() => timeline(money, view, DAYS), [money, view]);
  const deadline = useMemo(() => context(money, profile, "deadline_near"), [money, profile]);
  const taxes = useMemo<TaxDate[]>(
    () =>
      safeComingUp(profile, deadline)
        .filter((s) => s.dueInDays !== undefined && s.dueInDays >= 0 && s.dueInDays < DAYS)
        .map((s) => ({ id: s.move.id, date: addDays(money.today, s.dueInDays ?? 0), title: s.move.title, value: formatValue(s.value) })),
    [profile, deadline, money.today],
  );

  const lw = low(series(money, "worst", DAYS));
  const rungs = useMemo(() => fixLadder(money), [money]);
  const gap = Math.max(0, -lw.amount);
  const label = fixButton(stage);
  const hint = VIEWS.find((v) => v.id === view)?.hint;

  return (
    <div className={styles.grid}>
      <div className={styles.col}>
        <div className={styles.toggleRow}>
          <div className={styles.toggle} role="group" aria-label="Which line to show">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" aria-pressed={view === v.id} onClick={() => setView(v.id)}>
                {v.label}
              </button>
            ))}
          </div>
          <span className={styles.hint}>{hint}</span>
        </div>
        <Runway key={persona.id} persona={persona} money={money} view={view} />
        <section className={styles.block} aria-labelledby="timeline-h">
          <div className={ui.sectionHead}>
            <h3 id="timeline-h">Timeline</h3>
            <small>{view === "worst" ? "clients pay as late as they ever have" : "clients pay on their usual day"}</small>
          </div>
          <Timeline events={events} taxes={taxes} fmt={fmt} late={view === "worst"} label="Every dated event with the balance after it" start={{ balance: money.paypal + money.bank }} />
        </section>
      </div>
      <div className={styles.col}>
        <WhoPays money={money} />
        <section className={styles.block} aria-labelledby="short-h">
          <div className={ui.sectionHead}>
            <h3 id="short-h">If you&apos;re short</h3>
            <small>{gap > 0 ? `${fmt(gap)} short on ${dayLabel(lw.date)}, worst case` : "nothing to cover"}</small>
          </div>
          {gap > 0 ? (
            <Ladder
              money={money}
              rungs={rungs}
              action={(r) =>
                r.id === "invoice" && label ? (
                  <button className={cx(ui.btn, ui.primary)} type="button" onClick={() => go("today", "needs-you")}>
                    {label}
                  </button>
                ) : null
              }
            />
          ) : (
            <p className={styles.quiet}>The worst case stays above {fmt(0)} for the next {DAYS} days. There is nothing to cover.</p>
          )}
        </section>
        <DeadlineStrip key={`deadline-${state.runId}`} profile={profile} context={deadline} />
      </div>
    </div>
  );
}
