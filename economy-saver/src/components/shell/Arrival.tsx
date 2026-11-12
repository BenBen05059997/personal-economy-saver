"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const LIT_MS = 4000;
const LOOK_MS = 100;
const LOOKS = 20;

/**
 * Where a link lands (D60): the element named by the URL hash scrolls to the middle of the screen and carries `is-arriving` for a moment.
 * A full load, a Back/Forward move and a client-side link all end here; the page may still be drawing, so it looks for a short while.
 */
export function Arrival() {
  const pathname = usePathname();
  useEffect(() => {
    let looking: number | undefined;
    let lit: { target: Element; timer: number } | undefined;
    const clear = () => { if (lit) { window.clearTimeout(lit.timer); lit.target.classList.remove("is-arriving"); lit = undefined; } };
    function arrive(left = LOOKS) {
      window.clearTimeout(looking);
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const target = document.getElementById(id);
      if (!target) { if (left > 0) looking = window.setTimeout(() => arrive(left - 1), LOOK_MS); return; }
      clear();
      for (let fold = target instanceof HTMLDetailsElement ? target : target.parentElement?.closest("details"); fold; fold = fold.parentElement?.closest("details")) fold.open = true;
      target.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      target.classList.add("is-arriving");
      lit = { target, timer: window.setTimeout(clear, LIT_MS) };
    }
    // pushState from a client-side link fires no event, so a click on a link that carries a hash looks again once Next has moved.
    const onClick = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href*='#']") : null;
      if (link) window.setTimeout(() => arrive(), LOOK_MS);
    };
    arrive();
    const again = () => arrive();
    window.addEventListener("hashchange", again);
    window.addEventListener("popstate", again);
    document.addEventListener("click", onClick);
    return () => { window.clearTimeout(looking); clear(); window.removeEventListener("hashchange", again); window.removeEventListener("popstate", again); document.removeEventListener("click", onClick); };
  }, [pathname]);
  return null;
}
