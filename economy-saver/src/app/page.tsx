import { LoadingState } from "@/components/ui/LoadingState";
import { Suspense } from "react";
import { Landing } from "@/components/auth/Landing";
import { HomeView } from "@/components/home/HomeView";
import { loadWorkspace, WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { currentHouseholdId } from "@/lib/session";

async function SessionHome() {
  const id = await currentHouseholdId();
  if (!id) return <Landing />;
  const workspace = await loadWorkspace(id, true);
  return <WorkspaceFrame workspace={workspace} section="home"><HomeView state={workspace.state} inbox={workspace.inbox} notice={workspace.freshness?.stale} />
    {workspace.freshness?.asOf && <p className="ui-hint">PayPal balance as of {workspace.freshness.asOf.toLocaleString("en-US", { timeZone: workspace.timeZone })}.</p>}
  </WorkspaceFrame>;
}

export default function Home() {
  return <Suspense fallback={<LoadingState label="Opening your household…" />}><SessionHome /></Suspense>;
}
