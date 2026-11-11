"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ApiForm } from "@/components/ui/ApiForm";
import type { AskView } from "@/db/ask-view";
import type { Drawn } from "@/lib/agent/view";

type Pin = { id: string; title: string };

/** The side sheet of the full Ask page: brief, pins, earlier conversations, delete, starter canvases and notes. It is in the page even while closed. */
export function SpaceDrawer({
  open, onClose, space, spaceHref, legacyId, canWrite, pinsOnDevice, pins, earlier, brief, remove, starters, starter, onStarter, starterCanvas, notes, onUnpin,
}: {
  open: boolean; onClose: () => void; space: AskView["space"]; spaceHref: string; legacyId: string | null; canWrite: boolean; pinsOnDevice: boolean;
  pins: Pin[]; earlier: { id: string; question: string }[]; brief: ReactNode; remove: ReactNode; starters: Drawn[]; starter: number; onStarter: (index: number) => void;
  starterCanvas: ReactNode; notes: ReactNode; onUnpin: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  // A hidden page stays mounted, so the sheet closes when the page is left and when the route changes.
  useLayoutEffect(() => {
    const element = dialog.current;
    return () => { if (element?.open) element.close(); };
  }, []);
  useEffect(() => { onClose(); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  return <dialog ref={dialog} className="ask-drawer" aria-label="Space" onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="ask-drawer-head">
      <h2 className="ask-drawer-title">{space.name}</h2>
      <button type="button" className="ask-icon-button" aria-label="Close Space" onClick={onClose}>
        <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
      </button>
    </div>
    <div className="ask-drawer-body">
      <Link href="/memory?tab=spaces" prefetch={false} className="ui-button ask-drawer-spaces">Spaces</Link>
      {!legacyId && brief}
      {!space.isGeneral && pins.length > 0 && <div className="ask-space-pins">
        <h2>Pinned in this space</h2>
        <ul>{pins.map(item => <li key={item.id}>
          <Link className="ui-button" href={`${spaceHref}&pin=${item.id}`} prefetch={false}>{item.title}</Link>
          {canWrite && (pinsOnDevice
            ? <button type="button" className="ui-button" onClick={() => onUnpin(item.id)}>Unpin</button>
            : <ApiForm action="/api/canvases" className="ask-pin-form">
              <input type="hidden" name="kind" value="unpin" /><input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="returnTo" value={spaceHref} />
              <button className="ui-button">Unpin</button>
            </ApiForm>)}
        </li>)}</ul>
      </div>}
      {earlier.length > 0 && <details className="ask-spaces">
        <summary>Earlier conversations</summary>
        <ul>{earlier.map(item => <li key={item.id}><Link className="ui-button" prefetch={false}
          href={`${spaceHref}&thread=${item.id}`} aria-current={legacyId === item.id ? "page" : undefined}>{item.question}</Link></li>)}</ul>
      </details>}
      {remove}
      <nav className="ask-starters" aria-label="Canvases to start from">
        {starters.map((item, index) => <button key={item.key} type="button" aria-pressed={index === starter} onClick={() => onStarter(index)}>{item.title}</button>)}
      </nav>
      {starterCanvas}
      {notes}
    </div>
  </dialog>;
}
