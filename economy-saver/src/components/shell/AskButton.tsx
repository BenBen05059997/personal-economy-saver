"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { KeyboardEvent } from "react";
import { DRAFT_EVENT, storeDraft } from "@/components/ask/draft";
import { useAskPanel } from "./AskWorkspace";

function AskIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" /></svg>;
}

/** The one Ask button, at the top right of every screen of a household. It opens and closes the side panel; on the full Ask page it shows pressed and takes the person back. Below 900px, where there is no panel, it is a link to the full page. */
export function AskButton() {
  const panel = useAskPanel();
  const pathname = usePathname();
  if (!panel) return null;
  if (!panel.desktop) return <Link prefetch={false} id="shell-top-ask" className="ask-button" href="/canvas#ask"><AskIcon />Ask</Link>;
  const onCanvas = pathname === "/canvas";

  // A key typed on the focused button goes to the composer.
  function typed(event: KeyboardEvent<HTMLButtonElement>) {
    if (!panel || onCanvas || event.key.length !== 1 || event.key === " " || event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    storeDraft({ text: event.key, source: "manual" });
    panel.open(event.currentTarget);
    window.dispatchEvent(new Event(DRAFT_EVENT));
  }

  return <button type="button" id="shell-top-ask" className="ask-button" aria-pressed={onCanvas || panel.visible} onKeyDown={typed}
    onClick={event => onCanvas ? panel.returnFromAsk() : panel.visible ? panel.close() : panel.open(event.currentTarget)}>
    <AskIcon />Ask
  </button>;
}
