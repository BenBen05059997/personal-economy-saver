"use client";

import { ResetDemo } from "@/components/settings/ResetDemo";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DRAFT_EVENT, storeDraft } from "@/components/ask/draft";
import { useSpeech } from "@/components/voice/use-speech";
import "@/components/ask/ask-bar.css";
import React, { type ReactNode } from "react";
import type { AskScreen } from "@/lib/agent/screen";
import type { EventFeed } from "@/db/event-feed";
import { useEventFeed } from "./useEventFeed";
import { ActivityList } from "./ActivityList";
import { Arrival } from "./Arrival";
import { AskButton } from "./AskButton";
import { useAskPanel } from "./AskWorkspace";
import { AddLink } from "@/components/add/AddLink";
import { LogoMark } from "./Logo";
import "./shell.css";

const iconPaths = {
  home: "M2.5 7.2 8 2.8l5.5 4.4V13h-11z M6.5 13V9.5h3V13",
  check: "M2.5 9.5 4 3.5h8l1.5 6 M2.5 9.5V13h11V9.5H10l-1 1.5H7l-1-1.5z",
  ask: "M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z",
  menu: "M3 4.5h10 M3 8h10 M3 11.5h10",
  cards: "M3.5 3.5h9a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11V5a1.5 1.5 0 0 1 1.5-1.5z M2 6.8h12",
  clients: "M2.5 5.5h11v7h-11z M6 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5 M2.5 9h11",
  people: "M8.2 6A2.2 2.2 0 1 1 3.8 6a2.2 2.2 0 0 1 4.4 0z M2 13c.3-2.4 2-3.6 4-3.6s3.7 1.2 4 3.6 M10.5 4.2a2.2 2.2 0 0 1 0 3.6 M12 9.6c1 .5 1.8 1.5 2 3.4",
  bill: "M4 2.5h8v11l-1.6-1-1.2 1-1.2-1-1.2 1-1.2-1-1.6 1z M6 6h4 M6 8.5h4",
  memory: "M4 2.5h8v11l-4-2.5-4 2.5z",
  spending: "M3 12.5V9 M7 12.5V5.5 M11 12.5V3 M2.5 12.5h11",
  saving: "M5.5 2.5h5 M4.5 5h7 M4 5.6v6.4a1.5 1.5 0 0 0 1.5 1.5h5a1.5 1.5 0 0 0 1.5-1.5V5.6 M6.2 8.8h3.6",
  settings: "M3 5h2 M8 5h5 M3 11h6 M12 11h1 M8 5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z M12 11a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z",
  mic: "M6 4a2 2 0 0 1 4 0v3.5a2 2 0 0 1-4 0z M3.5 7.8a4.5 4.5 0 0 0 9 0 M8 12.3V14",
  plus: "M8 3v10 M3 8h10",
  bell: "M2.5 11.5c1.3-1.3 1.6-2.5 1.6-5.1a3.9 3.9 0 1 1 7.8 0c0 2.6.3 3.8 1.6 5.1z M6.5 13.3a1.7 1.7 0 0 0 3 0",
  close: "M3.5 3.5l9 9 M12.5 3.5l-9 9",
};

function Icon({ name }: { name: keyof typeof iconPaths }) {
  return <svg className="shell-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={iconPaths[name]} /></svg>;
}

const destinations = [
  { section: "home", icon: "home", label: "Home", href: "/" },
  { section: "canvas", icon: "ask", label: "Ask", href: "/canvas" },
  { section: "check", icon: "check", label: "To check", href: "/to-check" },
  { section: "bills", icon: "bill", label: "Bills", href: "/bills" },
  { section: "cards", icon: "cards", label: "Cards", href: "/cards" },
  { section: "clients", icon: "clients", label: "Clients", href: "/clients" },
  { section: "spending", icon: "spending", label: "Spending", href: "/spending" },
  { section: "saving", icon: "saving", label: "Saving", href: "/saving" },
] as const;

export type Section = AskScreen;

/** The signed-in person (`email` is null when the session gives none) or null for a Try it household. */
export type Viewer = { email: string | null } | null;

function Navigation({ pending, name, section }: { pending: number; name: string; section: Section }) {
  return <>
    <Link prefetch={false} className="shell-brand" href="/"><LogoMark />fipa</Link>
    <nav className="shell-links" aria-label="Main navigation">
      {destinations.map(({ section: target, icon, label, href }) => <Link prefetch={false} key={target} href={href} aria-current={target === section ? "page" : undefined}>
        <Icon name={icon} />{label}{target === "check" && pending > 0 && <span className="shell-badge">{pending}</span>}
      </Link>)}
    </nav>
    <footer className="shell-footer">
      <Link prefetch={false} aria-current={section === "memory" ? "page" : undefined} href="/memory"><Icon name="memory" />Memory</Link>
      <Link prefetch={false} aria-current={section === "household" ? "page" : undefined} href="/household"><Icon name="people" />Household</Link>
      <Link prefetch={false} aria-current={section === "settings" ? "page" : undefined} href="/settings"><Icon name="settings" />Settings</Link>
      <button type="button" className="shell-person" popoverTarget="shell-person-menu" aria-label="Account menu"><span aria-hidden="true">{name.slice(0, 1)}</span>{name}</button>
    </footer>
  </>;
}

const askPrompt = "Can I afford ¥4,000 tonight?";

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDate(iso: string) {
  const [, month, day] = iso.split("-").map(Number);
  return month >= 1 && month <= 12 && day ? `${months[month - 1]} ${day}` : iso;
}

export function Shell({ children, name, pending, feed, section, forwarding = false, tryIt = false, viewer = null, today, timeZone }: {
  viewer?: Viewer;
  children: ReactNode;
  forwarding?: boolean;
  tryIt?: boolean;
  today?: string;
  timeZone: string;
  name: string;
  pending: number;
  feed: EventFeed;
  section: Section;
}) {
  const { mark, marking, error } = useEventFeed(feed, section === "home" || section === "check");
  const { unread } = feed;
  const router = useRouter();
  const desktop = !!useAskPanel()?.desktop;

  function handOver(text?: string, source: "manual" | "voice" = "manual") {
    if (text) storeDraft({ text, source });
    router.push("/canvas#ask");
    if (text) window.dispatchEvent(new Event(DRAFT_EVENT));
  }
  function typedOnBar(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    handOver(event.key === " " ? undefined : event.key);
  }
  // Dictation fills the same composer and waits for the person to send.
  const speech = useSpeech(words => {
    handOver(words, "voice");
  });
  const micLabel = speech.listening ? "Listening… tap to stop" : speech.problem;
  const micProps = {
    type: "button" as const, "aria-label": "Speak a question", "aria-pressed": speech.listening,
    onClick: () => {
      if (speech.listening) speech.stop(); else speech.start();
    },
  };
  return <div className="money-shell" onClick={event => {
    if (event.target instanceof Element) {
      const link = event.target.closest("a");
      // Close the menu the link is in and, on a phone, the navigation popover around it.
      for (let open = link?.closest<HTMLElement>("[popover]"); open; open = open.parentElement?.closest<HTMLElement>("[popover]") ?? null) open.hidePopover();
    }
  }}>
    <Arrival />
    <Link prefetch={false} className="shell-skip" href="#shell-main">Skip to content</Link>
    <aside className="shell-sidebar"><Navigation name={name} pending={pending} section={section} /></aside>
    <div className="shell-workspace">
      <header className={`shell-bar${desktop ? " is-desktop" : ""}`}>
        <button className="shell-mobile-toggle" popoverTarget="shell-nav" aria-label="Open navigation"><Icon name="menu" /></button>
        <Link prefetch={false} className="shell-mobile-brand" href="/"><LogoMark />fipa</Link>
        {desktop && tryIt && <p className="shell-sample"><span className="shell-sample-label">Sample household{today ? ` · fixed date ${shortDate(today)}` : ""}</span><ResetDemo /></p>}
        {!desktop && <div className="shell-ask-row">
          <button {...micProps} className={`shell-ask-mic${speech.listening ? " is-listening" : ""}`}><Icon name="mic" /></button>
          <Link prefetch={false} className="shell-ask" href="/canvas#ask" onKeyDown={typedOnBar}>
            <span role="status">{micLabel || `Ask or say: ${askPrompt}`}</span><b>Ask</b>
          </Link>
        </div>}
        <button className="shell-bell" popoverTarget="shell-notifications" aria-label={`Activity, ${unread} unread`}>
          <Icon name="bell" />{unread > 0 && <span className="shell-badge">{unread}</span>}
        </button>
        <button type="button" className="shell-add" popoverTarget="shell-add"><Icon name="plus" />Add</button>
        {desktop && <AskButton />}
      </header>
      <main id="shell-main" className="shell-main" tabIndex={-1}>
        <div className="shell-content">{children}</div>
      </main>
      {section !== "canvas" && <div className="shell-phone-ask">
        <button {...micProps} className={`shell-phone-mic${speech.listening ? " is-listening" : ""}`}><Icon name="mic" /></button>
        <Link prefetch={false} className="shell-phone-text" href="/canvas#ask" onKeyDown={typedOnBar}><span role="status">{micLabel || `Ask or tell me: “${askPrompt}”`}</span></Link>
      </div>}
    </div>
    <aside id="shell-nav" popover="auto" className="shell-nav-popover">
      <button className="shell-nav-close" popoverTarget="shell-nav" popoverTargetAction="hide" aria-label="Close navigation"><Icon name="close" /></button>
      <Navigation name={name} pending={pending} section={section} />
    </aside>
    <div id="shell-person-menu" popover="auto" className="shell-popover shell-person-menu" aria-label="Account menu">
      <p className="shell-person-name">{name}</p>
      <p className="shell-person-sub">{viewer ? viewer.email : "Try it household"}</p>
      {!viewer && <Link prefetch={false} href="/login">Sign in with email</Link>}
      <Link prefetch={false} href="/settings/account">Account</Link>
      {tryIt && !desktop && <p className="shell-person-reset"><ResetDemo long /></p>}
      {viewer && <form method="post" action="/api/auth/logout"><button type="submit">Sign out</button></form>}
    </div>
    <section id="shell-notifications" popover="auto" className="shell-popover shell-notifications">
      <ActivityList feed={feed} timeZone={timeZone} marking={marking} mark={mark} />
      {error && <p role="status">{error}</p>}
    </section>
    <nav id="shell-add" popover="auto" className="shell-popover shell-add-menu" aria-label="Add to household">
      <AddLink kind="bill">A bill</AddLink>
      <AddLink kind="charge">A card charge</AddLink>
      <AddLink kind="card">A card</AddLink>
      <AddLink kind="client">A client who pays you</AddLink>
      <AddLink kind="person">A person who shares costs</AddLink>
      <AddLink kind="pot">A pot</AddLink>
      <Link prefetch={false} className="shell-add-rule" href="/upload">Upload a receipt or bill</Link>
      {forwarding && <Link prefetch={false} href="/bills#forwarding">Forward a bill</Link>}
      <Link prefetch={false} href="/invoices/new">New invoice</Link>
    </nav>
  </div>;
}
export default Shell;
