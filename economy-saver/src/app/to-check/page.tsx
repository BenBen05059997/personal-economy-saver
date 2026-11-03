import { LoadingState } from "@/components/ui/LoadingState";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { CheckView } from "@/components/household/CheckView";
import { loadWorkspace, WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { currentHouseholdId } from "@/lib/session";

async function CheckList() {
  const hid = await currentHouseholdId();
  if (!hid) redirect("/");
  const workspace = await loadWorkspace(hid);
  return <WorkspaceFrame workspace={workspace} section="check">
    <CheckView state={workspace.state} inbox={workspace.inbox} people={workspace.people} entryIds={{ bill: crypto.randomUUID(), charge: crypto.randomUUID() }} />
  </WorkspaceFrame>;
}
export default function Page() {
  return <Suspense fallback={<LoadingState label="Opening To check…" />}><CheckList /></Suspense>;
}
