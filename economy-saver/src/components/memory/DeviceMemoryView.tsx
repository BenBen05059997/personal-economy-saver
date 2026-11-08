"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { MemoryItem } from "@/lib/schema/memory";
import { addDeviceMemory, deviceMemory, editDeviceMemory, forgetDeviceMemory, forgetDeviceMemoryScope, householdMomentSince } from "@/lib/store/device";
import { MemoryHeader, MemoryLayout, type MemoryForms } from "./MemoryView";

const wordsOf = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Try again.";

/** /memory when the household keeps its memory on this device only (D59): the items are read in the browser, and every change goes to the device store, never to /api/memory. */
export function DeviceMemoryView({ householdId, timeZone, momentNow, spaceId = null, readOnly = false, refreshKey = 0, onItems }: {
  householdId: string; timeZone: string; momentNow: string; spaceId?: string | null; readOnly?: boolean; refreshKey?: number;
  onItems?: (items: MemoryItem[]) => void;
}) {
  const [items, setItems] = useState<MemoryItem[] | null>(null);
  const [unreadable, setUnreadable] = useState("");
  const [message, setMessage] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const openedAt = useRef(0); // when the page arrived, in the browser's clock; the household's clock moves on from `momentNow` by the time since
  const householdNow = () => householdMomentSince(momentNow, openedAt.current); // like the cloud path (D34)
  const scrolledToCitation = useRef(false);

  const show = useCallback((list: MemoryItem[]) => {
    setItems(list); setUnreadable(""); onItems?.(list);
  }, [onItems]);
  const load = useCallback(async () => {
    try { show(await deviceMemory(householdId)); }
    catch (error) { setItems(null); setUnreadable(wordsOf(error)); }
  }, [householdId, show]);
  useEffect(() => { openedAt.current = Date.now(); }, [householdId, momentNow]);
  useEffect(() => {
    let cancelled = false;
    deviceMemory(householdId).then(list => { if (!cancelled) show(list); }, error => { if (!cancelled) setUnreadable(wordsOf(error)); });
    return () => { cancelled = true; };
  }, [householdId, refreshKey, show]);
  useEffect(() => {
    if (!items || scrolledToCitation.current) return;
    scrolledToCitation.current = true;
    const hash = window.location.hash;
    if (/^#memory-[0-9a-f-]{36}$/.test(hash)) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [items]);

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

  const note = "On this device only. Other devices and connected assistants (MCP) see none of it. Clearing this browser’s data deletes it.";
  if (unreadable) return <div className="memory-page"><MemoryHeader note={note} spaceId={spaceId} /><section className="ui-panel"><p role="alert">{unreadable}</p></section></div>;
  if (!items) return <div className="memory-page"><MemoryHeader note={note} spaceId={spaceId} /><p className="ui-hint" role="status">Opening what is kept on this device…</p></div>;

  const forms: MemoryForms = {
    busy, status, addKey: formKey,
    form: (op, id, children) => <form onSubmit={event => {
      const f = fields(event);
      if (op === "add") void change("add", async () => { await addDeviceMemory(householdId, { ...f, spaceId }, householdNow()); setFormKey(k => k + 1); });
      else if (op === "edit") void change(id, async () => {
        if (!await editDeviceMemory(householdId, id, { ...f, spaceId }, householdNow())) throw new Error("That is no longer here. Reload the page.");
      });
      else if (op === "delete") void change(id, async () => { await forgetDeviceMemory(householdId, id, spaceId); });
      else void change(id, () => forgetDeviceMemoryScope(householdId, spaceId));
    }}>{children}</form>,
  };
  return <MemoryLayout items={items.filter(item => (item.spaceId ?? null) === spaceId)} totalCount={items.length}
    timeZone={timeZone} forms={forms} note={note} spaceId={spaceId} readOnly={readOnly} />;
}
