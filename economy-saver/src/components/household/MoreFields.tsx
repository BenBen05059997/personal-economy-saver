import type { ReactNode } from "react";
import { LABELS } from "./labels";
import "./add-entry.css";

/** The one "More ›" disclosure of the add forms: its fields are prefilled, so the form submits without opening it. */
export function MoreFields({ children }: { children: ReactNode }) {
  return <details className="add-entry-more">
    <summary>{LABELS.more}</summary>
    {children}
  </details>;
}
