import type { ReactNode } from "react";
import Link from "next/link";
import { AddLink } from "@/components/add/AddLink";
import type { AddKind } from "@/components/add/context";
import "./household.css";

/** The panel on the right of a list: a title, a Close link back to the list and what the row holds. */
export function Detail({ title, close, children }: { title: string; close: string; children: ReactNode }) {
  return <aside className="directory-detail" aria-label={title}>
    <header><h2>{title}</h2><Link className="ui-back" href={close}>Close</Link></header>
    {children}
  </aside>;
}

/**
 * The one page pattern of Bills, Cards and Clients: a header (title, a hint and the Add button that opens the Add dialog), the list,
 * then the sections under it; a selected row opens `panel` on the right. Below 960px the open panel replaces the list.
 */
export function ListPage({ title, hint, add, addLabel, panel, children }: { title: string; hint: string; add: AddKind; addLabel: string; panel?: ReactNode; children: ReactNode }) {
  return <div className={`directory ${panel ? "detail-open" : ""}`}>
    <div className="directory-list">
      <header className="directory-header">
        <div><h1 className="ui-title">{title}</h1><p className="ui-hint">{hint}</p></div>
        <AddLink kind={add} className="ui-button primary">{addLabel}</AddLink>
      </header>
      {children}
    </div>
    {panel}
  </div>;
}
