import type { ReactNode } from "react";
import Link from "next/link";

/** The one line under a panel title that says what the panel is for or what fills it, ending in a link to the place that does. */
export function PanelHint({ children, href, label, className }: { children: ReactNode; href?: string; label?: string; className?: string }) {
  return <p className={className ? `ui-hint panel-hint ${className}` : "ui-hint panel-hint"}>{children}
    {href && label && <> <Link prefetch={false} href={href}>{label} ›</Link></>}</p>;
}
