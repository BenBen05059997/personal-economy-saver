"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useAskPanel } from "@/components/shell/AskWorkspace";
import { listDevice } from "@/lib/store/device";
import "./get-started.css";

export type GetStartedProgress = { invoicePaid: boolean; billConfirmed: boolean; hasKey: boolean; answered: boolean; journalOnDevice: boolean };
const subscribe = (callback: () => void) => {
  window.addEventListener("storage", callback);
  window.addEventListener("pes-get-started-hidden", callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener("pes-get-started-hidden", callback); };
};

export function GetStarted({ householdId, progress, peopleCount }: { householdId: string; progress: GetStartedProgress; peopleCount: number }) {
  const panel = useAskPanel();
  const [locallyHidden, setLocallyHidden] = useState(false);
  const [deviceAnswered, setDeviceAnswered] = useState(false);
  const key = `pes-get-started-hidden:${householdId}`;
  const hidden = useSyncExternalStore(subscribe, () => {
    try { return localStorage.getItem(key) === "yes"; } catch { return false; }
  }, () => false);
  useEffect(() => {
    if (!progress.journalOnDevice) return;
    let active = true;
    void listDevice(householdId, "journal").then(turns => {
      if (active) setDeviceAnswered(turns.some(turn => turn.kind === "answer"));
    }).catch(() => { if (active) setDeviceAnswered(false); });
    return () => { active = false; };
  }, [householdId, progress.journalOnDevice, panel?.revision]);
  if (hidden || locallyHidden) return null;
  const steps = [
    { done: true, label: "Read the sentence and the forecast", href: "#next-30-days" },
    { done: progress.invoicePaid, label: "Approve Beacon’s invoice and watch the sentence change", href: "/invoices" },
    { done: progress.billConfirmed, label: "Check the Hikari Denki bill in To check", href: "/to-check" },
    { done: progress.hasKey && (progress.journalOnDevice ? deviceAnswered : progress.answered), label: "Add your AI key, then ask a question", href: "/settings#ai-model" },
    { done: peopleCount > 1, label: "Add a person who shares costs", href: "/settings#people" },
  ];
  const done = steps.filter(step => step.done).length;
  function hide() {
    setLocallyHidden(true);
    try { localStorage.setItem(key, "yes"); window.dispatchEvent(new Event("pes-get-started-hidden")); } catch { /* Device storage may be unavailable. */ }
  }
  return <StepsPanel id="get-started-title" title="Get started" meta={`${done} of 5 done`} progress={{ done, of: 5 }} onHide={hide}
    rows={steps.map(step => ({ done: step.done, label: step.label, href: step.href }))} />;
}

export type StepRow = { done: boolean; label: string; href?: string };

/** The panel Get started and a real household's First steps share: a header, an optional progress bar and one row per step. */
export function StepsPanel({ id, title, meta, progress, onHide, rows, sectionId }: { id: string; title: string; meta?: string; progress?: { done: number; of: number }; onHide?: () => void; rows: StepRow[]; sectionId?: string }) {
  return <section id={sectionId} className="get-started" aria-labelledby={id}>
    <div className="get-started-heading">
      <h2 id={id}>{title}</h2>
      {meta && <span className="get-started-meta">{meta}</span>}
      {progress && <div className="get-started-bar" role="progressbar" aria-label={`${progress.done} of ${progress.of} steps done`} aria-valuemin={0} aria-valuemax={progress.of} aria-valuenow={progress.done}><div style={{ width: `${(progress.done / progress.of) * 100}%` }} /></div>}
      {onHide && <button type="button" onClick={onHide}>Hide</button>}
    </div>
    <ol>{rows.map(row => {
      const body = <><span className="get-started-tick" aria-hidden="true">{row.done && <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3 3 7-7" /></svg>}</span>
        <span className="get-started-label">{row.label}</span><span className="sr-only">{row.done ? ", done" : ", not done"}</span></>;
      return <li key={row.label} className={row.done ? "get-started-done" : undefined}>
        {row.href ? <Link href={row.href} prefetch={false}>{body}</Link> : <div className="get-started-row">{body}</div>}</li>;
    })}</ol>
  </section>;
}
