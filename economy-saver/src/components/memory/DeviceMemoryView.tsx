"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { MEMORY_KIND_KEYS, MEMORY_KINDS, MEMORY_LIMIT, MEMORY_TEXT_MAX, type MemoryItem } from "@/lib/schema/memory";
import { addDeviceMemory, deviceMemory, editDeviceMemory, forgetDeviceMemory, householdMomentSince, replaceDevice } from "@/lib/store/device";
import { dayIn, howIn, KindSelect } from "./MemoryView";
import "./memory.css";

const wordsOf = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Try again.";

/** /memory when the household keeps its memory on this device only (D59): the items are read in the browser, and every change goes to the device store, never to /api/memory. */
export function DeviceMemoryView({ householdId, timeZone, momentNow }: { householdId: string; timeZone: string; momentNow: string }) {
  const [items, setItems] = useState<MemoryItem[] | null>(null);
  const [unreadable, setUnreadable] = useState("");
  const [message, setMessage] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const day = dayIn(timeZone), how = howIn(day);
  const openedAt = useRef(0); // when the page arrived, in the browser's clock; the household's clock moves on from `momentNow` by the time since
  const householdNow = () => householdMomentSince(momentNow, openedAt.current); // like the cloud path (D34)

  const load = useCallback(async () => {
    try { setItems(await deviceMemory(householdId)); setUnreadable(""); }
    catch (error) { setItems(null); setUnreadable(wordsOf(error)); }
  }, [householdId]);
  useEffect(() => {
    openedAt.current = Date.now();
    let cancelled = false;
    deviceMemory(householdId).then(list => { if (!cancelled) setItems(list); }, error => { if (!cancelled) setUnreadable(wordsOf(error)); });
    return () => { cancelled = true; };
  }, [householdId]);

  async function change(id: string, work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setMessage(null);
    try { await work(); await load(); }
    catch (error) { setMessage({ id, text: wordsOf(error) }); }
    finally { setBusy(false); }
  }
  const fields = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    return { kind: String(data.get("memoryKind") ?? ""), text: String(data.get("text") ?? "") };
  };
  const status = (id: string) => message?.id === id ? <p className="ui-hint" role="status">{message.text}</p> : null;

  const header = <header>
    <h1 className="ui-title">What the assistant knows</h1>
    <p className="ui-hint">This shapes how the assistant answers. It never changes your numbers.</p>
    <p className="ui-hint">On this device only. Other devices and connected assistants (MCP) see none of it. Clearing this browser’s data deletes it.</p>
  </header>;
  if (unreadable) return <div className="memory-page">{header}<section className="ui-panel"><p role="alert">{unreadable}</p></section></div>;
  if (!items) return <div className="memory-page">{header}<p className="ui-hint" role="status">Opening what is kept on this device…</p></div>;

  return <div className="memory-page">
    {header}
    {items.length === 0 ? <section className="memory-empty ui-panel">
      <p>Nothing yet. When you tell the assistant something to keep, or add it here, it will appear in this list, where you can change or delete it.</p>
      <ul>{MEMORY_KIND_KEYS.map(key => <li key={key}><b>{MEMORY_KINDS[key].label}:</b> “{MEMORY_KINDS[key].example}”</li>)}</ul>
    </section> : MEMORY_KIND_KEYS.map(key => {
      const group = items.filter(item => item.kind === key);
      return group.length === 0 ? null : <section key={key} className="memory-group" aria-labelledby={`memory-${key}`}>
        <h2 id={`memory-${key}`}>{MEMORY_KINDS[key].label}</h2>
        <p className="ui-hint">{MEMORY_KINDS[key].help}</p>
        <ul>{group.map(item => <li key={`${item.id}-${item.updatedAt}`} className="memory-item">
          <p className="memory-text">{item.text}</p>
          <p className="ui-hint">{how(item)}{item.updatedAt !== item.createdAt && ` · edited ${day(item.updatedAt)}`}</p>
          <div className="memory-actions">
            <details className="memory-edit">
              <summary>Edit</summary>
              <form onSubmit={event => { const f = fields(event); void change(item.id, async () => { await editDeviceMemory(householdId, item.id, f, householdNow()); }); }}>
                <KindSelect value={item.kind} />
                <label className="ui-field">What it knows<textarea name="text" required maxLength={MEMORY_TEXT_MAX} rows={3} defaultValue={item.text} /></label>
                <button className="ui-button primary" disabled={busy}>Save changes</button>
                {status(item.id)}
              </form>
            </details>
            <details className="memory-edit">
              <summary aria-label={`Delete: ${item.text}`}>Delete</summary>
              <form onSubmit={event => { event.preventDefault(); void change(item.id, async () => { await forgetDeviceMemory(householdId, item.id); }); }}>
                <p>Delete this for good? The assistant will no longer know it.</p>
                <button className="ui-button" disabled={busy}>Yes, delete</button>
                {status(item.id)}
              </form>
            </details>
          </div>
        </li>)}</ul>
      </section>;
    })}

    <section className="memory-add ui-panel">
      <h2>Add something</h2>
      <form key={formKey} onSubmit={event => { const f = fields(event); void change("add", async () => { await addDeviceMemory(householdId, f, householdNow()); setFormKey(k => k + 1); }); }}>
        <KindSelect />
        <label className="ui-field">What should it know?<textarea name="text" required maxLength={MEMORY_TEXT_MAX} rows={3} placeholder="e.g. Rent goes up in April" /></label>
        <button className="ui-button primary" disabled={busy}>Add</button>
        {status("add")}
      </form>
      <p className="ui-hint">{items.length} of {MEMORY_LIMIT} used.</p>
    </section>

    {items.length > 0 && <section className="memory-forget">
      <details className="memory-edit">
        <summary>Forget everything</summary>
        <form onSubmit={event => { event.preventDefault(); void change("forget", async () => { await replaceDevice(householdId, "memory", []); }); }}>
          <p>Delete all {items.length} {items.length === 1 ? "thing" : "things"} for good? This cannot be undone.</p>
          <button className="ui-button" disabled={busy}>Yes, forget everything</button>
          {status("forget")}
        </form>
      </details>
    </section>}
  </div>;
}
