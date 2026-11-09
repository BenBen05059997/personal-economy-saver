import { ApiForm } from "@/components/ui/ApiForm";
import { Fragment, type ReactNode } from "react";
import { MEMORY_KIND_KEYS, MEMORY_KINDS, MEMORY_LIMIT, MEMORY_TEXT_MAX, type MemoryItem, type MemoryKind } from "@/lib/schema/memory";
import "./memory.css";

// Dates are the household's: a Try it household's rows carry its fixed date (D34), shown in its time zone.
const dayIn = (timeZone: string) => (iso: string) => {
  const date = new Date(iso);
  const year = (d: Date) => d.toLocaleDateString("en-US", { year: "numeric", timeZone });
  return date.toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone, ...(year(date) === year(new Date()) ? {} : { year: "numeric" }) });
};
const howIn = (day: (iso: string) => string) => (item: MemoryItem) => item.madeBy === "ask" ? `Said in Ask · ${day(item.createdAt)}` : item.madeBy === "mcp" ? `Through MCP · ${day(item.createdAt)}` : `Added here · ${day(item.createdAt)}`;

function KindSelect({ value }: { value?: MemoryKind }) {
  return <label className="ui-field">Kind
    <select name="memoryKind" defaultValue={value ?? "fact"}>
      {MEMORY_KIND_KEYS.map(key => <option key={key} value={key}>{MEMORY_KINDS[key].label}</option>)}
    </select>
  </label>;
}

/** What differs between the cloud list and the device list: the form around each action, whether a change is under way, and the line a failed action shows. */
export type MemoryForms = {
  form: (op: "add" | "edit" | "delete" | "forget_all", id: string, children: ReactNode) => ReactNode;
  busy: boolean;
  status: (id: string) => ReactNode;
  addKey: string | number;
};

export function MemoryHeader({ note, spaceId, anchorPrefix = "" }: { note?: string; spaceId?: string | null; anchorPrefix?: string }) {
  return <header>
    {spaceId ? <h2 id={`${anchorPrefix}space-notes`}>Space notes</h2> : <h1 className="ui-title">What the assistant knows</h1>}
    <p className="ui-hint">{spaceId ? "These notes belong to this space." : "This shapes how the assistant answers. It never changes your numbers."}</p>
    {note && <p className="ui-hint">{note}</p>}
  </header>;
}

/** The list, the add box and Forget everything, shared by the cloud page and the device page; only `forms` differs. */
export function MemoryLayout({ items, timeZone, forms, note, spaceId = null, readOnly = false, totalCount = items.length, anchorPrefix = "" }: {
  items: MemoryItem[]; timeZone: string; forms: MemoryForms; note?: string; spaceId?: string | null; readOnly?: boolean; totalCount?: number; anchorPrefix?: string;
}) {
  const day = dayIn(timeZone), how = howIn(day);
  const { form, busy, status } = forms;
  const Heading = spaceId ? "h3" : "h2";
  return <div className="memory-page">
    <MemoryHeader note={note} spaceId={spaceId} anchorPrefix={anchorPrefix} />

    {items.length === 0 ? <section className="memory-empty ui-panel">
      {spaceId ? <p>No notes yet.</p> : <>
        <p>Nothing yet. When you tell the assistant something to keep, or add it here, it will appear in this list, where you can change or delete it.</p>
        <ul>{MEMORY_KIND_KEYS.map(key => <li key={key}><b>{MEMORY_KINDS[key].label}:</b> “{MEMORY_KINDS[key].example}”</li>)}</ul>
      </>}
    </section> : MEMORY_KIND_KEYS.map(key => {
      const group = items.filter(item => item.kind === key);
      return group.length === 0 ? null : <section key={key} className="memory-group" aria-labelledby={`${anchorPrefix}memory-${key}`}>
        <Heading id={`${anchorPrefix}memory-${key}`}>{MEMORY_KINDS[key].label}</Heading>
        <p className="ui-hint">{MEMORY_KINDS[key].help}</p>
        <ul>{group.map(item => <li key={`${item.id}-${item.updatedAt}`} id={`${anchorPrefix}memory-${item.id}`} className="memory-item">
          <p className="memory-text">{item.text}</p>
          <p className="ui-hint">{how(item)}{item.updatedAt !== item.createdAt && ` · edited ${day(item.updatedAt)}`}</p>
          {!readOnly && <div className="memory-actions">
            <details className="memory-edit">
              <summary>Edit</summary>
              {form("edit", item.id, <>
                <KindSelect value={item.kind} />
                <label className="ui-field">What it knows<textarea name="text" required maxLength={MEMORY_TEXT_MAX} rows={3} defaultValue={item.text} /></label>
                <button className="ui-button primary" disabled={busy}>Save changes</button>
                {status(item.id)}
              </>)}
            </details>
            <details className="memory-edit">
              <summary aria-label={`Delete: ${item.text}`}>Delete</summary>
              {form("delete", item.id, <>
                <p>Delete this for good? The assistant will no longer know it.</p>
                <button className="ui-button" disabled={busy}>Yes, delete</button>
                {status(item.id)}
              </>)}
            </details>
          </div>}
        </li>)}</ul>
      </section>;
    })}

    {!readOnly && <section className="memory-add ui-panel">
      <Heading>{spaceId ? "Add a note" : "Add something"}</Heading>
      <Fragment key={forms.addKey}>{form("add", "add", <>
        <KindSelect />
        <label className="ui-field">{spaceId ? "What should this space know?" : "What should it know?"}<textarea name="text" required maxLength={MEMORY_TEXT_MAX} rows={3} placeholder="e.g. Rent goes up in April" /></label>
        <button className="ui-button primary" disabled={busy}>Add</button>
        {status("add")}
      </>)}</Fragment>
      <p className="ui-hint">{totalCount} of {MEMORY_LIMIT} used.{spaceId || totalCount !== items.length ? " The limit is shared by the profile and all spaces." : ""}</p>
    </section>}

    {!readOnly && items.length > 0 && <section className="memory-forget">
      <details className="memory-edit">
        <summary>{spaceId ? "Forget space notes" : "Forget everything"}</summary>
        {form("forget_all", "forget", <>
          <p>Delete all {items.length} {items.length === 1 ? (spaceId ? "note" : "thing") : (spaceId ? "notes" : "things")} for good? This cannot be undone.
            {!spaceId && totalCount > items.length && " Space notes stay."}</p>
          <button className="ui-button" disabled={busy}>{spaceId ? "Yes, forget these notes" : "Yes, forget everything"}</button>
          {status("forget")}
        </>)}
      </details>
    </section>}
  </div>;
}

/** The cloud page: each action posts to /api/memory and the page reloads. */
export function MemoryView({ items, timeZone, spaceId = null, readOnly, totalCount, anchorPrefix }: {
  items: MemoryItem[]; timeZone: string; spaceId?: string | null; readOnly?: boolean; totalCount?: number; anchorPrefix?: string;
}) {
  const forms: MemoryForms = {
    busy: false,
    status: () => null,
    addKey: items.length,
    form: (op, id, children) => <ApiForm action="/api/memory">
      <input type="hidden" name="kind" value={op} />
      {spaceId && <input type="hidden" name="spaceId" value={spaceId} />}
      <input type="hidden" name="returnTo" value={spaceId ? `/canvas?space=${spaceId}` : "/memory"} />
      {op !== "add" && op !== "forget_all" && <input type="hidden" name="id" value={id} />}
      {children}
    </ApiForm>,
  };
  return <MemoryLayout items={items} timeZone={timeZone} forms={forms} spaceId={spaceId} readOnly={readOnly} totalCount={totalCount} anchorPrefix={anchorPrefix} />;
}
