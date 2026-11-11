import type { ReactNode } from "react";
import Link from "next/link";
import { AddLink } from "@/components/add/AddLink";
import type { AddKind } from "@/components/add/context";

/** The one line under a panel title that says what the panel is for or what fills it, ending in a link to the place that does. With `add`, the link opens the Add dialog for that kind (its Add page without JS) instead of going to `href`. */
export function PanelHint({ children, href, label, add, className }: { children: ReactNode; href?: string; label?: string; add?: AddKind; className?: string }) {
  return <p className={className ? `ui-hint panel-hint ${className}` : "ui-hint panel-hint"}>{children}
    {add && label ? <> <AddLink kind={add}>{label} ›</AddLink></> : href && label && <> <Link prefetch={false} href={href}>{label} ›</Link></>}</p>;
}
