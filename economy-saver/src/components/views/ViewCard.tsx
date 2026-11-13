"use client";

import type { ReactNode } from "react";
import { AddLink } from "@/components/add/AddLink";
import { DISPLAY_OPTIONS, Segmented, useDevicePreference } from "@/components/home/hv-parts";
import type { ViewResult } from "@/lib/views/types";
import { ViewTable } from "./ViewTable";
import "./views.css";

export type ViewMode = "chart" | "table";

/** One resolved view: the small figures above, the chart (the element the caller passes, so this never imports a form) or the table twin, then the one sentence. An empty view says what to add. Without `onMode` the card draws its own Chart | Table switch. */
export function ViewCard({ result, figure, tableSlot, mode, onMode }: { result: ViewResult; figure: ReactNode; tableSlot?: ReactNode; mode?: ViewMode; onMode?: (mode: ViewMode) => void }) {
  const [own, setOwn] = useDevicePreference(`fipa-view-card:${result.view}`, "chart");
  const shown: ViewMode = mode ?? (own === "table" ? "table" : "chart");
  if (result.empty) return <div className="view-card">
    <p className="hv-empty">{result.empty.words}</p>
    {result.empty.add && <div className="hv-blank-actions"><AddLink kind={result.empty.add} className="ui-button primary">{result.empty.addLabel ?? "Add"}</AddLink></div>}
  </div>;
  return <div className="view-card">
    {result.strip && <dl className="view-strip">{result.strip.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>}
    {!onMode && result.table && <div className="hv-controls"><Segmented label="Display" value={shown} options={DISPLAY_OPTIONS} onPick={setOwn} /></div>}
    {shown === "table" && result.table ? tableSlot ?? <ViewTable table={result.table} /> : figure}
    {result.line && <p className="view-line">{result.line}</p>}
  </div>;
}
