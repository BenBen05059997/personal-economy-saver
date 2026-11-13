"use client";

import Link from "next/link";
import { ApiForm } from "@/components/ui/ApiForm";
import { ViewCard } from "@/components/views/ViewCard";
import { ViewFigure } from "@/components/views/ViewFigure";
import { PinView } from "@/components/views/PinView";
import type { DraftView } from "@/lib/agent/view";
import "./draft-card.css";

const check = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>;

/**
 * D60, D61: the card under a draft in the thread. Every word is written by code (src/lib/agent/draft-card.ts); the model words only the reply above it.
 * Waiting: kind, fields, "If you confirm" (the what_changed view), then Confirm, Edit and Don't add, which use the routes To check uses (D39).
 * Confirmed: Saved, what changed, the See it buttons and Pin. Removed: one quiet line. The agent never confirms anything (D40).
 */
export function DraftCard({ draft, returnTo, canWrite, device, onChanged }: { draft: DraftView; returnTo: string; canWrite: boolean; device?: { householdId: string }; onChanged: () => void }) {
  if (draft.state === "not_added") return <div className="ask-draft is-quiet"><p className="ask-draft-line">Not added: {draft.name}.</p></div>;
  if (draft.state === "confirmed") return <>
    <div className="ask-draft ask-draft-saved">
      <p className="ask-draft-saved-head">{check}Saved{draft.saved?.day && <span> {draft.saved.day}</span>}</p>
      <p className="ask-draft-line">{draft.saved?.line}</p>
    </div>
    {draft.result && <section className="ask-draft ask-draft-changed" aria-label={draft.title}>
      <h3 className="ask-draft-title">{draft.title}</h3>
      <ViewCard result={draft.result} figure={<ViewFigure result={draft.result} />} mode="chart" onMode={() => {}} />
      <div className="ask-draft-places">
        {draft.places.map(place => <Link key={place.href + place.label} className="ui-button" href={place.href} prefetch={false}>{place.label}</Link>)}
        {canWrite && <PinView view={draft.result.view} args={draft.result.args} title={draft.title} device={device} />}
      </div>
    </section>}
    {!draft.result && <div className="ask-draft-places">{draft.places.map(place => <Link key={place.href + place.label} className="ui-button" href={place.href} prefetch={false}>{place.label}</Link>)}</div>}
  </>;
  const hidden = <><input type="hidden" name="id" value={draft.id} /><input type="hidden" name="returnTo" value={returnTo} /></>;
  return <div className="ask-draft">
    <p className="ask-draft-kind">{draft.kindLabel} · drafted by Ask · not saved yet</p>
    <dl className="ask-draft-fields">{draft.fields.map(field => <div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>
    {draft.result && <div className="ask-draft-change">
      <p className="ask-draft-change-head">If you confirm</p>
      <ViewCard result={{ ...draft.result, line: null }} figure={<ViewFigure result={draft.result} />} mode="chart" onMode={() => {}} />
    </div>}
    {canWrite && <div className="ask-draft-actions">
      <ApiForm action="/api/confirm" onDone={onChanged}>
        <input type="hidden" name="kind" value={draft.kind} />{hidden}
        <button className="ui-button primary" aria-label={`Confirm ${draft.name}`}>Confirm</button>
      </ApiForm>
      {draft.edit && <Link className="ui-button" href={draft.edit} prefetch={false} aria-label={`Edit ${draft.name}`}>Edit</Link>}
      {draft.remove && <ApiForm action={draft.remove} onDone={onChanged}>
        {draft.removeKind && <input type="hidden" name="kind" value={draft.removeKind} />}{hidden}
        <button className="ui-button" aria-label={`Don't add ${draft.name}`}>Don&rsquo;t add</button>
      </ApiForm>}
    </div>}
    <p className="ask-draft-also">Also waiting in <Link href="/to-check" prefetch={false}>To check</Link></p>
  </div>;
}
