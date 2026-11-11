"use client";

import Link from "next/link";
import { useState } from "react";
import type { EventFeed, PublicEvent } from "@/db/event-feed";
import { FEED_PAGE } from "@/lib/money/event-kinds";
import { hrefForRef } from "@/lib/links";
import { draftedLabel } from "@/lib/money/to-check";

/** A removed bill, charge or pot has no page left to open, so its row does not link. */
function link(row: PublicEvent) {
  return row.kind.endsWith("_removed") ? null : hrefForRef(row.refType, row.refId);
}

const needsYou = (row: PublicEvent) => row.notify && !row.readAt;

/** The bell's list: every event, newest first. The first page comes with the feed; Show older fetches the next one by the last event's id. */
export function ActivityList({ feed, timeZone, marking, mark }: {
  feed: EventFeed; timeZone: string; marking: boolean; mark: (ids?: string[]) => Promise<boolean>;
}) {
  const [older, setOlder] = useState<PublicEvent[]>([]);
  const [more, setMore] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState("");
  const seen = new Set(feed.recent.map(row => row.id));
  const rows = [...feed.recent, ...older.filter(row => !seen.has(row.id))];
  const hasMore = more ?? feed.total > feed.recent.length;
  const unread = feed.unread;

  async function showOlder() {
    setLoading(true);
    setProblem("");
    try {
      const response = await fetch(`/api/events?before=${rows[rows.length - 1].id}&limit=${FEED_PAGE}`, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
      if (!response.ok) throw new Error();
      const page: { events: PublicEvent[]; next: string | null } = await response.json();
      setOlder(current => [...current, ...page.events]);
      setMore(page.next !== null);
    } catch {
      setProblem("Couldn’t load older activity. Try again.");
    } finally {
      setLoading(false);
    }
  }
  async function markRead(ids?: string[]) {
    if (await mark(ids)) {
      const readAt = new Date().toISOString();
      setOlder(current => current.map(row => !ids || ids.includes(row.id) ? { ...row, readAt: row.readAt ?? readAt } : row));
    }
  }
  const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone });

  return <>
    <h2>Activity</h2>
    {(rows.length > 0 || unread > 0) && <p>{unread > 0 ? `${unread} need${unread === 1 ? "s" : ""} you` : "You’re caught up."}</p>}
    {unread > 1 && <button className="shell-read-all" disabled={marking} onClick={() => markRead()}>Mark all read</button>}
    {rows.length === 0 ? <p>Nothing here yet. When you send an invoice, a client pays, a bill is read or you change something, it shows here.</p> : <ul className="shell-notification-list">
      {rows.map(row => {
        const href = link(row);
        const by = draftedLabel(row.madeBy);
        return <li key={row.id} data-unread={needsYou(row) || undefined}>
          <div>
            <b>{href ? <Link prefetch={false} href={href}>{row.title}</Link> : row.title}</b>{by && <small className="shell-drafted"> · {by}</small>}
            {row.body && <small>{row.body}</small>}
            <small><time dateTime={row.occurredAt}>{date(row.occurredAt)}</time></small>
          </div>
          {needsYou(row) && <>
            <span className="shell-unread-dot" role="img" aria-label="Unread" />
            <button disabled={marking} onClick={() => markRead([row.id])} aria-label={`Mark ${row.title} read`}>Mark read</button>
          </>}
        </li>;
      })}
    </ul>}
    {hasMore && <button className="shell-read-all" disabled={loading} onClick={showOlder}>{loading ? "Loading…" : "Show older"}</button>}
    {problem && <p role="status">{problem}</p>}
  </>;
}
