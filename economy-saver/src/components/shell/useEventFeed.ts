"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { EventFeed } from "@/db/event-feed";

export function useEventFeed(feed: EventFeed, pollPage: boolean) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [marking, setMarking] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    async function poll() {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const query = feed.since ? `?since=${encodeURIComponent(feed.since)}` : "";
        const response = await fetch(`/api/events${query}`, { signal: controller.signal, cache: "no-store" });
        if (response.status === 401) { router.refresh(); return; }
        if (!response.ok) throw new Error();
        const { feed: current }: { feed: EventFeed } = await response.json();
        // The count also catches a new event with an earlier occurrence date (a delayed webhook).
        if (current.total !== feed.total || current.unread !== feed.unread || current.inFlight !== feed.inFlight) router.refresh();
        setError("");
      } catch {
        if (!controller.signal.aborted) setError("Couldn’t refresh activity. Check your connection.");
      } finally {
        busy = false;
      }
    }
    const focus = () => router.refresh();
    window.addEventListener("focus", focus);
    const timer = pollPage && feed.inFlight ? window.setInterval(poll, 5000) : undefined;
    return () => {
      controller.abort();
      window.removeEventListener("focus", focus);
      window.clearInterval(timer);
    };
  }, [feed.since, feed.total, feed.unread, feed.inFlight, pollPage, router]);

  async function mark(ids?: string[]) {
    setMarking(true);
    try {
      const response = await fetch("/api/events", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ids ? { ids } : {}),
      });
      if (!response.ok) throw new Error();
      setError("");
      router.refresh();
    } catch {
      setError("Couldn’t mark notifications read. Try again.");
    } finally {
      setMarking(false);
    }
  }
  return { mark, marking, error };
}
