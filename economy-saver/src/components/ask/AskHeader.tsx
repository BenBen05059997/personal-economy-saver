"use client";

import Link from "next/link";
import type { AskView } from "@/db/ask-view";

const iconProps = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

/** The header of Ask: the title, the space chooser, then Space (full page) or Open full and Close (docked panel). */
export function AskHeader({ panel, space, spaces, busy, spaceHref, onChoose, onOpenSpace, onClose }: {
  panel: boolean; space: AskView["space"]; spaces: AskView["spaces"]; busy: boolean; spaceHref: string;
  onChoose?: (id: string) => void; onOpenSpace: () => void; onClose?: () => void;
}) {
  const Heading = panel ? "h2" : "h1";
  return <header className="ask-panel-head">
    <Heading className="ask-panel-title">Ask</Heading>
    <span className="ask-space-select">
      <select aria-label="Space" value={space.id} disabled={busy || !onChoose} onChange={event => { if (event.target.value !== space.id) onChoose?.(event.target.value); }}>
        {spaces.filter(item => item.status === "open" || item.id === space.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <svg {...iconProps} width={12} height={12}><path d="M4 6l4 4 4-4" /></svg>
    </span>
    {panel ? <>
      <Link className="ask-icon-button ask-open-full" href={spaceHref} prefetch={false} aria-label="Open full">
        <svg {...iconProps}><path d="M9.5 2.5h4v4M13.5 2.5L8.5 7.5M6.5 13.5h-4v-4M2.5 13.5l5-5" /></svg>
      </Link>
      <button type="button" className="ask-icon-button" aria-label="Close Ask" onClick={onClose}>
        <svg {...iconProps}><path d="M4 4l8 8M12 4l-8 8" /></svg>
      </button>
    </> : <button type="button" className="ui-button ask-space-button" onClick={onOpenSpace}>Space</button>}
  </header>;
}
