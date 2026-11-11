"use client";
import type { KeyboardEvent, ReactNode } from "react";

/** The tablist of LinkTabs. It only moves focus with Left, Right, Home and End; Enter follows the focused link. */
export function LinkTabsKeys({ children }: { children: ReactNode }) {
  function move(event: KeyboardEvent<HTMLDivElement>) {
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
    const at = tabs.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    const target = event.key === "ArrowRight" ? tabs[(at + 1) % tabs.length]
      : event.key === "ArrowLeft" ? tabs[(at + tabs.length - 1) % tabs.length]
      : event.key === "Home" ? tabs[0]
      : event.key === "End" ? tabs[tabs.length - 1] : null;
    if (!target) return;
    event.preventDefault();
    target.focus();
  }
  return <div role="tablist" className="link-tablist" onKeyDown={move}>{children}</div>;
}
