"use client";

import { useState } from "react";
import { CheckIcon } from "@/components/ui/icons";
import { ViewCard } from "@/components/views/ViewCard";
import { ViewFigure } from "@/components/views/ViewFigure";
import type { ViewResult } from "@/lib/views/types";
import "./saved-line.css";

/** D61: the line To check keeps after a Confirm, until the person leaves the page: what was saved, and What changed › opens the view inline. */
export function SavedLine({ what, result }: { what: string; result: ViewResult | null }) {
  const [open, setOpen] = useState(false);
  return <div className="saved-line">
    <div className="saved-line-head" role="status">
      <p className="saved-line-what"><CheckIcon size={16} /><b>Saved</b> <span>{what}</span></p>
      {result && <button type="button" className="saved-line-more" aria-expanded={open} onClick={() => setOpen(!open)}>What changed {open ? "‹" : "›"}</button>}
    </div>
    {open && result && <div className="saved-line-view"><h2 className="saved-line-title">{result.title}</h2><ViewCard result={result} figure={<ViewFigure result={result} />} /></div>}
  </div>;
}
