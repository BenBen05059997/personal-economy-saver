"use client";

import Link from "next/link";
import { AddLink } from "@/components/add/AddLink";
import type { AddKind } from "@/components/add/context";
import { useState, useSyncExternalStore, type MouseEvent } from "react";
import { useAskPanel } from "@/components/shell/AskWorkspace";
import "./hints.css";

export type HintsDone = { bank: boolean; bill: boolean; client: boolean; charge: boolean; upload: boolean };

const ICONS = {
  bank: "M2.5 6.5L8 3l5.5 3.5 M3.5 7v5 M6.5 7v5 M9.5 7v5 M12.5 7v5 M2.5 13h11",
  bill: "M4 2.5h8v11l-1.6-1-1.2 1-1.2-1-1.2 1-1.2-1-1.6 1z M6 6h4 M6 8.5h4",
  client: "M2.5 5.5h11v7h-11z M6 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5 M2.5 9h11",
  charge: "M3.5 3.5h9a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11V5a1.5 1.5 0 0 1 1.5-1.5z M2 6.8h12",
  upload: "M8 10.5V3 M5 5.8L8 3l3 2.8 M3 10v2.5h10V10",
  ask: "M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z",
};

const subscribe = (callback: () => void) => {
  window.addEventListener("storage", callback);
  window.addEventListener("pes-hints-hidden", callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener("pes-hints-hidden", callback); };
};

/** What a person can do on Home, as cards that open the thing. A card whose thing exists is ticked and still clickable; Hide is kept on this device. */
export function Hints({ householdId, done, hasCard }: { householdId: string; done: HintsDone; hasCard: boolean }) {
  const panel = useAskPanel();
  const [locallyHidden, setLocallyHidden] = useState(false);
  const key = `pes-hints-hidden:${householdId}`;
  const hidden = useSyncExternalStore(subscribe, () => {
    try { return localStorage.getItem(key) === "yes"; } catch { return false; }
  }, () => true);
  if (hidden || locallyHidden) return null;
  function hide() {
    setLocallyHidden(true);
    try { localStorage.setItem(key, "yes"); window.dispatchEvent(new Event("pes-hints-hidden")); } catch { /* Device storage may be unavailable. */ }
  }
  function openBalance(event: MouseEvent) {
    event.preventDefault();
    const details = document.querySelector<HTMLDetailsElement>("details.home-balance");
    if (!details) return;
    details.open = true;
    details.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  function openAsk(event: MouseEvent<HTMLElement>) {
    if (panel?.available) { event.preventDefault(); panel.open(event.currentTarget); }
  }
  const cards: { icon: keyof typeof ICONS; title: string; hint: string; done: boolean; href?: string; add?: AddKind; onClick?: (event: MouseEvent<HTMLElement>) => void }[] = [
    { icon: "bank", title: "Set today’s bank balance", hint: "Your forecast starts from this.", done: done.bank, href: "/#bank-balance", onClick: openBalance },
    { icon: "bill", title: "Add a bill", hint: "Rent, phone, subscriptions: anything that leaves on a date.", done: done.bill, add: "bill" },
    { icon: "client", title: "Add a client", hint: "Who pays you, so incoming money shows up.", done: done.client, add: "client" },
    { icon: "charge", title: hasCard ? "Add a card charge" : "Add a card", hint: hasCard ? "Spending on a card, paid when the statement is due." : "Card charges and statements need a card first.", done: done.charge, add: hasCard ? "charge" : "card" },
    { icon: "upload", title: "Upload a receipt or bill", hint: "fipa reads it; you check before it counts.", done: done.upload, href: "/upload" },
    { icon: "ask", title: "Ask a question", hint: "Ask about your money in your own words.", done: false, href: "/canvas#ask", onClick: openAsk },
  ];
  const body = (card: (typeof cards)[number]) => <>
    <svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[card.icon]} /></svg>
    <span className="home-hints-text"><b>{card.title}</b><small>{card.hint}</small></span>
    {card.done && <span className="home-hints-done"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8.5l3 3 7-7" /></svg>Done</span>}
  </>;
  return <section id="hints" className="home-hints" aria-labelledby="hints-title">
    <div className="home-hints-heading">
      <h2 id="hints-title">What you can do here</h2>
      <button type="button" onClick={hide}>Hide</button>
    </div>
    <ul>{cards.map(card => <li key={card.title}>
      {card.add
        ? <AddLink kind={card.add} className={card.done ? "is-done" : undefined}>{body(card)}</AddLink>
        : <Link href={card.href ?? "/"} prefetch={false} onClick={card.onClick} className={card.done ? "is-done" : undefined}>{body(card)}</Link>}
    </li>)}</ul>
  </section>;
}
