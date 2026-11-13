"use client";

import type { ReactNode } from "react";
import { DISPLAY_OPTIONS, PanelHeader, Segmented, useDevicePreference } from "@/components/home/hv-parts";
import type { ViewResult } from "@/lib/views/types";
import { PinView } from "./PinView";
import { ViewCard, type ViewMode } from "./ViewCard";
import "@/components/home/home-views.css";
import "./views.css";

export type PanelQuestion = { key: string; label: string; result: ViewResult; figure: ReactNode; tableSlot?: ReactNode; heading?: ReactNode };

/** The one panel every view lives in: header with Ask about this, a question switch when there are several (`switchLabel` is its visible caption), Display Chart | Table (both remembered on this device as `<question>|<mode>`), the card, notes and Pin to Home. `readOnly` (the family link) has neither Ask nor Pin. `device` is the household id when canvases are kept on this device. */
export function ViewPanel({ id, questions, nav, notes, readOnly, device, switchLabel }: { id: string; questions: PanelQuestion[]; nav?: ReactNode; notes?: string[]; readOnly?: boolean; device?: { householdId: string }; switchLabel?: string }) {
  const [stored, save] = useDevicePreference(`fipa-view:${id}`, `${questions[0].key}|chart`);
  const [wanted, wantedMode] = stored.split("|");
  const current = questions.find(item => item.key === wanted) ?? questions[0];
  const mode: ViewMode = wantedMode === "table" && current.result.table ? "table" : "chart";
  const { result } = current;
  return <section className="home-panel hv-panel view-panel">
    <PanelHeader title={current.heading ?? result.title} hint={result.hint} question={readOnly ? undefined : result.question} />
    {nav}
    {!result.empty && <div className="hv-controls">
      {questions.length > 1 ? <div className="hv-look">{switchLabel && <span aria-hidden="true">{switchLabel}</span>}<Segmented label={switchLabel ?? "Question"} value={current.key} options={questions.map(item => [item.key, item.label] as const)} onPick={next => save(`${next}|${mode}`)} /></div> : <span />}
      {result.table && <Segmented label="Display" value={mode} options={DISPLAY_OPTIONS} onPick={next => save(`${current.key}|${next}`)} />}
    </div>}
    <ViewCard result={result} figure={current.figure} tableSlot={current.tableSlot} mode={mode} onMode={next => save(`${current.key}|${next}`)} />
    {notes?.map(note => <p className="hv-note" key={note}>{note}</p>)}
    {!readOnly && !result.empty && <PinView view={result.view} args={result.args} title={result.title} device={device} />}
  </section>;
}
