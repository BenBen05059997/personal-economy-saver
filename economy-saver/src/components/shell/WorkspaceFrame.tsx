import type { ReactNode } from "react";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { refreshPayPal } from "@/db/paypal-refresh";
import { loadNavigationData, loadWorkspaceData } from "@/db/workspace";
import { missingForwardingSetting } from "@/components/reader/ForwardingSettings";
import { Shell, type Section } from "./Shell";

type WorkspaceData = Awaited<ReturnType<typeof loadWorkspaceData>>;

/** `withOwn` also loads the household's own categories and guesses (D75) for the pages that show the Add forms or the reader; `own` is then never null. */
export async function loadWorkspace<Own extends boolean = false>(hid: string, home = false, withOwn: Own = false as Own):
  Promise<Own extends true ? WorkspaceData & { own: NonNullable<WorkspaceData["own"]> } : WorkspaceData> {
  const freshness = home ? await refreshPayPal(db(), hid) : null;
  return withHousehold(db(), hid, tx => loadWorkspaceData(tx, hid, home, freshness, withOwn),
    home ? undefined : { isolationLevel: "repeatable read", accessMode: "read only" }) as never;
}

export async function loadNavigation(hid: string) {
  return withHousehold(db(), hid, tx => loadNavigationData(tx, hid),
    { isolationLevel: "repeatable read", accessMode: "read only" });
}

export function WorkspaceFrame({ workspace, section, children }: {
  workspace: Awaited<ReturnType<typeof loadNavigationData>> | Awaited<ReturnType<typeof loadWorkspaceData>>;
  section: Section;
  children: ReactNode;
}) {
  const { pending, feed, name, tryIt, timeZone } = workspace;
  const today = "state" in workspace ? workspace.state.today : workspace.today;
  return <Shell name={name} pending={pending} feed={feed} section={section} forwarding={missingForwardingSetting() === null} tryIt={tryIt} today={today} timeZone={timeZone}>{children}</Shell>;
}
