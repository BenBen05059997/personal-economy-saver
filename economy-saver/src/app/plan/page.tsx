import { LoadingState } from "@/components/ui/LoadingState";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PlanView } from "@/components/plan/PlanView";
import { loadWorkspace, WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { currentHouseholdId } from "@/lib/session";

async function Plan() {
  const hid = await currentHouseholdId();
  if (!hid) redirect("/");
  const workspace = await loadWorkspace(hid);
  return <WorkspaceFrame workspace={workspace} section="plan">
    <PlanView state={workspace.state} newPotId={crypto.randomUUID()} />
  </WorkspaceFrame>;
}
export default function Page() {
  return <Suspense fallback={<LoadingState label="Opening Plan…" />}><Plan /></Suspense>;
}
