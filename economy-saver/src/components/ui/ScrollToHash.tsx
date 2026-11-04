"use client";
import { useEffect } from "react";

/**
 * Brings the element named in the address's hash into view once the page has drawn it (D51). Pages render inside
 * Suspense, so the browser's own hash scroll runs before the row exists and lands at the top. A closed <details> that
 * is the target, or holds it, is opened first. Render it once, after the content it should find.
 */
export function ScrollToHash() {
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    for (let node: HTMLElement | null = target; node; node = node.parentElement) {
      if (node instanceof HTMLDetailsElement) node.open = true;
    }
    target.scrollIntoView({ block: "center" });
  }, []);
  return null;
}
