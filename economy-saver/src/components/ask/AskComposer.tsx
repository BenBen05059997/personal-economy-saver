"use client";

import type { FormEvent, KeyboardEvent, RefObject } from "react";

const iconProps = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
const PLACEHOLDER = "What’s due this week? Can I spend ¥4,000?";

/** The box pinned at the bottom of Ask: question, microphone, Ask, then Incognito and Attach a bill. */
export function AskComposer({
  panel, field, text, busy, deviceReady, listening, unavailable, incognito, intro,
  onText, onSubmit, onMic, onIncognito, onAttach,
}: {
  panel: boolean; field: RefObject<HTMLTextAreaElement | null>; text: string; busy: boolean; deviceReady: boolean; listening: boolean;
  unavailable: string | null; incognito: boolean; intro: string | null;
  onText: (text: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onMic: () => void;
  onIncognito: (enabled: boolean) => void; onAttach: (files: File[]) => Promise<void>;
}) {
  // Enter asks, Shift+Enter is a newline, and Enter that confirms an IME candidate (Japanese input) never asks.
  function enterAsks(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (text.trim() && !busy && !listening) event.currentTarget.form?.requestSubmit();
  }
  const textId = panel ? "ask-panel-text" : "ask-text";
  return <form id={panel ? "ask-panel-question" : "ask"} className="ask-form ask-composer" onSubmit={onSubmit}>
    <label className="ask-composer-label" htmlFor={textId}>Ask a question</label>
    <div className="ask-box">
      <textarea id={textId} ref={field} maxLength={320} rows={2} value={text} required disabled={panel && unavailable !== null} placeholder={PLACEHOLDER}
        onKeyDown={enterAsks} onChange={event => onText(event.target.value)} />
      <button type="button" className="ask-mic" aria-label={listening ? "Stop listening" : "Use microphone"}
        disabled={busy || !deviceReady || (panel && unavailable !== null)} onClick={onMic}>
        <svg {...iconProps}><path d="M8 2a2 2 0 0 0-2 2v4a2 2 0 0 0 4 0V4a2 2 0 0 0-2-2zM3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2" /></svg>
      </button>
      <button className="ui-button primary" disabled={busy || !deviceReady || listening || unavailable !== null}>{busy ? "Checking…" : "Ask"}</button>
    </div>
    <div className="ask-composer-row">
      <label className="ask-incognito">
        <input type="checkbox" role="switch" checked={incognito} disabled={busy} onChange={event => onIncognito(event.target.checked)} />
        Incognito
      </label>
      {!incognito && <label className={`ui-button ask-attach${busy ? " is-disabled" : ""}`}>Attach a bill
        <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy || !deviceReady}
          onChange={event => { const input = event.currentTarget; void onAttach(Array.from(input.files ?? [])).finally(() => { input.value = ""; }); }} />
      </label>}
    </div>
    {incognito && <p className="ui-hint ask-intro">This question and reply won’t be saved.</p>}
    {intro && <details className="ask-model-line"><summary><span>{intro}</span><em>More</em></summary><p>{intro}</p></details>}
  </form>;
}
