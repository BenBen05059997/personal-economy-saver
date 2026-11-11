"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { movedAnchor } from "@/lib/links";

/**
 * Sends an old Settings #anchor to the page that holds it now. Stored links (pinned canvas actions, saved "Based on"
 * sources) and bookmarks still carry the old anchors and cannot be rewritten; every link inside the app is already new.
 */
export function MovedAnchors() {
  const router = useRouter();
  useEffect(() => {
    function move() {
      const place = movedAnchor(window.location.hash);
      if (place) router.replace(place);
    }
    move();
    window.addEventListener("hashchange", move);
    return () => window.removeEventListener("hashchange", move);
  }, [router]);
  return null;
}
