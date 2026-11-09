import { LoadingState } from "@/components/ui/LoadingState";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { OptionsView } from "@/components/settings/OptionsView";
import { loadWorkspace, WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { currentHouseholdId } from "@/lib/session";

async function Options() {
  const hid = await currentHouseholdId();
  if (!hid) redirect("/");
  const workspace = await loadWorkspace(hid);
  return <WorkspaceFrame workspace={workspace} section="options"><OptionsView state={workspace.state} /></WorkspaceFrame>;
}
export default function Page() {
  return <Suspense fallback={<LoadingState label="Opening options…" />}><Options /></Suspense>;
}
