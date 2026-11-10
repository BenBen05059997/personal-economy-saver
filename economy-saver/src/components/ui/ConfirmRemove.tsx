"use client";

import { useRef, type ReactNode } from "react";
import type { DataKind } from "@/db/data-kinds";
import { ApiForm } from "./ApiForm";

/**
 * The confirm-then-do step: a fold whose summary opens `question` with Keep and a confirm button. With `action` the button posts the
 * hidden `fields` through ApiForm; with `onConfirm` it runs in the browser (a device-only item).
 */
export function ConfirmDo({ summary, summaryLabel, question, button, action, fields, onDone, onConfirm }: {
  summary: string; summaryLabel: string; question: ReactNode; button: string; action?: string; fields?: Record<string, string | undefined>; onDone?: () => void; onConfirm?: () => void;
}) {
  const panel = useRef<HTMLDetailsElement>(null);
  const keep = <button type="button" className="ui-button" onClick={() => { if (panel.current) panel.current.open = false; }}>Keep</button>;
  return <details ref={panel} className="ui-remove">
    <summary aria-label={summaryLabel}>{summary}</summary>
    {onConfirm ? <>
      {question}
      <div className="ui-remove-buttons">{keep}<button type="button" className="ui-button" onClick={onConfirm}>{button}</button></div>
    </> : <ApiForm action={action} onDone={onDone}>
      {Object.entries(fields ?? {}).map(([name, value]) => value !== undefined && <input key={name} type="hidden" name={name} value={value} />)}
      {question}
      <div className="ui-remove-buttons">{keep}<button className="ui-button">{button}</button></div>
    </ApiForm>}
  </details>;
}

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
  const dataItem = kind === "data" && what !== undefined;
  const verb = (kind === "data" && (!dataItem || what === "journal")) || kind === "conversation" || kind === "space" ? "Delete" : "Remove";
  const endpoint = kind === "person" ? "/api/people" : kind === "own_category" ? "/api/own-categories" : kind === "space" ? "/api/spaces"
    : kind === "data" || kind === "conversation" ? "/api/data" : "/api/remove";
  const operation = kind === "person" || kind === "own_category" ? "remove" : kind === "space" ? "delete" : kind === "data"
    ? (dataItem ? "delete_one" : "delete_kind") : kind === "conversation" ? "delete_conversation" : kind;
  return <ConfirmDo summary={verb} summaryLabel={`${verb} ${label}`} button={verb} question={<p>{verb} {label}?{note && ` ${note}`}</p>}
    action={endpoint} onDone={onDone} onConfirm={onRemove}
    fields={{ kind: operation, what: kind === "data" ? (what ?? id) : undefined, id: kind !== "data" || dataItem ? id : undefined, returnTo }} />;
}
