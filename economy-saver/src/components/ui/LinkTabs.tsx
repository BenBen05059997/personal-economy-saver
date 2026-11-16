import type { ReactNode } from "react";
import Link from "next/link";
import { LinkTabsKeys } from "./LinkTabsKeys";
import "./link-tabs.css";

type LinkTab = { id: string; label: string; href: string };

/** Tabs that are real links: no JS, Back and deep links all work. The panel below belongs to the `current` tab. */
export function LinkTabs({ label, tabs, current, children }: { label: string; tabs: LinkTab[]; current: string; children: ReactNode }) {
  const panelId = "link-tabs-panel";
  return <>
    <nav aria-label={label} className="link-tabs">
      <LinkTabsKeys>
        {tabs.map(tab => {
          const on = tab.id === current;
          return <Link key={tab.id} id={`link-tabs-${tab.id}`} role="tab" prefetch={false} href={tab.href}
            className="link-tab" aria-selected={on} aria-current={on ? "page" : undefined} aria-controls={on ? panelId : undefined}>{tab.label}</Link>;
        })}
      </LinkTabsKeys>
    </nav>
    <div role="tabpanel" id={panelId} aria-labelledby={`link-tabs-${current}`} className="link-tabs-panel">{children}</div>
  </>;
}
