"use client";

import Link from "next/link";
import { AskPanel } from "@/components/ask/AskPanel";
import React, { type ReactNode } from "react";
import type { EventFeed } from "@/db/event-feed";
import { useEventFeed } from "./useEventFeed";
import "./shell.css";

const iconPaths = {
  home: "M2.5 7.2 8 2.8l5.5 4.4V13h-11z M6.5 13V9.5h3V13",
  check: "M2.5 9.5 4 3.5h8l1.5 6 M2.5 9.5V13h11V9.5H10l-1 1.5H7l-1-1.5z",
  activity: "M3 4.5h10 M3 8h10 M3 11.5h10",
  cards: "M3.5 3.5h9a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11V5a1.5 1.5 0 0 1 1.5-1.5z M2 6.8h12",
  clients: "M8.2 6A2.2 2.2 0 1 1 3.8 6a2.2 2.2 0 0 1 4.4 0z M2 13c.3-2.4 2-3.6 4-3.6s3.7 1.2 4 3.6 M10.5 4.2a2.2 2.2 0 0 1 0 3.6 M12 9.6c1 .5 1.8 1.5 2 3.4",
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
  { icon: "home", label: "Home", href: "/" },
  { icon: "check", label: "To check", href: "/to-check" },
  { icon: "activity", label: "Activity", href: "/activity" },
  { icon: "cards", label: "Cards", href: "/cards" },
  { icon: "clients", label: "Clients", href: "/clients" },
] as const;

export type Section = typeof destinations[number]["icon"] | "settings" | "invoices" | "options" | "upload";

function Navigation({ pending, name, section }: { pending: number; name: string; section: Section }) {
  return <>
    <Link prefetch={false} className="shell-brand" href="/"><span aria-hidden="true">¥</span>Money</Link>
    <nav className="shell-links" aria-label="Main navigation">
      {destinations.map(({ icon, label, href }) => <Link prefetch={false} key={icon} href={href} aria-current={icon === section ? "page" : undefined}>
        <Icon name={icon} />{label}{icon === "check" && pending > 0 && <span className="shell-badge">{pending}</span>}
      </Link>)}
    </nav>
    <footer className="shell-footer">
      <Link prefetch={false} aria-current={section === "settings" ? "page" : undefined} href="/settings"><Icon name="settings" />Settings</Link>
      <div className="shell-person"><span aria-hidden="true">{name.slice(0, 1)}</span>{name}</div>
    </footer>
  </>;
}

const askPrompt = "Can I afford ¥4,000 tonight?";

export function Shell({ children, name, pending, feed, section }: {
  children: ReactNode;
  name: string;
  pending: number;
  feed: EventFeed;
  section: Section;
}) {
  const { mark, marking, error } = useEventFeed(feed, section === "home" || section === "check");
  const { notifications, unread } = feed;
  return <div className="money-shell" onClick={event => {
    if (event.target instanceof Element) {
      const link = event.target.closest("a");
      link?.closest<HTMLElement>("[popover]")?.hidePopover();
    }
  }}>
    <Link prefetch={false} className="shell-skip" href="#shell-main">Skip to content</Link>
    <aside className="shell-sidebar"><Navigation name={name} pending={pending} section={section} /></aside>
    <div className="shell-workspace">
      <header className="shell-bar">
        <button className="shell-mobile-toggle" popoverTarget="shell-nav" aria-label="Open navigation"><Icon name="activity" /></button>
        <Link prefetch={false} className="shell-mobile-brand" href="/">Money</Link>
        <button className="shell-ask" popoverTarget="shell-questions">
          <Icon name="mic" /><span>Ask or say: {askPrompt}</span>
        </button>
        <button className="shell-bell" popoverTarget="shell-notifications" aria-label={`Notifications, ${unread} unread`}>
          <Icon name="bell" />{unread > 0 && <span className="shell-badge">{unread}</span>}
        </button>
        <button className="shell-add" popoverTarget="shell-add"><Icon name="plus" />Add</button>
      </header>
      <main id="shell-main" className="shell-main" tabIndex={-1}>
        <div className="shell-content">{children}</div>
      </main>
      <button className="shell-phone-ask" popoverTarget="shell-questions">
        <span><Icon name="mic" /></span>Ask or tell me: “{askPrompt}”
      </button>
    </div>
    <aside id="shell-nav" popover="auto" className="shell-nav-popover">
      <button className="shell-nav-close" popoverTarget="shell-nav" popoverTargetAction="hide" aria-label="Close navigation"><Icon name="close" /></button>
      <Navigation name={name} pending={pending} section={section} />
    </aside>
    <section id="shell-notifications" popover="auto" className="shell-popover shell-notifications">
      <h2>Notifications</h2>
      <p>{unread === 0 ? "You’re caught up." : `${unread} unread notification${unread === 1 ? "" : "s"}`}</p>
      {notifications.length > 0 && <ul className="shell-notification-list">
        {notifications.map(item => <li key={item.id}>
          <div>{item.title}{item.body && <small>{item.body}</small>}</div>
          <button disabled={marking} onClick={() => mark([item.id])} aria-label={`Mark ${item.title} read`}>Mark read</button>
        </li>)}
      </ul>}
      {unread > 1 && <button className="shell-read-all" disabled={marking} onClick={() => mark()}>Mark all read</button>}
      {error && <p role="status">{error}</p>}
      <Link prefetch={false} href="/activity">View activity</Link>
    </section>
    <nav id="shell-add" popover="auto" className="shell-popover shell-add-menu" aria-label="Add to household">
      <Link prefetch={false} href="/settings#forwarding">Forward a bill</Link>
      <Link prefetch={false} href="/upload">Upload a receipt</Link>
      <Link prefetch={false} href="/invoices/new">New invoice</Link>
    </nav>
    <AskPanel />
  </div>;
}
export default Shell;
