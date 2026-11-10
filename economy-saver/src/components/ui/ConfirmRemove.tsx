"use client";

import { useRef } from "react";
import type { DataKind } from "@/db/data-kinds";
import { ApiForm } from "./ApiForm";

/**
 * Remove with an in-page confirm: "Remove" opens "Remove Rent ¥82,000?" with Keep and Remove. Posts to /api/remove, which
 * deletes the bill (a monthly one as a whole series) or the card charge and records it in Activity; a person posts to
 * /api/people with `kind=remove`, an own category (D75) to /api/own-categories with `kind=remove`. Stored data (D59) goes to /api/data: `data` deletes the item in `id` when `what` is given, or every item of the kind in `id`,
 * `conversation` deletes the conversation whose id is `id`. Spaces post to /api/spaces. Bulk, journal, conversation and space deletion read "Delete …".
 * `onDone` runs after the route accepts the post. `onRemove` handles a device-only item in the browser.
 */
export function ConfirmRemove({ kind, id, label, note, returnTo, onDone, onRemove, what }: {
  kind: "bill" | "charge" | "person" | "own_category" | "data" | "conversation" | "space"; id: string; label: string; note?: string; returnTo: string; onDone?: () => void; onRemove?: () => void; what?: DataKind;
}) {
  const panel = useRef<HTMLDetailsElement>(null);
  const dataItem = kind === "data" && what !== undefined;
  const verb = (kind === "data" && (!dataItem || what === "journal")) || kind === "conversation" || kind === "space" ? "Delete" : "Remove";
  const endpoint = kind === "person" ? "/api/people" : kind === "own_category" ? "/api/own-categories" : kind === "space" ? "/api/spaces"
    : kind === "data" || kind === "conversation" ? "/api/data" : "/api/remove";
  const operation = kind === "person" || kind === "own_category" ? "remove" : kind === "space" ? "delete" : kind === "data"
    ? (dataItem ? "delete_one" : "delete_kind") : kind === "conversation" ? "delete_conversation" : kind;
  const keep = <button type="button" className="ui-button" onClick={() => { if (panel.current) panel.current.open = false; }}>Keep</button>;
  const question = <p>{verb} {label}?{note && ` ${note}`}</p>;
  return <details ref={panel} className="ui-remove">
    <summary aria-label={`${verb} ${label}`}>{verb}</summary>
    {onRemove ? <>
      {question}
      <div className="ui-remove-buttons">{keep}<button type="button" className="ui-button" onClick={onRemove}>{verb}</button></div>
    </> : <ApiForm action={endpoint} onDone={onDone}>
      <input type="hidden" name="kind" value={operation} />
      {kind === "data" && <input type="hidden" name="what" value={what ?? id} />}
      {(kind !== "data" || dataItem) && <input type="hidden" name="id" value={id} />}
      <input type="hidden" name="returnTo" value={returnTo} />
      {question}
      <div className="ui-remove-buttons">{keep}<button className="ui-button">{verb}</button></div>
    </ApiForm>}
  </details>;
}
