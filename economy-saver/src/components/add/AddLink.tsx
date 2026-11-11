"use client";
import type { MouseEvent, ReactNode } from "react";
import { usePathname } from "next/navigation";
import { addHref } from "@/lib/links";
import { type AddKind, useAdd } from "./context";

/** A link to the Add page that opens the Add dialog instead when the host is there and the click is a plain left click. */
export function AddLink({ kind, children, className, id }: { kind: AddKind; children: ReactNode; className?: string; id?: string }) {
  const add = useAdd();
  const pathname = usePathname();
  function open(event: MouseEvent<HTMLAnchorElement>) {
    if (!add || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    add.openAdd(kind, event.currentTarget);
  }
  return <a id={id} className={className} href={addHref(kind, pathname)} aria-haspopup="dialog" onClick={open}>{children}</a>;
}
