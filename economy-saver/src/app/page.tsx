import { db } from "@/db/client";
import { openSuggestions } from "@/db/suggestions";
import { LoadingState } from "@/components/ui/LoadingState";
import { Suspense } from "react";
import { Landing } from "@/components/auth/Landing";
import { HomeView } from "@/components/home/HomeView";
import { missingForwardingSetting } from "@/components/reader/ForwardingSettings";
import { ScrollToHash } from "@/components/ui/ScrollToHash";
import { loadWorkspace, WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { currentHouseholdId } from "@/lib/session";

type Search = Promise<{ added?: string | string[] }>;

async function SessionHome({ search }: { search: Search }) {
  const id = await currentHouseholdId();
  if (!id) return <Landing />;
  const { added } = await search;
  const [workspace, suggestions] = await Promise.all([loadWorkspace(id, true), openSuggestions(db(), id)]);
  return <WorkspaceFrame workspace={workspace} section="home"><HomeView suggestions={suggestions} state={workspace.state} people={workspace.people} entryIds={{ bill: crypto.randomUUID(), charge: crypto.randomUUID() }} balanceId={crypto.randomUUID()} inbox={workspace.inbox} notice={workspace.freshness?.stale} demo={workspace.demo} tryIt={workspace.tryIt}
    forwarding={missingForwardingSetting() === null} added={typeof added === "string" ? added : null} />
    {workspace.freshness?.asOf && <p className="ui-hint">PayPal balance as of {workspace.freshness.asOf.toLocaleString("en-US", { timeZone: workspace.timeZone })}.</p>}
    <ScrollToHash />
  </WorkspaceFrame>;
}

export default function Home({ searchParams }: { searchParams: Search }) {
  return <Suspense fallback={<LoadingState label="Opening…" />}><SessionHome search={searchParams} /></Suspense>;
}
