"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { EventFeed } from "@/db/event-feed";

function feedChanged(current: EventFeed, previous: EventFeed) {
  return current.total !== previous.total || current.unread !== previous.unread
    || current.inFlight !== previous.inFlight || current.since !== previous.since;
}

export function useEventFeed(feed: EventFeed, pollPage: boolean) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [marking, setMarking] = useState(false);
  const [refreshPending, startRefresh] = useTransition();
  const refreshing = useRef(false);
  const checking = useRef(false);
  const markPending = useRef(false);
  const expired = useRef(false);
  const lastCheck = useRef(0);

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
    const controller = new AbortController();
    async function poll() {
      // Focus and visibility often arrive together. Keep checks and route refreshes serial.
      if (checking.current || markPending.current || refreshing.current || expired.current || document.hidden
        || Date.now() - lastCheck.current < 1000) return;
      checking.current = true;
      lastCheck.current = Date.now();
      try {
        const query = feed.since ? `?since=${encodeURIComponent(feed.since)}` : "";
        const response = await fetch(`/api/events${query}`, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]), cache: "no-store",
        });
        if (controller.signal.aborted) return;
        if (response.status === 401) { expire(); return; }
        if (!response.ok) throw new Error();
        const { feed: current }: { feed: EventFeed } = await response.json();
        if (controller.signal.aborted || markPending.current || expired.current) return;
        // Count catches delayed webhooks whose occurrence date precedes the cursor.
        if (feedChanged(current, feed)) refresh();
        setError("");
      } catch {
        if (!controller.signal.aborted && !expired.current) setError("Couldn’t refresh activity. Check your connection.");
      } finally {
        checking.current = false;
      }
    }
    const focus = () => { void poll(); };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    const timer = pollPage && feed.inFlight ? window.setInterval(focus, 5000) : undefined;
    return () => {
      controller.abort();
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
      window.clearInterval(timer);
    };
  }, [feed, pollPage, expire, refresh]);

  async function mark(ids?: string[]) {
    if (markPending.current || refreshing.current || expired.current) return;
    markPending.current = true;
    setMarking(true);
    try {
      const response = await fetch("/api/events", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ids ? { ids } : {}),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 401) { expire(); return; }
      if (!response.ok) throw new Error();
      const { changed, feed: current }: { changed: number; feed: EventFeed } = await response.json();
      setError("");
      if (changed > 0 || feedChanged(current, feed)) refresh();
    } catch {
      setError("Couldn’t mark notifications read. Try again.");
    } finally {
      markPending.current = false;
      setMarking(false);
    }
  }
  return { mark, marking, error };
}
