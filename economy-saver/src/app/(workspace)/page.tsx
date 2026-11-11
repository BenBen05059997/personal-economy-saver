import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { openSuggestions } from "@/db/suggestions";
import { LoadingState } from "@/components/ui/LoadingState";
import { Suspense } from "react";
import { Landing } from "@/components/auth/Landing";
import { HomeView } from "@/components/home/HomeView";
import { loadHomePins, Pinned } from "@/components/home/Pinned";
import { missingForwardingSetting } from "@/components/reader/ForwardingSettings";
import { ScrollToHash } from "@/components/ui/ScrollToHash";
import { loadWorkspace, WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { currentHouseholdId } from "@/lib/session";

type Search = Promise<{ added?: string | string[] }>;

async function SessionHome({ search }: { search: Search }) {
  const id = await currentHouseholdId();
  if (!id) return <Landing />;
  const { added } = await search;
  const workspaceRead = loadWorkspace(id, true);
  const suggestionsRead = withHousehold(db(), id, tx => openSuggestions(tx, id));
  const pins = loadHomePins(id);
  // The pins boundary will read the original promise after the workspace is ready.
  void pins.catch(() => {});
  const [workspace, suggestions] = await Promise.all([workspaceRead, suggestionsRead]);
  return <WorkspaceFrame workspace={workspace} section="home"><HomeView householdId={id} getStarted={workspace.getStarted} suggestions={suggestions} state={workspace.state} balanceId={crypto.randomUUID()} inbox={workspace.inbox} notice={workspace.freshness?.stale} demo={workspace.demo} tryIt={workspace.tryIt} connection={workspace.connection}
    forwarding={missingForwardingSetting() === null} added={typeof added === "string" ? added : null}
    pins={<Pinned householdId={id} state={workspace.state} pins={pins} />} />
    {workspace.freshness?.asOf && <p className="ui-hint">PayPal balance as of {workspace.freshness.asOf.toLocaleString("en-US", { timeZone: workspace.timeZone })}.</p>}
    <ScrollToHash />
  </WorkspaceFrame>;
}

export default function Home({ searchParams }: { searchParams: Search }) {
  return <Suspense fallback={<LoadingState label="Opening…" />}><SessionHome search={searchParams} /></Suspense>;
}
