"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { EventFeed } from "@/db/event-feed";

function feedChanged(current: EventFeed, previous: EventFeed) {
  return current.total !== previous.total || current.unread !== previous.unread
    || current.inFlight !== previous.inFlight || current.since !== previous.since;
}

type FeedCheck = { expired: true } | { expired?: false; feed: EventFeed };
let inFlight: Promise<FeedCheck> | null = null;
let lastStart = 0;

/**
 * The one feed request of the page. Every mounted shell, focus and visibility event and every 5 s tick goes through here:
 * while a request is out they all wait on it, and a new one starts no sooner than a second after the last.
 */
function checkFeed(since: string | null): Promise<FeedCheck> | null {
  if (inFlight) return inFlight;
  if (Date.now() - lastStart < 1000) return null;
  lastStart = Date.now();
  const query = since ? `?since=${encodeURIComponent(since)}` : "";
  inFlight = fetch(`/api/events${query}`, { signal: AbortSignal.timeout(15_000), cache: "no-store" })
    .then(async (response): Promise<FeedCheck> => {
      if (response.status === 401) return { expired: true };
      if (!response.ok) throw new Error();
      return { feed: (await response.json() as { feed: EventFeed }).feed };
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

export function useEventFeed(feed: EventFeed, pollPage: boolean) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [marking, setMarking] = useState(false);
  const [refreshPending, startRefresh] = useTransition();
  const refreshing = useRef(false);
  const markPending = useRef(false);
  const expired = useRef(false);

  useEffect(() => {
    if (!refreshPending) refreshing.current = false;
  }, [refreshPending]);

  const refresh = useCallback(() => {
    if (refreshing.current) return;
    refreshing.current = true;
    startRefresh(() => router.refresh());
  }, [router]);

  const expire = useCallback(() => {
    if (expired.current) return;
    expired.current = true;
    setError("Your session has expired. Open Home to continue.");
    refresh();
  }, [refresh]);

  useEffect(() => {
    let stopped = false;
    async function poll() {
      // Focus and visibility often arrive together; they share one request, and so does a refresh in progress.
      if (markPending.current || refreshing.current || expired.current || document.hidden) return;
      const request = checkFeed(feed.since);
      if (!request) return;
      try {
        const result = await request;
        if (stopped || markPending.current || expired.current) return;
        if (result.expired) { expire(); return; }
        // Count catches delayed webhooks whose occurrence date precedes the cursor.
        if (feedChanged(result.feed, feed)) refresh();
        setError("");
      } catch {
        if (!stopped && !expired.current) setError("Couldn’t refresh activity. Check your connection.");
      }
    }
    const focus = () => { void poll(); };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    const timer = pollPage && feed.inFlight ? window.setInterval(focus, 5000) : undefined;
    return () => {
      stopped = true;
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
      window.clearInterval(timer);
    };
  }, [feed, pollPage, expire, refresh]);

  /** True when the server marked them read. */
  async function mark(ids?: string[]): Promise<boolean> {
    if (markPending.current || refreshing.current || expired.current) return false;
    markPending.current = true;
    setMarking(true);
    try {
      const response = await fetch("/api/events", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ids ? { ids } : {}),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 401) { expire(); return false; }
      if (!response.ok) throw new Error();
      const { changed, feed: current }: { changed: number; feed: EventFeed } = await response.json();
      setError("");
      if (changed > 0 || feedChanged(current, feed)) refresh();
      return true;
    } catch {
      setError("Couldn’t mark activity read. Try again.");
      return false;
    } finally {
      markPending.current = false;
      setMarking(false);
    }
  }
  return { mark, marking, error };
}
