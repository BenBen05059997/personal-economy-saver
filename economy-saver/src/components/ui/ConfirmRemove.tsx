"use client";

import { useRef } from "react";
import { ApiForm } from "./ApiForm";

/**
 * Remove with an in-page confirm: "Remove" opens "Remove Rent ¥82,000?" with Keep and Remove. Posts to /api/remove, which
 * deletes the bill (a monthly one as a whole series) or the card charge and records it in Activity; a person posts to
 * /api/people with `kind=remove`.
 */
export function ConfirmRemove({ kind, id, label, note, returnTo }: {
  kind: "bill" | "charge" | "person"; id: string; label: string; note?: string; returnTo: string;
}) {
  const panel = useRef<HTMLDetailsElement>(null);
  return <details ref={panel} className="ui-remove">
    <summary aria-label={`Remove ${label}`}>Remove</summary>
    <ApiForm action={kind === "person" ? "/api/people" : "/api/remove"}>
      <input type="hidden" name="kind" value={kind === "person" ? "remove" : kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <p>Remove {label}?{note && ` ${note}`}</p>
      <div className="ui-remove-buttons">
        <button type="button" className="ui-button" onClick={() => { if (panel.current) panel.current.open = false; }}>Keep</button>
        <button className="ui-button">Remove</button>
      </div>
    </ApiForm>
  </details>;
}
