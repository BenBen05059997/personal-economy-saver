"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ApiForm } from "@/components/ui/ApiForm";
import type { Brief, BriefRecord } from "@/lib/agent/brief";
import { briefFromForm, BRIEF_LIST_FIELDS, BRIEF_REF_FIELDS } from "@/lib/agent/brief-form";
import { hrefForRef } from "@/lib/links";

function BriefFields({ id, brief }: { id: string; brief: Brief | undefined }) {
  return <>
    <input type="hidden" name="kind" value="brief" />
    <input type="hidden" name="id" value={id} />
    <label className="ui-field">About<textarea name="about" rows={2} defaultValue={brief?.about} /></label>
    <label className="ui-field">Goal<textarea name="goal" rows={2} defaultValue={brief?.goal} /></label>
    <label className="ui-field">State
      <textarea name="state" rows={3} defaultValue={brief?.state.map(line => `${line.source} | ${line.text}`).join("\n")} />
      <small className="ui-hint">One item per line, as source | detail. A source is a tool name or note ID.</small>
    </label>
    {BRIEF_LIST_FIELDS.map(([field, label]) => <label className="ui-field" key={field}>{label}
      <textarea name={field} rows={2} defaultValue={brief?.[field].join("\n")} />
      <small className="ui-hint">One item per line.</small>
    </label>)}
    <details>
      <summary>Reference IDs</summary>
      {BRIEF_REF_FIELDS.map(([field, , label]) => <label className="ui-field" key={field}>{label}
        <textarea name={field} rows={2} defaultValue={brief?.refs[field].join("\n")} />
      </label>)}
      <small className="ui-hint">One ID per line.</small>
    </details>
  </>;
}

function BriefText({ brief }: { brief: Brief | undefined }) {
  if (!brief) return <p className="ui-hint">No brief yet.</p>;
  const refs = BRIEF_REF_FIELDS.flatMap(([field, type]) => brief.refs[field].map((id, index) => ({
    id, label: `${type} ${index + 1}`, href: hrefForRef(type.toLowerCase(), id),
  })));
  const hasText = brief.about || brief.goal || brief.state.length || BRIEF_LIST_FIELDS.some(([field]) => brief[field].length) || refs.length;
  if (!hasText) return <p className="ui-hint">No brief yet.</p>;
  return <>
    {brief.about && <div><h3>About</h3><p>{brief.about}</p></div>}
    {brief.goal && <div><h3>Goal</h3><p>{brief.goal}</p></div>}
    {brief.state.length > 0 && <div><h3>State</h3><ul>
      {brief.state.map((item, index) => <li key={index}>{item.text} <small className="ui-hint">· {item.source}</small></li>)}
    </ul></div>}
    {BRIEF_LIST_FIELDS.map(([field, label]) => brief[field].length > 0 && <div key={field}><h3>{label}</h3><ul>
      {brief[field].map((item, index) => <li key={index}>{item}</li>)}
    </ul></div>)}
    {refs.length > 0 && <div><h3>References</h3><ul>
      {refs.map(({ id, label, href }) => <li key={`${label}:${id}`}>
        {href ? <Link prefetch={false} href={href}>{label}</Link> : <>{label} · {id}</>}
      </li>)}
    </ul></div>}
  </>;
}

export function SpaceBrief({ id, record, timeZone, ready, readOnly, busy, saveOnDevice, onCloudSaved }: {
  id: string; record: BriefRecord | null; timeZone: string; ready: boolean; readOnly: boolean; busy: boolean;
  saveOnDevice?: (brief: Brief) => Promise<void>;
  onCloudSaved: (record: BriefRecord) => void;
}) {
  // Freeze the editor's initial values while it is open, even if an answer updates the displayed brief.
  const [draft, setDraft] = useState<BriefRecord | null | undefined>(undefined);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const done = () => { setDraft(undefined); setSaved(true); };
  const editable = ready && !readOnly;
  const updatedAt = record ? new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(record.updatedAt)) : null;

  async function submitDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!saveOnDevice || saving || busy) return;
    setProblem("");
    setSaving(true);
    try {
      await saveOnDevice(briefFromForm(new FormData(event.currentTarget)));
      done();
    } catch (error) { setProblem(error instanceof Error ? error.message : "Couldn’t save the brief on this device."); }
    finally { setSaving(false); }
  }

  const controls = <>
    <BriefFields id={id} brief={draft?.brief} />
    <div className="ask-buttons">
      <button className="ui-button primary" disabled={busy || saving}>Save brief</button>
      <button type="button" className="ui-button" disabled={saving} onClick={() => setDraft(undefined)}>Cancel</button>
    </div>
  </>;
  return <section className="ui-panel ask-brief" aria-labelledby="space-brief">
    <h2 id="space-brief">Space brief</h2>
    {ready ? <BriefText brief={record?.brief} /> : <p className="ui-hint">Opening the brief on this device…</p>}
    {record && updatedAt && <p className="ui-hint">
      {record.updatedBy === "ask" ? "Agent updated it " : "You updated it "}
      <time dateTime={record.updatedAt}>{updatedAt}</time>
    </p>}
    {saved && <p role="status" className="ui-hint">Brief saved.</p>}
    {editable && (draft === undefined
      ? <button type="button" className="ui-button" disabled={busy} onClick={() => { setDraft(record); setSaved(false); setProblem(""); }}>Edit</button>
      : saveOnDevice
        ? <form className="ui-form" onSubmit={submitDevice} aria-busy={saving}>
          <fieldset disabled={saving}>{controls}</fieldset>
          {problem && <p className="ui-problem" role="alert">{problem}</p>}
        </form>
        : <ApiForm action="/api/spaces" onDone={async response => {
          onCloudSaved(await response.json() as BriefRecord);
          done();
        }}>{controls}</ApiForm>)}
  </section>;
}
