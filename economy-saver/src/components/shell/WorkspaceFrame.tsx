import type { ReactNode } from "react";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { refreshPayPal } from "@/db/paypal-refresh";
import { verifiedIdentity } from "@/lib/auth-request";
import { loadNavigationData, loadWorkspaceData, type Viewer } from "@/db/workspace";
import { missingForwardingSetting } from "@/components/reader/ForwardingSettings";
import { Shell, type Section } from "./Shell";

type WorkspaceData = Awaited<ReturnType<typeof loadWorkspaceData>>;

/** `withOwn` also loads the household's own categories and guesses (D75) for the pages that show the Add forms or the reader; `own` is then never null. */
export async function loadWorkspace<Own extends boolean = false>(hid: string, home = false, withOwn: Own = false as Own, viewer: Viewer = null):
  Promise<Own extends true ? WorkspaceData & { own: NonNullable<WorkspaceData["own"]> } : WorkspaceData> {
  const freshness = home ? await refreshPayPal(db(), hid) : null;
  return withHousehold(db(), hid, tx => loadWorkspaceData(tx, hid, home, freshness, withOwn, viewer),
    home ? undefined : { isolationLevel: "repeatable read", accessMode: "read only" }) as never;
}

export async function loadNavigation(hid: string, viewer: Viewer = null) {
  return withHousehold(db(), hid, tx => loadNavigationData(tx, hid, viewer),
    { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function WorkspaceFrame({ workspace, section, children }: {
  workspace: Awaited<ReturnType<typeof loadNavigationData>> | Awaited<ReturnType<typeof loadWorkspaceData>>;
  section: Section;
  children: ReactNode;
}) {
  const { pending, feed, name, tryIt, timeZone } = workspace;
  const identity = await verifiedIdentity(); // already resolved for this request by the household lookup, so no extra call
  const today = "state" in workspace ? workspace.state.today : workspace.today;
  return <Shell name={name} pending={pending} feed={feed} section={section} forwarding={missingForwardingSetting() === null} tryIt={tryIt} viewer={identity ? { email: identity.email } : null} today={today} timeZone={timeZone}>{children}</Shell>;
}
