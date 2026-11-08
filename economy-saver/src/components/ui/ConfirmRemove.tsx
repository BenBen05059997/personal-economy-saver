"use client";

import { useRef } from "react";
import type { DataKind } from "@/db/data-kinds";
import { ApiForm } from "./ApiForm";

/**
 * Remove with an in-page confirm: "Remove" opens "Remove Rent ¥82,000?" with Keep and Remove. Posts to /api/remove, which
 * deletes the bill (a monthly one as a whole series) or the card charge and records it in Activity; a person posts to
 * /api/people with `kind=remove`. Stored data (D59) goes to /api/data: `data` deletes the item in `id` when `what` is given, or every item of the kind in `id`,
 * `conversation` deletes the conversation whose id is `id`. Spaces post to /api/spaces. Bulk, conversation and space deletion read "Delete …". `onDone` runs once the route accepts the post.
 */
export function ConfirmRemove({ kind, id, label, note, returnTo, onDone, what }: {
  kind: "bill" | "charge" | "person" | "data" | "conversation" | "space"; id: string; label: string; note?: string; returnTo: string; onDone?: () => void; what?: DataKind;
}) {
  const panel = useRef<HTMLDetailsElement>(null);
  const dataItem = kind === "data" && what !== undefined;
  const verb = (kind === "data" && !dataItem) || kind === "conversation" || kind === "space" ? "Delete" : "Remove";
  const endpoint = kind === "person" ? "/api/people" : kind === "space" ? "/api/spaces"
    : kind === "data" || kind === "conversation" ? "/api/data" : "/api/remove";
  const operation = kind === "person" ? "remove" : kind === "space" ? "delete" : kind === "data"
    ? (dataItem ? "delete_one" : "delete_kind") : kind === "conversation" ? "delete_conversation" : kind;
  return <details ref={panel} className="ui-remove">
    <summary aria-label={`${verb} ${label}`}>{verb}</summary>
    <ApiForm action={endpoint} onDone={onDone}>
      <input type="hidden" name="kind" value={operation} />
      {kind === "data" && <input type="hidden" name="what" value={what ?? id} />}
      {(kind !== "data" || dataItem) && <input type="hidden" name="id" value={id} />}
      <input type="hidden" name="returnTo" value={returnTo} />
      <p>{verb} {label}?{note && ` ${note}`}</p>
      <div className="ui-remove-buttons">
        <button type="button" className="ui-button" onClick={() => { if (panel.current) panel.current.open = false; }}>Keep</button>
        <button className="ui-button">{verb}</button>
      </div>
    </ApiForm>
  </details>;
}
