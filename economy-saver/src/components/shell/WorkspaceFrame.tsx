import type { ReactNode } from "react";
import { db } from "@/db/client";
import { refreshPayPal } from "@/db/paypal-refresh";
import { loadNavigationData, loadWorkspaceData } from "@/db/workspace";
import { Shell, type Section } from "./Shell";

export async function loadWorkspace(hid: string, home = false) {
  const freshness = home ? await refreshPayPal(db(), hid) : null;
  return db().transaction(tx => loadWorkspaceData(tx, hid, home, freshness),
    home ? undefined : { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function loadNavigation(hid: string) {
  return db().transaction(tx => loadNavigationData(tx, hid),
    { isolationLevel: "repeatable read", accessMode: "read only" });
}

export function WorkspaceFrame({ workspace, section, children }: {
  workspace: Awaited<ReturnType<typeof loadNavigationData>>;
  section: Section;
  children: ReactNode;
}) {
  const { pending, feed, name } = workspace;
  return <Shell name={name} pending={pending} feed={feed} section={section}>{children}</Shell>;
}
