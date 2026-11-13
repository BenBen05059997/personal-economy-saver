import { CHIP_WORDS, chipOf } from "@/lib/agent/draft-card";
import type { DraftView } from "@/lib/agent/view";
import "./draft-card.css";

/** The chip on the agent's reply (D60): what its drafts are now, read from the rows, so words written before a change never mislead. Nothing when the turn drafted nothing. */
export function ReplyChip({ drafts }: { drafts: readonly DraftView[] }) {
  const state = chipOf(drafts);
  if (state === null) return null;
  return <p className="ask-chip-line"><span className={`ask-chip is-${state}`} role="status">
    {state === "confirmed" && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>}
    {CHIP_WORDS[state]}
  </span></p>;
}
